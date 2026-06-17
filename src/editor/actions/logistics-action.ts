import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveBaseBuiltinEntities, type BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type {
  CreateLogisticsDraftStartOptions,
  LogisticsDraftActionResult,
  LogisticsDraftEndpoint,
  LogisticsDraftInvalidReason,
  LogisticsDraftReadonlyState,
  LogisticsKind,
  LogisticsPathCell,
  LogisticsRouteOrder,
  MoveLogisticsDraftEndOptions,
} from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { DraftEntity } from "../draft-entity";
import { syncPlacementValidationState } from "../placement-validation";
import { action } from "mobx";
import type { EditorActionsContext } from "./types";
import {
  appendFreehandPathPoints,
  areGridPointsEqual,
  createEntityDefinitionMap,
  doesFirstStepMoveTowardFixedSourceInput,
  findEntityById,
  findTopEntityAtGridPoint,
  generateSingleBendPathPoints,
  gridPointKey,
  isGridPointInsideRect,
  isOrdinaryLogisticsDefinitionId,
  oppositeEdge,
  resolveEntityGridRect,
  resolveDevicePortEndpoints,
  resolveDirectionEdge,
  resolveInputEndpointAtPointer,
  resolveInputEndpointOnPath,
  resolveCellFromEdges,
  resolveLogisticsDefinitionId,
  resolveLogisticsPathCells,
  resolveNearestDevicePortEndpoint,
  resolveSourceStartGridPoint,
} from "../logistics/logistics-utils";

type EditorLogisticsActions = Pick<
  EditorAction,
  | "applyLogisticDraft"
  | "cancelLogisticsDraft"
  | "createLogisticsDraftStart"
  | "moveLogisticEnd"
  | "setLogisticsSuppression"
>;

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

type AutoDeviceKind = "splitter" | "converger" | "connector";
type LogisticsPathAxis = "horizontal" | "vertical";

interface AutoDraftCellOverride {
  readonly definitionId: string;
  readonly rotation: GridRotation;
}

interface AutoDraftPlan {
  readonly cellOverridesByGridKey: ReadonlyMap<string, AutoDraftCellOverride>;
  readonly replacingEntityIds: readonly string[];
  readonly invalidReason: LogisticsDraftInvalidReason | null;
}

interface DraftEntityBuildResult {
  readonly draftEntities: readonly DraftEntity[];
  readonly draftIds: readonly string[];
  readonly draftIdByGridKey: ReadonlyMap<string, string>;
}

interface OrdinaryLogisticsConnectionInfo {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly inputEdge: GridEdge;
  readonly outputEdge: GridEdge;
  readonly inputConnected: boolean;
  readonly outputConnected: boolean;
}

interface DeviceRouteCandidate {
  readonly source: DevicePortEndpoint;
  readonly target: DevicePortEndpoint;
  readonly routeOrder: LogisticsRouteOrder;
  readonly points: readonly GridPoint[];
  readonly lengthScore: number;
  readonly bendScore: number;
  readonly signature: string;
}

interface LogisticsActionContext extends EditorActionsContext {
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  nextDraftCounter(): number;
}

export function createEditorLogisticsActions(
  context: EditorActionsContext,
): EditorLogisticsActions {
  let logisticsDraftCounter = 0;
  const logisticsContext: LogisticsActionContext = {
    ...context,
    entityDefinitionMap: createEntityDefinitionMap(
      context.workspace.registry.entityDefinitions,
    ),
    nextDraftCounter: () => {
      logisticsDraftCounter += 1;
      return logisticsDraftCounter;
    },
  };

  return {
    createLogisticsDraftStart: action((options) => {
      // TODO: 实现物流草稿起点创建逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 source 解析、初始 preview 和 collection 接线。
      clearLogisticsDraftState(logisticsContext);

      const source = resolveCreateSourceEndpoint(logisticsContext, options);
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const routeOrder = options.routeOrder ?? "vertical-first";

      // 2026-05-23: 设备源起笔时不生成路径 cell，
      // 避免在鼠标悬浮阶段暴露多余的 1 格传送带/管道草稿。
      // moveLogisticEnd 首次调用时从 source 和 pointer 重新生成实际路径。
      if (source.type === "device-port") {
        logisticsContext.state.internalTransientState.logisticsDraft = {
          kind: options.kind,
          source,
          target: null,
          routeOrder,
          cells: [],
          headDraftEntityId: null,
          replacingEntityId: null,
          canApply: false,
          invalidReason: null,
        };
        syncPlacementValidationState({
          document: logisticsContext.document.getSnapshot(),
          state: logisticsContext.state,
          workspace: logisticsContext.workspace,
        });
        return {
          status: "created",
          canApply: false,
          invalidReason: null,
          headGridPoint: null,
          headDraftEntityId: null,
          sourceEntityId: source.entityId,
          targetEntityId: null,
        };
      }

      const replacingEntityId = source.type === "logistics-entity"
        ? source.entityId
        : null;
      const start = resolveSourceStartGridPoint(source);

      return rebuildLogisticsDraft({
        context: logisticsContext,
        kind: options.kind,
        source,
        target: null,
        routeOrder,
        points: [start],
        replacingEntityId,
        allowEmptyTarget: options.allowEmptySource !== false,
        autoCreateLogisticsDevices: true,
        status: "created",
      });
    }),

    moveLogisticEnd: action((options) => {
      // TODO: 实现物流终点移动逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 touch freehand 与 mouse single-bend 路径更新。
      // 2026-04-30 修正：已吸附设备端口时，指针在设备内保持吸附，不深入设备内部。
      const draft = logisticsContext.state.internalTransientState.logisticsDraft;
      if (draft === null || draft.source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const currentDocument = logisticsContext.document.getSnapshot();

      if (draft.target?.type === "device-port" && options.routeMode.type === "freehand") {
        const targetEntity = findEntityById({
          entityId: draft.target.entityId,
          document: currentDocument,
          drafts: [],
          baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
        });
        if (targetEntity !== null) {
          const targetDefinition = logisticsContext.entityDefinitionMap.get(
            targetEntity.definitionId,
          );
          if (
            targetDefinition !== undefined
            && isGridPointInsideRect(
              options.pointerGridPoint,
              resolveEntityGridRect({
                entity: targetEntity,
                definition: targetDefinition,
              }),
            )
          ) {
            return createLogisticsActionResultFromDraft(draft);
          }
        }
      }

      const cursorTarget = resolveInputEndpointAtPointer({
        pointerGridPoint: options.pointerGridPoint,
        kind: draft.kind,
        document: currentDocument,
        drafts: [],
        entityDefinitionMap: logisticsContext.entityDefinitionMap,
        baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
      });

      if (
        options.routeMode.type === "single-bend"
        && draft.source.type === "device-port"
        && cursorTarget !== null
      ) {
        const deviceRoute = resolveDeviceToDeviceRoute({
          context: logisticsContext,
          draft,
          sourceEntityId: draft.source.entityId,
          targetEntityId: cursorTarget.entityId,
          preferredRouteOrder: options.routeMode.routeOrder,
          autoCreateLogisticsDevices: options.autoCreateLogisticsDevices ?? true,
        });

        if (deviceRoute !== null) {
          return rebuildLogisticsDraft({
            context: logisticsContext,
            kind: draft.kind,
            source: deviceRoute.source,
            target: deviceRoute.target,
            routeOrder: options.routeMode.routeOrder,
            points: deviceRoute.points,
            replacingEntityId: draft.replacingEntityId,
            allowEmptyTarget: options.allowEmptyTarget ?? true,
            autoCreateLogisticsDevices: options.autoCreateLogisticsDevices ?? true,
            status: "updated",
          });
        }
      }

      const source = resolveMoveSourceEndpoint({
        context: logisticsContext,
        draft,
        options,
      });
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      logisticsContext.state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
      logisticsContext.state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;

      if (options.routeMode.type === "freehand") {
        if (shouldKeepSelfOverlapConvergerHeadWhenRetracingOwnSegment({
          draft,
          pointerGridPoint: options.pointerGridPoint,
        })) {
          return createLogisticsActionResultFromDraft(draft);
        }

        const currentPoints = draft.cells.length === 0
          ? [resolveSourceStartGridPoint(source)]
          : draft.cells.map((cell) => cell.gridPoint);

        const tentativePoints = appendFreehandPathPoints({
          points: currentPoints,
          pointerGridPoint: options.pointerGridPoint,
        });

        const onPathPort = resolveInputEndpointOnPath({
          pathPoints: tentativePoints,
          kind: draft.kind,
          document: currentDocument,
          entityDefinitionMap: logisticsContext.entityDefinitionMap,
          baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
        });

        const target: DevicePortEndpoint | null = onPathPort
          ?? cursorTarget;
        let points: GridPoint[] = tentativePoints;

        if (target !== null) {
          const outsideIndex = tentativePoints.findIndex(
            (p) => areGridPointsEqual(p, target.outsideGridPoint),
          );
          if (outsideIndex >= 0) {
            points = tentativePoints.slice(0, outsideIndex + 1);
          } else {
            points = appendFreehandPathPoints({
              points: currentPoints,
              pointerGridPoint: target.outsideGridPoint,
            });
          }
        }

        if (
          shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput({
            context: logisticsContext,
            draft,
            source,
            points,
          })
        ) {
          return createLogisticsActionResultFromDraft(draft);
        }

        return rebuildLogisticsDraft({
          context: logisticsContext,
          kind: draft.kind,
          source,
          target,
          routeOrder: draft.routeOrder,
          points,
          replacingEntityId: draft.replacingEntityId,
          allowEmptyTarget: options.allowEmptyTarget ?? true,
          autoCreateLogisticsDevices: options.autoCreateLogisticsDevices ?? true,
          status: "updated",
        });
      }

      const routeOrder = resolveEffectiveSingleBendRouteOrder({
        context: logisticsContext,
        kind: draft.kind,
        source,
        targetPoint: options.pointerGridPoint,
        replacingEntityId: draft.replacingEntityId,
        routeOrder: options.routeMode.routeOrder,
        allowTemporaryOrderFlip: options.routeMode.allowTemporaryOrderFlip,
      });

      let points = generateSingleBendPathPoints({
        start: resolveSourceStartGridPoint(source),
        target: options.pointerGridPoint,
        routeOrder,
      });

      const onPathPort = resolveInputEndpointOnPath({
        pathPoints: points,
        kind: draft.kind,
        document: currentDocument,
        entityDefinitionMap: logisticsContext.entityDefinitionMap,
        baseDefinitions: logisticsContext.workspace.registry.baseDefinitions,
      });

      const target = onPathPort ?? cursorTarget;

      if (target !== null) {
        points = generateSingleBendPathPoints({
          start: resolveSourceStartGridPoint(source),
          target: target.outsideGridPoint,
          routeOrder,
        });
      }

      if (
        shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput({
          context: logisticsContext,
          draft,
          source,
          points,
        })
      ) {
        return createLogisticsActionResultFromDraft(draft);
      }

      return rebuildLogisticsDraft({
        context: logisticsContext,
        kind: draft.kind,
        source,
        target,
        routeOrder,
        points,
        replacingEntityId: draft.replacingEntityId,
        allowEmptyTarget: options.allowEmptyTarget ?? true,
        autoCreateLogisticsDevices: options.autoCreateLogisticsDevices ?? true,
        status: "updated",
      });
    }),

    applyLogisticDraft: action(() => {
      // TODO: 实现物流草稿应用逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 canApply 校验、起点替换和 preview 写入 document。
      const draft = logisticsContext.state.internalTransientState.logisticsDraft;
      if (draft === null || !draft.canApply) {
        return false;
      }

      const preview = logisticsContext.state.collections[EntityCollectionType.preview];
      if (preview.length === 0) {
        return false;
      }

      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: preview,
        drafts: logisticsContext.state.drafts,
      });
      if (previewDrafts.length === 0) {
        return false;
      }

      const currentDocument = logisticsContext.document.getSnapshot();
      const nextEntities = { ...currentDocument.entities };
      let nextEntityOrder = [...currentDocument.entityOrder];

      const replacingEntityIds = new Set([
        ...logisticsContext.state.collections[EntityCollectionType.ghost],
        ...(draft.replacingEntityId === null ? [] : [draft.replacingEntityId]),
      ]);

      for (const replacingEntityId of replacingEntityIds) {
        delete nextEntities[replacingEntityId];
      }

      if (replacingEntityIds.size > 0) {
        nextEntityOrder = nextEntityOrder.filter((entityId) =>
          !replacingEntityIds.has(entityId),
        );
      }

      // 2026-05-31: 对历史累积的 entityOrder 重复条目做去重。
      nextEntityOrder = Array.from(new Set(nextEntityOrder));

      for (const previewDraft of previewDrafts) {
        nextEntities[previewDraft.id] = {
          id: previewDraft.id,
          definitionId: previewDraft.definitionId,
          position: { ...previewDraft.position },
          rotation: previewDraft.rotation,
          config: { ...previewDraft.config },
          tags: [...previewDraft.tags],
        };
        // 2026-05-31: 防御 entityOrder 重复——若已存在则跳过。
        if (!nextEntityOrder.includes(previewDraft.id)) {
          nextEntityOrder.push(previewDraft.id);
        }
      }

      logisticsContext.documentWriter.commit({
        action: {
          type: "logistics.place",
          label: "铺设物流",
          entityIds: previewDrafts.map((draft) => draft.id),
          definitionIds: resolveUniqueStrings(
            previewDrafts.map((draft) => draft.definitionId),
          ),
          count: previewDrafts.length,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          entities: nextEntities,
          entityOrder: nextEntityOrder,
        }),
      });

      clearLogisticsDraftState(logisticsContext);
      return true;
    }),

    cancelLogisticsDraft: action(() => {
      // TODO: 实现物流草稿取消逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 logistics draft / collection 的清理。
      clearLogisticsDraftState(logisticsContext);
    }),

    setLogisticsSuppression: action((family, value) => {
      if (family === "belt") {
        logisticsContext.state.suppressBelts = value;
      } else {
        logisticsContext.state.suppressPipes = value;
      }
    }),
  };
}

function resolveUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function resolveCreateSourceEndpoint(
  context: LogisticsActionContext,
  options: CreateLogisticsDraftStartOptions,
): LogisticsDraftEndpoint | null {
  const currentDocument = context.document.getSnapshot();

  switch (options.source.type) {
    case "device": {
      const entity = findEntityById({
        entityId: options.source.entityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: context.workspace.registry.baseDefinitions,
      });
      if (entity === null) {
        return null;
      }

      const definition = context.entityDefinitionMap.get(entity.definitionId);
      if (definition === undefined) {
        return null;
      }

      return resolveNearestDevicePortEndpoint({
        entity,
        definition,
        kind: options.kind,
        direction: "output",
        pointerGridPoint: options.source.pointerGridPoint,
      });
    }

    case "logistics-entity": {
      const entity = currentDocument.entities[options.source.entityId];
      if (
        entity === undefined
        || !isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind)
      ) {
        return null;
      }

      return {
        type: "logistics-entity",
        entityId: entity.id,
        gridPoint: { ...options.source.gridPoint },
      };
    }

    case "empty-cell":
      if (options.allowEmptySource === false) {
        return null;
      }

      return {
        type: "empty-cell",
        gridPoint: { ...options.source.gridPoint },
      };
  }
}

function resolveMoveSourceEndpoint(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  options: MoveLogisticsDraftEndOptions;
}): LogisticsDraftEndpoint | null {
  const source = options.draft.source;
  if (source?.type !== "device-port" || options.options.routeMode.type !== "single-bend") {
    return source;
  }

  const currentDocument = options.context.document.getSnapshot();
  const entity = findEntityById({
    entityId: source.entityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (entity === null) {
    return null;
  }

  const definition = options.context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  return resolveNearestDevicePortEndpoint({
    entity,
    definition,
    kind: options.draft.kind,
    direction: "output",
    pointerGridPoint: options.options.pointerGridPoint,
  });
}

function resolveEffectiveSingleBendRouteOrder(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  targetPoint: GridPoint;
  replacingEntityId: string | null;
  routeOrder: LogisticsRouteOrder;
  allowTemporaryOrderFlip: boolean;
}): LogisticsRouteOrder {
  if (!options.allowTemporaryOrderFlip || options.replacingEntityId === null) {
    return options.routeOrder;
  }

  const start = resolveSourceStartGridPoint(options.source);
  const currentPoints = generateSingleBendPathPoints({
    start,
    target: options.targetPoint,
    routeOrder: options.routeOrder,
  });
  if (
    !doesFirstStepOverlapExistingLogistics({
      context: options.context,
      kind: options.kind,
      points: currentPoints,
      replacingEntityId: options.replacingEntityId,
    })
  ) {
    return options.routeOrder;
  }

  const flippedOrder = flipRouteOrder(options.routeOrder);
  const flippedPoints = generateSingleBendPathPoints({
    start,
    target: options.targetPoint,
    routeOrder: flippedOrder,
  });

  return doesFirstStepOverlapExistingLogistics({
    context: options.context,
    kind: options.kind,
    points: flippedPoints,
    replacingEntityId: options.replacingEntityId,
  })
    ? options.routeOrder
    : flippedOrder;
}

function rebuildLogisticsDraft(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  target: LogisticsDraftEndpoint | null;
  routeOrder: LogisticsRouteOrder;
  points: readonly GridPoint[];
  replacingEntityId: string | null;
  allowEmptyTarget: boolean;
  autoCreateLogisticsDevices: boolean;
  status: "created" | "updated";
}): LogisticsDraftActionResult {
  const currentDocument = options.context.document.getSnapshot();
  const preview = options.context.state.collections[EntityCollectionType.preview];
  const logisticsHead = options.context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = options.context.state.collections[EntityCollectionType.ghost];
  const previousPreviewDrafts = resolvePreviewDrafts({
    previewDraftIds: preview,
    drafts: options.context.state.drafts,
  });
  const previousPreviewDraftIds = new Set(previousPreviewDrafts.map((entity) => entity.id));
  const replacingEntity = options.replacingEntityId === null
    ? null
    : findEntityById({
        entityId: options.replacingEntityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: options.context.workspace.registry.baseDefinitions,
      });
  const replacingDefinition = replacingEntity === null
    ? null
    : options.context.entityDefinitionMap.get(replacingEntity.definitionId) ?? null;
  const cells = resolveLogisticsPathCells({
    kind: options.kind,
    points: options.points,
    source: options.source,
    target: options.target,
    document: currentDocument,
    entityDefinitionMap: options.context.entityDefinitionMap,
    replacingEntity,
    replacingDefinition,
  });
  const autoDraftPlan = resolveAutoDraftPlan({
    context: options.context,
    kind: options.kind,
    source: options.source,
    target: options.target,
    cells,
    replacingEntityId: options.replacingEntityId,
    autoCreateLogisticsDevices: options.autoCreateLogisticsDevices,
  });

  const prevConvergerGridKey = options.context.state.internalTransientState.convergerEntityGridKey;
  let effectiveInvalidReason = resolveInvalidReason({
    context: options.context,
    kind: options.kind,
    cells,
    replacingEntityIds: autoDraftPlan.replacingEntityIds,
    autoDraftCellKeys: new Set(autoDraftPlan.cellOverridesByGridKey.keys()),
    target: options.target,
    allowEmptyTarget: options.allowEmptyTarget,
  }) ?? autoDraftPlan.invalidReason;

  // 2026-05-23: 之前 rebuild 在终点处已形成汇流器虚影（替换了原物流段），
  // 本次延伸使得该 cell 不再是终点 → 禁止，防止汇流器被悄悄改写为桥接器。
  if (
    prevConvergerGridKey !== null
    && effectiveInvalidReason === null
  ) {
    const prevConvergerCellIndex = cells.findIndex(
      (cell) => gridPointKey(cell.gridPoint) === prevConvergerGridKey,
    );
    if (prevConvergerCellIndex >= 0 && prevConvergerCellIndex < cells.length - 1) {
      effectiveInvalidReason = "unknown";
    }
  }

  const canApply = effectiveInvalidReason === null;

  // 记录本次自动创建的汇流器（含实体替换）所在 cell，供下一帧检测延伸。
  let nextConvergerGridKey: string | null = null;
  for (const [key, override] of autoDraftPlan.cellOverridesByGridKey) {
    if (
      override.definitionId.endsWith("_converger")
      && autoDraftPlan.replacingEntityIds.length > 0
    ) {
      nextConvergerGridKey = key;
      break;
    }
  }
  options.context.state.internalTransientState.convergerEntityGridKey = nextConvergerGridKey;
  const draftBuildResult = createDraftEntities({
    context: options.context,
    kind: options.kind,
    cells,
    cellOverridesByGridKey: autoDraftPlan.cellOverridesByGridKey,
    currentDocument,
    previousPreviewDrafts,
    previousPreviewDraftIds,
  });
  const draftIds = draftBuildResult.draftIds;

  options.context.state.drafts = [
    ...options.context.state.drafts.filter((entity) =>
      !previousPreviewDraftIds.has(entity.id),
    ),
    ...draftBuildResult.draftEntities,
  ];
  preview.replace([...draftIds]);
  const headCell = cells[cells.length - 1] ?? null;
  const headDraftEntityId = headCell === null
    ? null
    : draftBuildResult.draftIdByGridKey.get(gridPointKey(headCell.gridPoint)) ?? null;
  logisticsHead.replace(headDraftEntityId === null ? [] : [headDraftEntityId]);
  ghost.replace([...autoDraftPlan.replacingEntityIds]);

  options.context.state.internalTransientState.logisticsDraft = {
    kind: options.kind,
    source: options.source,
    target: options.target,
    routeOrder: options.routeOrder,
    cells,
    headDraftEntityId,
    replacingEntityId: options.replacingEntityId,
    canApply,
    invalidReason: effectiveInvalidReason,
  };
  syncPlacementValidationState({
    document: currentDocument,
    state: options.context.state,
    workspace: options.context.workspace,
  });

  return {
    status: options.status,
    canApply,
    invalidReason: effectiveInvalidReason,
    headGridPoint: headCell?.gridPoint ?? null,
    headDraftEntityId,
    sourceEntityId: options.source.type === "device-port" ? options.source.entityId : null,
    targetEntityId: options.target?.type === "device-port" ? options.target.entityId : null,
  };
}

function shouldKeepDraftWhenFirstStepMovesTowardFixedSourceInput(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  source: LogisticsDraftEndpoint;
  points: readonly GridPoint[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const replacingEntity = options.draft.replacingEntityId === null
    ? null
    : findEntityById({
        entityId: options.draft.replacingEntityId,
        document: currentDocument,
        drafts: [],
        baseDefinitions: options.context.workspace.registry.baseDefinitions,
      });
  const replacingDefinition = replacingEntity === null
    ? null
    : options.context.entityDefinitionMap.get(replacingEntity.definitionId) ?? null;

  return doesFirstStepMoveTowardFixedSourceInput({
    kind: options.draft.kind,
    points: options.points,
    source: options.source,
    document: currentDocument,
    entityDefinitionMap: options.context.entityDefinitionMap,
    replacingEntity,
    replacingDefinition,
  });
}

function createLogisticsActionResultFromDraft(
  draft: LogisticsDraftReadonlyState,
): LogisticsDraftActionResult {
  const headCell = draft.cells[draft.cells.length - 1] ?? null;

  return {
    status: "ignored",
    canApply: draft.canApply,
    invalidReason: draft.invalidReason,
    headGridPoint: headCell?.gridPoint ?? null,
    headDraftEntityId: draft.headDraftEntityId,
    sourceEntityId: draft.source?.type === "device-port" ? draft.source.entityId : null,
    targetEntityId: draft.target?.type === "device-port" ? draft.target.entityId : null,
  };
}

function createDraftEntities(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  cellOverridesByGridKey: ReadonlyMap<string, AutoDraftCellOverride>;
  currentDocument: WorldDocument;
  previousPreviewDrafts: readonly DraftEntity[];
  previousPreviewDraftIds: ReadonlySet<string>;
}): DraftEntityBuildResult {
  const reservedIds = new Set<string>([
    ...Object.keys(options.currentDocument.entities),
    ...resolveBaseBuiltinEntities({
      baseDefinitions: options.context.workspace.registry.baseDefinitions,
      baseId: options.currentDocument.baseId,
    }).map((entity) => entity.id),
    ...options.context.state.drafts
      .filter((entity) => !options.previousPreviewDraftIds.has(entity.id))
      .map((entity) => entity.id),
  ]);
  const batchCounter = options.context.nextDraftCounter();
  const draftEntities: DraftEntity[] = [];
  const draftIdByGridKey = new Map<string, string>();

  for (const cell of options.cells) {
    const key = gridPointKey(cell.gridPoint);
    if (draftIdByGridKey.has(key)) {
      continue;
    }

    const override = options.cellOverridesByGridKey.get(key) ?? null;
    const definitionId = override?.definitionId ?? resolveLogisticsDefinitionId({
      kind: options.kind,
      shape: cell.shape,
    });
    const reusableDraft = options.previousPreviewDrafts[draftEntities.length];
    const id = reusableDraft?.definitionId === definitionId
      ? reusableDraft.id
      : generateLogisticsDraftId({
          kind: options.kind,
          batchCounter,
          index: draftEntities.length,
          reservedIds,
        });

    reservedIds.add(id);
    draftIdByGridKey.set(key, id);

    draftEntities.push({
      id,
      originalEntityId: id,
      definitionId,
      position: { ...cell.gridPoint },
      rotation: override?.rotation ?? cell.rotation,
      config: {},
      tags: [],
    });
  }

  return {
    draftEntities,
    draftIds: draftEntities.map((entity) => entity.id),
    draftIdByGridKey,
  };
}

function resolveInvalidReason(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  replacingEntityIds: readonly string[];
  autoDraftCellKeys: ReadonlySet<string>;
  target: LogisticsDraftEndpoint | null;
  allowEmptyTarget: boolean;
}): LogisticsDraftInvalidReason | null {
  if (options.cells.length === 0) {
    return "empty-path";
  }

  const seen = new Set<string>();
  for (const cell of options.cells) {
    const key = gridPointKey(cell.gridPoint);
    if (seen.has(key)) {
      if (!options.autoDraftCellKeys.has(key)) {
        return "overlap-own-preview";
      }
      continue;
    }
    seen.add(key);
  }

  if (
    options.target?.type === "device-port"
    && doesRouteCrossTargetDevice({
      context: options.context,
      target: options.target,
      cells: options.cells,
    })
  ) {
    return "target-route-crosses-target-device";
  }

  const currentDocument = options.context.document.getSnapshot();
  const replacingEntityIds = new Set(options.replacingEntityIds);
  for (const cell of options.cells) {
    for (const entityId of currentDocument.entityOrder) {
      const entity = currentDocument.entities[entityId];
      if (entity === undefined) {
        continue;
      }

      if (!isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind)) {
        continue;
      }

      if (
        replacingEntityIds.has(entity.id)
        && areGridPointsEqual(entity.position, cell.gridPoint)
      ) {
        continue;
      }

      if (areGridPointsEqual(entity.position, cell.gridPoint)) {
        return "overlap-existing-logistics";
      }
    }
  }

  if (!options.allowEmptyTarget && options.target === null) {
    const lastCell = options.cells[options.cells.length - 1] ?? null;
    const targetEntity = lastCell === null
      ? null
      : findTopEntityAtGridPoint({
          gridPoint: lastCell.gridPoint,
          document: currentDocument,
          drafts: [],
          entityDefinitionMap: options.context.entityDefinitionMap,
          baseDefinitions: options.context.workspace.registry.baseDefinitions,
        });
    if (targetEntity === null) {
      return "empty-endpoint-disallowed";
    }
  }

  // 2026-05-24: 基地边界检测。
  // 传送带不可出 placeableArea，管道可出 placeableArea。
  // 任何物流类型都不可出 outerRing。
  const baseDefinition = resolveCurrentBaseDefinition({
    context: options.context,
  });
  if (baseDefinition !== null) {
    const placeableRect = {
      x: 0,
      y: 0,
      width: baseDefinition.placeableArea.width,
      height: baseDefinition.placeableArea.height,
    };
    const outerRing = baseDefinition.outerRing;
    const outerRingRect = {
      x: -outerRing.left,
      y: -outerRing.top,
      width: baseDefinition.placeableArea.width + outerRing.left + outerRing.right,
      height: baseDefinition.placeableArea.height + outerRing.top + outerRing.bottom,
    };

    for (const cell of options.cells) {
      const p = cell.gridPoint;

      // 传送带：检查 placeableArea 边界
      if (
        options.kind === "belt"
        && (p.x < placeableRect.x
          || p.y < placeableRect.y
          || p.x >= placeableRect.x + placeableRect.width
          || p.y >= placeableRect.y + placeableRect.height)
      ) {
        return "outside-base";
      }

      // 任何类型：检查 outerRing 边界
      if (
        p.x < outerRingRect.x
        || p.y < outerRingRect.y
        || p.x >= outerRingRect.x + outerRingRect.width
        || p.y >= outerRingRect.y + outerRingRect.height
      ) {
        return "outside-base";
      }
    }
  }

  return null;
}

function resolveCurrentBaseDefinition(options: {
  context: LogisticsActionContext;
}): BaseDefinition | null {
  const baseId = options.context.document.getSnapshot().baseId;
  return options.context.workspace.registry.baseDefinitions.find(
    (def) => def.id === baseId,
  ) ?? null;
}

function doesRouteCrossTargetDevice(options: {
  context: LogisticsActionContext;
  target: DevicePortEndpoint;
  cells: readonly LogisticsPathCell[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const targetEntity = findEntityById({
    entityId: options.target.entityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (targetEntity === null) {
    return false;
  }

  const targetDefinition = options.context.entityDefinitionMap.get(targetEntity.definitionId);
  if (targetDefinition === undefined) {
    return false;
  }

  const targetRect = resolveEntityGridRect({
    entity: targetEntity,
    definition: targetDefinition,
  });

  return options.cells.some((cell) => isGridPointInsideRect(cell.gridPoint, targetRect));
}

function doesFirstStepOverlapExistingLogistics(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  points: readonly GridPoint[];
  replacingEntityId: string;
}): boolean {
  const firstStep = options.points[1];
  if (firstStep === undefined) {
    return false;
  }

  const currentDocument = options.context.document.getSnapshot();
  return currentDocument.entityOrder.some((entityId) => {
    if (entityId === options.replacingEntityId) {
      return false;
    }

    const entity = currentDocument.entities[entityId];
    return (
      entity !== undefined
      && isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind)
      && areGridPointsEqual(entity.position, firstStep)
    );
  });
}

function resolvePreviewDrafts(options: {
  previewDraftIds: readonly string[];
  drafts: readonly DraftEntity[];
}): DraftEntity[] {
  const draftMap = new Map(options.drafts.map((entity) => [entity.id, entity]));
  const previewDrafts: DraftEntity[] = [];

  for (const draftId of options.previewDraftIds) {
    const draft = draftMap.get(draftId);
    if (draft !== undefined) {
      previewDrafts.push(draft);
    }
  }

  return previewDrafts;
}

function clearLogisticsDraftState(context: LogisticsActionContext | EditorActionsContext): void {
  const preview = context.state.collections[EntityCollectionType.preview];
  const logisticsHead = context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = context.state.collections[EntityCollectionType.ghost];
  const previewDraftIds = new Set(preview);

  context.state.drafts = context.state.drafts.filter((entity) => !previewDraftIds.has(entity.id));
  preview.replace([]);
  logisticsHead.replace([]);
  ghost.replace([]);
  context.state.internalTransientState.logisticsDraft = null;
  context.state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
  context.state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;
  context.state.internalTransientState.convergerEntityGridKey = null;
  syncPlacementValidationState({
    document: context.document.getSnapshot(),
    state: context.state,
    workspace: context.workspace,
  });
}

function createIgnoredLogisticsActionResult(): LogisticsDraftActionResult {
  return {
    status: "ignored",
    canApply: false,
    invalidReason: null,
    headGridPoint: null,
    headDraftEntityId: null,
    sourceEntityId: null,
    targetEntityId: null,
  };
}

function generateLogisticsDraftId(options: {
  kind: LogisticsKind;
  batchCounter: number;
  index: number;
  reservedIds: Set<string>;
}): string {
  const baseId = `logistics-draft:${options.kind}:${options.batchCounter}:${options.index}`;
  let candidate = baseId;
  let suffix = 1;

  while (options.reservedIds.has(candidate)) {
    candidate = `${baseId}:${suffix}`;
    suffix += 1;
  }

  options.reservedIds.add(candidate);
  return candidate;
}

function flipRouteOrder(routeOrder: LogisticsRouteOrder): LogisticsRouteOrder {
  return routeOrder === "vertical-first" ? "horizontal-first" : "vertical-first";
}

function resolveDeviceToDeviceRoute(options: {
  context: LogisticsActionContext;
  draft: LogisticsDraftReadonlyState;
  sourceEntityId: string;
  targetEntityId: string;
  preferredRouteOrder: LogisticsRouteOrder;
  autoCreateLogisticsDevices: boolean;
}): DeviceRouteCandidate | null {
  const currentDocument = options.context.document.getSnapshot();
  const sourceEntity = findEntityById({
    entityId: options.sourceEntityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  const targetEntity = findEntityById({
    entityId: options.targetEntityId,
    document: currentDocument,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (sourceEntity === null || targetEntity === null) {
    return null;
  }

  const sourceDefinition = options.context.entityDefinitionMap.get(sourceEntity.definitionId);
  const targetDefinition = options.context.entityDefinitionMap.get(targetEntity.definitionId);
  if (sourceDefinition === undefined || targetDefinition === undefined) {
    return null;
  }

  const sourceEndpoints = resolveDevicePortEndpoints({
    entity: sourceEntity,
    definition: sourceDefinition,
    kind: options.draft.kind,
    direction: "output",
    pointerGridPoint: targetEntity.position,
  });
  const targetEndpoints = resolveDevicePortEndpoints({
    entity: targetEntity,
    definition: targetDefinition,
    kind: options.draft.kind,
    direction: "input",
    pointerGridPoint: sourceEntity.position,
  });
  const routeOrders = [
    options.preferredRouteOrder,
    flipRouteOrder(options.preferredRouteOrder),
  ] as const;
  const candidates: DeviceRouteCandidate[] = [];

  for (const sourceEndpoint of sourceEndpoints) {
    for (const targetEndpoint of targetEndpoints) {
      for (const routeOrder of routeOrders) {
        const points = generateSingleBendPathPoints({
          start: sourceEndpoint.outsideGridPoint,
          target: targetEndpoint.outsideGridPoint,
          routeOrder,
        });
        const cells = resolveLogisticsPathCells({
          kind: options.draft.kind,
          points,
          source: sourceEndpoint,
          target: targetEndpoint,
          document: currentDocument,
          entityDefinitionMap: options.context.entityDefinitionMap,
          replacingEntity: null,
          replacingDefinition: null,
        });
        const autoDraftPlan = resolveAutoDraftPlan({
          context: options.context,
          kind: options.draft.kind,
          source: sourceEndpoint,
          target: targetEndpoint,
          cells,
          replacingEntityId: options.draft.replacingEntityId,
          autoCreateLogisticsDevices: options.autoCreateLogisticsDevices,
        });
        const candidateInvalidReason = resolveInvalidReason({
          context: options.context,
          kind: options.draft.kind,
          cells,
          replacingEntityIds: autoDraftPlan.replacingEntityIds,
          autoDraftCellKeys: new Set(autoDraftPlan.cellOverridesByGridKey.keys()),
          target: targetEndpoint,
          allowEmptyTarget: true,
        }) ?? autoDraftPlan.invalidReason;
        if (candidateInvalidReason !== null) {
          continue;
        }

        candidates.push({
          source: sourceEndpoint,
          target: targetEndpoint,
          routeOrder,
          points,
          lengthScore: points.length,
          bendScore: countPathBends(points),
          signature: [
            sourceEndpoint.entityId,
            sourceEndpoint.portGroupId,
            sourceEndpoint.portId,
            targetEndpoint.entityId,
            targetEndpoint.portGroupId,
            targetEndpoint.portId,
            routeOrder,
          ].join("|"),
        });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(compareDeviceRouteCandidates);
  const best = candidates[0];
  if (best === undefined) {
    return null;
  }

  const bestCandidates = candidates.filter((candidate) =>
    candidate.lengthScore === best.lengthScore
    && candidate.bendScore === best.bendScore
  );
  const signature = [
    options.sourceEntityId,
    options.targetEntityId,
    best.lengthScore,
    best.bendScore,
    ...bestCandidates.map((candidate) => candidate.signature),
  ].join(";");
  const state = options.context.state.internalTransientState;

  if (state.logisticsDeviceRouteCycleSignature === signature) {
    if (options.preferredRouteOrder !== options.draft.routeOrder) {
      state.logisticsDeviceRouteCycleIndex = (state.logisticsDeviceRouteCycleIndex + 1)
        % bestCandidates.length;
    }
  } else {
    state.logisticsDeviceRouteCycleSignature = signature;
    state.logisticsDeviceRouteCycleIndex = 0;
  }

  return bestCandidates[state.logisticsDeviceRouteCycleIndex % bestCandidates.length] ?? best;
}

function compareDeviceRouteCandidates(left: DeviceRouteCandidate, right: DeviceRouteCandidate): number {
  return left.lengthScore - right.lengthScore
    || left.bendScore - right.bendScore
    || left.signature.localeCompare(right.signature);
}

function countPathBends(points: readonly GridPoint[]): number {
  let bends = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) {
      continue;
    }

    const inEdge = resolveDirectionEdge(previous, current);
    const outEdge = resolveDirectionEdge(current, next);
    if (inEdge !== null && outEdge !== null && inEdge !== outEdge) {
      bends += 1;
    }
  }

  return bends;
}

function resolveAutoDraftPlan(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint;
  target: LogisticsDraftEndpoint | null;
  cells: readonly LogisticsPathCell[];
  replacingEntityId: string | null;
  autoCreateLogisticsDevices: boolean;
}): AutoDraftPlan {
  const currentDocument = options.context.document.getSnapshot();
  const cellOverridesByGridKey = new Map<string, AutoDraftCellOverride>();
  const replacingEntityIds = new Set<string>(
    options.replacingEntityId === null ? [] : [options.replacingEntityId],
  );
  let invalidReason: LogisticsDraftInvalidReason | null = null;

  const firstCell = options.cells[0] ?? null;
  const secondCell = options.cells[1] ?? null;
  if (
    firstCell !== null
    && secondCell !== null
    && options.source.type === "logistics-entity"
  ) {
    const sourceInfo = resolveOrdinaryLogisticsConnectionInfo({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      entityId: options.source.entityId,
    });
    const firstStepEdge = resolveDirectionEdge(firstCell.gridPoint, secondCell.gridPoint);
    if (sourceInfo !== null && sourceInfo.inputConnected && sourceInfo.outputConnected) {
      if (firstStepEdge === sourceInfo.outputEdge) {
        invalidReason = "unknown";
      } else if (firstStepEdge !== null) {
        if (options.autoCreateLogisticsDevices) {
          cellOverridesByGridKey.set(
            gridPointKey(firstCell.gridPoint),
            createAutoDeviceOverride(options.kind, "splitter", sourceInfo.inputEdge),
          );
          replacingEntityIds.add(sourceInfo.entity.id);
        }
      }
    }
  }

  const lastCell = options.cells[options.cells.length - 1] ?? null;
  if (lastCell !== null && (options.cells.length > 1 || options.source.type === "device-port")) {
    const targetEntity = findTopEntityAtGridPoint({
      gridPoint: lastCell.gridPoint,
      document: currentDocument,
      drafts: [],
      entityDefinitionMap: options.context.entityDefinitionMap,
      baseDefinitions: options.context.workspace.registry.baseDefinitions,
    });
    const targetInfo = targetEntity === null
      ? null
      : resolveOrdinaryLogisticsConnectionInfo({
          context: options.context,
          kind: options.kind,
          document: currentDocument,
          entityId: targetEntity.id,
        });

    if (
      targetInfo !== null
      && targetInfo.entity.id !== options.replacingEntityId
      && options.target === null
    ) {
      if (!options.autoCreateLogisticsDevices) {
        invalidReason = "overlap-existing-logistics";
      } else if (targetInfo.inputConnected) {
        // 有合法上游 → 创建汇流器
        cellOverridesByGridKey.set(
          gridPointKey(lastCell.gridPoint),
          createAutoDeviceOverride(options.kind, "converger", targetInfo.outputEdge),
        );
        replacingEntityIds.add(targetInfo.entity.id);
      } else {
        // AI-CORRECTION 2026-05-29:
        // 无合法上游 → 替换目标物流格为普通物流段（弯道/直道），
        // 使其入口方向与新拉入方向一致，出口方向保持原物流段出口方向。
        // 原行为：仅在 outputConnected 时创建汇流器，否则路径重叠变红。
        if (lastCell.fromEdge !== null) {
          const { shape, rotation } = resolveCellFromEdges(lastCell.fromEdge, targetInfo.outputEdge);
          cellOverridesByGridKey.set(
            gridPointKey(lastCell.gridPoint),
            {
              definitionId: resolveLogisticsDefinitionId({ kind: options.kind, shape }),
              rotation,
            },
          );
          replacingEntityIds.add(targetInfo.entity.id);
        }
      }
    }
  }

  if (firstCell !== null && options.source.type === "device-port") {
    if (options.target?.type === "device-port" || options.cells.length > 1) {
      invalidReason = resolveConnectorCrossingAutoDraftCell({
        context: options.context,
        kind: options.kind,
        document: currentDocument,
        cell: firstCell,
        autoCreateLogisticsDevices: options.autoCreateLogisticsDevices,
        cellOverridesByGridKey,
        replacingEntityIds,
      }) ?? invalidReason;
    }
  }

  // AI-REMOVED 2026-06-16:
  // Reason: 设备到设备单格特例没有覆盖删除任一设备后的首格/末格跨越，已被统一端点桥接判定替代。
  // Trigger: 用户指出同一蓝图删掉任意设备后，从远处拉过来或拉到远处也应创建桥接器。
  // Evidence: 新增 PC/touch 回归覆盖 source device -> distant cell 与 distant cell -> target device；根因是端点相邻格未参与 connector 判定。
  // Replacement: resolveConnectorCrossingAutoDraftCell + firstCell/lastCell 端点调用。
  // Risk: Low - 原特例只覆盖 source/target 均为 device-port 且 cells.length=1 的窄场景。
  // Human Review: Required
  //
  // Original code:
  // if (
  //   options.cells.length === 1
  //   && options.source.type === "device-port"
  //   && options.target?.type === "device-port"
  // ) {
  //   const cell = options.cells[0];
  //   if (cell !== undefined) {
  //     const entity = findTopEntityAtGridPoint({
  //       gridPoint: cell.gridPoint,
  //       document: currentDocument,
  //       drafts: [],
  //       entityDefinitionMap: options.context.entityDefinitionMap,
  //       baseDefinitions: options.context.workspace.registry.baseDefinitions,
  //     });
  //     const info = entity === null
  //       ? null
  //       : resolveOrdinaryLogisticsConnectionInfo({
  //           context: options.context,
  //           kind: options.kind,
  //           document: currentDocument,
  //           entityId: entity.id,
  //         });
  //
  //     if (info !== null && (info.inputConnected || info.outputConnected)) {
  //       if (!isPerpendicularConnectorPass({ cell, info })) {
  //         invalidReason = "unknown";
  //       } else if (!options.autoCreateLogisticsDevices) {
  //         invalidReason = "overlap-existing-logistics";
  //       } else {
  //         cellOverridesByGridKey.set(
  //           gridPointKey(cell.gridPoint),
  //           createAutoDeviceOverride(options.kind, "connector", null),
  //         );
  //         replacingEntityIds.add(info.entity.id);
  //       }
  //     }
  //   }
  // }

  if (
    lastCell !== null
    && options.target?.type === "device-port"
    && (
      firstCell === null
      || gridPointKey(lastCell.gridPoint) !== gridPointKey(firstCell.gridPoint)
      || options.source.type !== "device-port"
    )
  ) {
    invalidReason = resolveConnectorCrossingAutoDraftCell({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      cell: lastCell,
      autoCreateLogisticsDevices: options.autoCreateLogisticsDevices,
      cellOverridesByGridKey,
      replacingEntityIds,
    }) ?? invalidReason;
  }

  for (let index = 1; index < options.cells.length - 1; index += 1) {
    const cell = options.cells[index];
    if (cell === undefined) {
      continue;
    }
    invalidReason = resolveConnectorCrossingAutoDraftCell({
      context: options.context,
      kind: options.kind,
      document: currentDocument,
      cell,
      autoCreateLogisticsDevices: options.autoCreateLogisticsDevices,
      cellOverridesByGridKey,
      replacingEntityIds,
    }) ?? invalidReason;
  }

  const firstIndexByGridKey = new Map<string, number>();
  for (let index = 0; index < options.cells.length; index += 1) {
    const cell = options.cells[index];
    if (cell === undefined) {
      continue;
    }

    const key = gridPointKey(cell.gridPoint);
    const firstIndex = firstIndexByGridKey.get(key);
    if (firstIndex === undefined) {
      firstIndexByGridKey.set(key, index);
      continue;
    }

    if (firstIndex === 0) {
      invalidReason = "overlap-own-preview";
      continue;
    }

    const firstCell = options.cells[firstIndex];
    const isLastCell = index === options.cells.length - 1;
    if (
      firstCell === undefined
      || !canCreateAutoDeviceForSelfOverlap({
        firstCell,
        repeatedCell: cell,
        isLastCell,
      })
    ) {
      invalidReason = "overlap-own-preview";
      continue;
    }

    if (!options.autoCreateLogisticsDevices) {
      invalidReason = "overlap-own-preview";
      continue;
    }

    const overrideKind: AutoDeviceKind = isLastCell ? "converger" : "connector";
    const edge = isLastCell ? cell.toEdge : null;
    cellOverridesByGridKey.set(
      key,
      createAutoDeviceOverride(options.kind, overrideKind, edge),
    );
  }

  if (invalidReason !== null) {
    return {
      cellOverridesByGridKey: new Map(),
      replacingEntityIds: options.replacingEntityId === null ? [] : [options.replacingEntityId],
      invalidReason,
    };
  }

  return {
    cellOverridesByGridKey,
    replacingEntityIds: Array.from(replacingEntityIds),
    invalidReason,
  };
}

function resolveConnectorCrossingAutoDraftCell(options: {
  readonly context: LogisticsActionContext;
  readonly kind: LogisticsKind;
  readonly document: WorldDocument;
  readonly cell: LogisticsPathCell;
  readonly autoCreateLogisticsDevices: boolean;
  readonly cellOverridesByGridKey: Map<string, AutoDraftCellOverride>;
  readonly replacingEntityIds: Set<string>;
}): LogisticsDraftInvalidReason | null {
  const entity = findTopEntityAtGridPoint({
    gridPoint: options.cell.gridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  const info = entity === null
    ? null
    : resolveOrdinaryLogisticsConnectionInfo({
        context: options.context,
        kind: options.kind,
        document: options.document,
        entityId: entity.id,
      });
  if (info === null || (!info.inputConnected && !info.outputConnected)) {
    return null;
  }

  if (!isPerpendicularConnectorPass({ cell: options.cell, info })) {
    return "unknown";
  }

  if (!options.autoCreateLogisticsDevices) {
    return "overlap-existing-logistics";
  }

  options.cellOverridesByGridKey.set(
    gridPointKey(options.cell.gridPoint),
    createAutoDeviceOverride(options.kind, "connector", null),
  );
  options.replacingEntityIds.add(info.entity.id);
  return null;
}

function canCreateAutoDeviceForSelfOverlap(options: {
  readonly firstCell: LogisticsPathCell;
  readonly repeatedCell: LogisticsPathCell;
  readonly isLastCell: boolean;
}): boolean {
  const firstAxis = resolveStraightCellAxis(options.firstCell);
  if (firstAxis === null) {
    return false;
  }

  if (options.isLastCell) {
    const edges = [
      options.repeatedCell.fromEdge,
      options.repeatedCell.toEdge,
    ].filter((edge): edge is GridEdge => edge !== null);

    return edges.length > 0 && edges.every((edge) => resolveEdgeAxis(edge) !== firstAxis);
  }

  const repeatedAxis = resolveStraightCellAxis(options.repeatedCell);

  return repeatedAxis !== null && repeatedAxis !== firstAxis;
}

function shouldKeepSelfOverlapConvergerHeadWhenRetracingOwnSegment(options: {
  readonly draft: LogisticsDraftReadonlyState;
  readonly pointerGridPoint: GridPoint;
}): boolean {
  if (!options.draft.canApply || options.draft.invalidReason !== null) {
    return false;
  }

  const lastIndex = options.draft.cells.length - 1;
  const headCell = options.draft.cells[lastIndex];
  if (headCell === undefined) {
    return false;
  }

  const repeatedGridKey = gridPointKey(headCell.gridPoint);
  const firstCell = options.draft.cells.find((cell, index) =>
    index < lastIndex && gridPointKey(cell.gridPoint) === repeatedGridKey
  ) ?? null;
  if (firstCell === null) {
    return false;
  }

  const firstAxis = resolveStraightCellAxis(firstCell);
  return (
    firstAxis !== null
    && isGridPointOnAxisFromPoint({
      axis: firstAxis,
      origin: headCell.gridPoint,
      target: options.pointerGridPoint,
    })
    && canCreateAutoDeviceForSelfOverlap({
      firstCell,
      repeatedCell: headCell,
      isLastCell: true,
    })
  );
}

function isGridPointOnAxisFromPoint(options: {
  readonly axis: LogisticsPathAxis;
  readonly origin: GridPoint;
  readonly target: GridPoint;
}): boolean {
  if (areGridPointsEqual(options.origin, options.target)) {
    return false;
  }

  return options.axis === "horizontal"
    ? options.target.y === options.origin.y
    : options.target.x === options.origin.x;
}

function resolveStraightCellAxis(cell: LogisticsPathCell): LogisticsPathAxis | null {
  if (cell.fromEdge === null || cell.toEdge === null) {
    return null;
  }

  if (oppositeEdge(cell.fromEdge) !== cell.toEdge) {
    return null;
  }

  return resolveEdgeAxis(cell.fromEdge);
}

function resolveEdgeAxis(edge: GridEdge): LogisticsPathAxis {
  return edge === "EAST" || edge === "WEST" ? "horizontal" : "vertical";
}

function isPerpendicularConnectorPass(options: {
  readonly cell: LogisticsPathCell;
  readonly info: OrdinaryLogisticsConnectionInfo;
}): boolean {
  if (options.cell.fromEdge === null || options.cell.toEdge === null) {
    return false;
  }

  if (oppositeEdge(options.cell.fromEdge) !== options.cell.toEdge) {
    return false;
  }

  return options.cell.fromEdge !== options.info.inputEdge
    && options.cell.fromEdge !== options.info.outputEdge
    && options.cell.toEdge !== options.info.inputEdge
    && options.cell.toEdge !== options.info.outputEdge;
}

function resolveOrdinaryLogisticsConnectionInfo(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  entityId: string;
}): OrdinaryLogisticsConnectionInfo | null {
  const entity = findEntityById({
    entityId: options.entityId,
    document: options.document,
    drafts: [],
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (entity === null || !isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind)) {
    return null;
  }

  const definition = options.context.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  const inputEndpoint = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: entity.position,
  })[0];
  const outputEndpoint = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: entity.position,
  })[0];
  if (inputEndpoint === undefined || outputEndpoint === undefined) {
    return null;
  }

  return {
    entity,
    definition,
    inputEdge: inputEndpoint.edge,
    outputEdge: outputEndpoint.edge,
    inputConnected: doesNeighborOutputConnectToPoint({
      context: options.context,
      kind: options.kind,
      document: options.document,
      neighborGridPoint: inputEndpoint.outsideGridPoint,
      targetGridPoint: entity.position,
      ignoredEntityId: entity.id,
    }),
    outputConnected: doesPointOutputConnectToNeighborInput({
      context: options.context,
      kind: options.kind,
      document: options.document,
      sourceGridPoint: entity.position,
      neighborGridPoint: outputEndpoint.outsideGridPoint,
      ignoredEntityId: entity.id,
    }),
  };
}

function doesNeighborOutputConnectToPoint(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  neighborGridPoint: GridPoint;
  targetGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopEntityAtGridPoint({
    gridPoint: options.neighborGridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = options.context.entityDefinitionMap.get(neighbor.definitionId);
  if (definition === undefined) {
    return false;
  }

  return resolveDevicePortEndpoints({
    entity: neighbor,
    definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: options.targetGridPoint,
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.targetGridPoint));
}

function doesPointOutputConnectToNeighborInput(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  document: WorldDocument;
  sourceGridPoint: GridPoint;
  neighborGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopEntityAtGridPoint({
    gridPoint: options.neighborGridPoint,
    document: options.document,
    drafts: [],
    entityDefinitionMap: options.context.entityDefinitionMap,
    baseDefinitions: options.context.workspace.registry.baseDefinitions,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = options.context.entityDefinitionMap.get(neighbor.definitionId);
  if (definition === undefined) {
    return false;
  }

  return resolveDevicePortEndpoints({
    entity: neighbor,
    definition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: options.sourceGridPoint,
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.sourceGridPoint));
}

function createAutoDeviceOverride(
  kind: LogisticsKind,
  deviceKind: AutoDeviceKind,
  edge: GridEdge | null,
): AutoDraftCellOverride {
  return {
    definitionId: resolveAutoDeviceDefinitionId(kind, deviceKind),
    rotation: resolveAutoDeviceRotation(deviceKind, edge),
  };
}

function resolveAutoDeviceDefinitionId(kind: LogisticsKind, deviceKind: AutoDeviceKind): string {
  const prefix = kind === "belt" ? "item_log" : "item_pipe";
  switch (deviceKind) {
    case "splitter":
      return `${prefix}_splitter`;
    case "converger":
      return `${prefix}_converger`;
    case "connector":
      return `${prefix}_connector`;
  }
}

function resolveAutoDeviceRotation(deviceKind: AutoDeviceKind, edge: GridEdge | null): GridRotation {
  if (deviceKind === "connector" || edge === null) {
    return 0;
  }

  const baseEdge: GridEdge = deviceKind === "splitter" ? "NORTH" : "SOUTH";
  for (const rotation of [0, 90, 180, 270] as const) {
    if (rotateGridEdge(baseEdge, rotation) === edge) {
      return rotation;
    }
  }

  return 0;
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const edgeOrder: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
  const currentIndex = edgeOrder.indexOf(edge);
  const steps = rotation / 90;
  return edgeOrder[(currentIndex + steps) % edgeOrder.length] ?? edge;
}
