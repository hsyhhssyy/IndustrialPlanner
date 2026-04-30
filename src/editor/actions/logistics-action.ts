import type { EditorAction } from "@/domain/action/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";
import type { GridPoint } from "@/domain/types/grid";
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
} from "@/domain/types/logistics";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import type { DraftEntity } from "../draft-entity";
import type { EditorActionsContext } from "./types";
import {
  appendFreehandPathPoints,
  areGridPointsEqual,
  createEntityDefinitionMap,
  doesFirstStepMoveTowardFixedSourceInput,
  findEntityById,
  generateSingleBendPathPoints,
  gridPointKey,
  isGridPointInsideRect,
  isOrdinaryLogisticsDefinitionId,
  resolveEntityGridRect,
  resolveInputEndpointAtPointer,
  resolveInputEndpointOnPath,
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
>;

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

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
    createLogisticsDraftStart: (options) => {
      // TODO: 实现物流草稿起点创建逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 source 解析、初始 preview 和 collection 接线。
      clearLogisticsDraftState(logisticsContext);

      const source = resolveCreateSourceEndpoint(logisticsContext, options);
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const replacingEntityId = source.type === "logistics-entity"
        ? source.entityId
        : null;
      const start = resolveSourceStartGridPoint(source);
      const routeOrder = options.routeOrder ?? "vertical-first";

      return rebuildLogisticsDraft({
        context: logisticsContext,
        kind: options.kind,
        source,
        target: null,
        routeOrder,
        points: [start],
        replacingEntityId,
        status: "created",
      });
    },

    moveLogisticEnd: (options) => {
      // TODO: 实现物流终点移动逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 touch freehand 与 mouse single-bend 路径更新。
      // 2026-04-30 修正：已吸附设备端口时，指针在设备内保持吸附，不深入设备内部。
      const draft = logisticsContext.state.internalTransientState.logisticsDraft;
      if (draft === null || draft.source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const source = resolveMoveSourceEndpoint({
        context: logisticsContext,
        draft,
        options,
      });
      if (source === null) {
        return createIgnoredLogisticsActionResult();
      }

      const currentDocument = logisticsContext.document.getSnapshot();

      if (draft.target?.type === "device-port") {
        const targetEntity = currentDocument.entities[draft.target.entityId];
        if (targetEntity !== undefined) {
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
      });

      if (options.routeMode.type === "freehand") {
        const currentPoints = draft.cells.map((cell) => cell.gridPoint);

        const tentativePoints = appendFreehandPathPoints({
          points: currentPoints,
          pointerGridPoint: options.pointerGridPoint,
        });

        const onPathPort = resolveInputEndpointOnPath({
          pathPoints: tentativePoints,
          kind: draft.kind,
          document: currentDocument,
          entityDefinitionMap: logisticsContext.entityDefinitionMap,
        });

        let target: DevicePortEndpoint | null = onPathPort
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
        status: "updated",
      });
    },

    applyLogisticDraft: () => {
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

      if (draft.replacingEntityId !== null) {
        delete nextEntities[draft.replacingEntityId];
        nextEntityOrder = nextEntityOrder.filter((entityId) =>
          entityId !== draft.replacingEntityId,
        );
      }

      for (const previewDraft of previewDrafts) {
        nextEntities[previewDraft.id] = {
          id: previewDraft.id,
          definitionId: previewDraft.definitionId,
          position: { ...previewDraft.position },
          rotation: previewDraft.rotation,
          config: { ...previewDraft.config },
          tags: [...previewDraft.tags],
        };
        nextEntityOrder.push(previewDraft.id);
      }

      logisticsContext.document.setSnapshot({
        ...currentDocument,
        entities: nextEntities,
        entityOrder: nextEntityOrder,
      });

      clearLogisticsDraftState(logisticsContext);
      return true;
    },

    cancelLogisticsDraft: () => {
      // TODO: 实现物流草稿取消逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 logistics draft / collection 的清理。
      clearLogisticsDraftState(logisticsContext);
    },
  };
}

function resolveCreateSourceEndpoint(
  context: LogisticsActionContext,
  options: CreateLogisticsDraftStartOptions,
): LogisticsDraftEndpoint | null {
  const currentDocument = context.document.getSnapshot();

  switch (options.source.type) {
    case "device": {
      const entity = currentDocument.entities[options.source.entityId];
      if (entity === undefined) {
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
  const entity = currentDocument.entities[source.entityId];
  if (entity === undefined) {
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
  status: "created" | "updated";
}): LogisticsDraftActionResult {
  const currentDocument = options.context.document.getSnapshot();
  const preview = options.context.state.collections[EntityCollectionType.preview];
  const logisticsHead = options.context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = options.context.state.collections[EntityCollectionType.ghost];
  const previousPreviewDraftIds = new Set(preview);
  const replacingEntity = options.replacingEntityId === null
    ? null
    : findEntityById({
        entityId: options.replacingEntityId,
        document: currentDocument,
        drafts: [],
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
  const invalidReason = resolveInvalidReason({
    context: options.context,
    kind: options.kind,
    cells,
    replacingEntityId: options.replacingEntityId,
    target: options.target,
  });
  const canApply = invalidReason === null;
  const draftEntities = createDraftEntities({
    context: options.context,
    kind: options.kind,
    cells,
    currentDocument,
    previousPreviewDraftIds,
  });
  const draftIds = draftEntities.map((entity) => entity.id);

  options.context.state.drafts = [
    ...options.context.state.drafts.filter((entity) =>
      !previousPreviewDraftIds.has(entity.id),
    ),
    ...draftEntities,
  ];
  preview.replace(draftIds);
  logisticsHead.replace(draftIds.length === 0 ? [] : [draftIds[draftIds.length - 1] as string]);
  ghost.replace(options.replacingEntityId === null ? [] : [options.replacingEntityId]);

  const headCell = cells[cells.length - 1] ?? null;
  const headDraftEntityId = draftIds[draftIds.length - 1] ?? null;
  options.context.state.internalTransientState.logisticsDraft = {
    kind: options.kind,
    source: options.source,
    target: options.target,
    routeOrder: options.routeOrder,
    cells,
    headDraftEntityId,
    replacingEntityId: options.replacingEntityId,
    canApply,
    invalidReason,
  };

  return {
    status: options.status,
    canApply,
    invalidReason,
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
  currentDocument: WorldDocument;
  previousPreviewDraftIds: ReadonlySet<string>;
}): DraftEntity[] {
  const reservedIds = new Set<string>([
    ...Object.keys(options.currentDocument.entities),
    ...options.context.state.drafts
      .filter((entity) => !options.previousPreviewDraftIds.has(entity.id))
      .map((entity) => entity.id),
  ]);
  const batchCounter = options.context.nextDraftCounter();

  return options.cells.map((cell, index) => {
    const id = generateLogisticsDraftId({
      kind: options.kind,
      batchCounter,
      index,
      reservedIds,
    });

    return {
      id,
      originalEntityId: id,
      definitionId: resolveLogisticsDefinitionId({
        kind: options.kind,
        shape: cell.shape,
      }),
      position: { ...cell.gridPoint },
      rotation: cell.rotation,
      config: {},
      tags: [],
    };
  });
}

function resolveInvalidReason(options: {
  context: LogisticsActionContext;
  kind: LogisticsKind;
  cells: readonly LogisticsPathCell[];
  replacingEntityId: string | null;
  target: LogisticsDraftEndpoint | null;
}): LogisticsDraftInvalidReason | null {
  if (options.cells.length === 0) {
    return "empty-path";
  }

  const seen = new Set<string>();
  for (const cell of options.cells) {
    const key = gridPointKey(cell.gridPoint);
    if (seen.has(key)) {
      return "overlap-own-preview";
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
        options.replacingEntityId === entity.id
        && areGridPointsEqual(entity.position, cell.gridPoint)
      ) {
        continue;
      }

      if (areGridPointsEqual(entity.position, cell.gridPoint)) {
        return "overlap-existing-logistics";
      }
    }
  }

  return null;
}

function doesRouteCrossTargetDevice(options: {
  context: LogisticsActionContext;
  target: DevicePortEndpoint;
  cells: readonly LogisticsPathCell[];
}): boolean {
  const currentDocument = options.context.document.getSnapshot();
  const targetEntity = currentDocument.entities[options.target.entityId];
  if (targetEntity === undefined) {
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
