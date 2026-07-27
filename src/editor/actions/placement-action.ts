import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import type { DraftEntity } from "../draft-entity";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRectSize } from "@/domain/shared/grid";
import { createUuid } from "@/domain/shared/uuid";
import type { EntityDefinition, EntityPlacementDefaults } from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics";

import { syncPlacementValidationState } from "../placement-validation";
import { action } from "mobx";
import type { EditorActionsContext } from "./types";
import { snapPlacementToOuterRingEdge } from "../placement-snapping";

type EditorPlacementActions = Pick<
  EditorAction,
  | "createSinglePlacementDraft"
  | "createBlueprintPlacementDraft"
  | "applyPlacementDraft"
  | "cancelPlacementDraft"
>;

export function createEditorPlacementActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorPlacementActions {
  const resolveCollection = (collectionType: EntityCollectionType) =>
    state.collections[collectionType];

  let placementDraftCounter = 0;

  return {
    createSinglePlacementDraft: action((
      deviceDefinitionId: string,
      centerGridPoint: GridPoint,
    ) => {
      const definition = workspace.registry.entityDefinitions.find(
        (def) => def.id === deviceDefinitionId,
      );

      if (definition === undefined) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const preview = resolveCollection(EntityCollectionType.preview);
      // draft ID 仅需与已有 draft 去重；最终 ID 在 commit 时基于文档状态重新分配。
      const reservedIds = new Set<string>(
        state.drafts.map((entity) => entity.id),
      );

      const nextDraftId = generatePlacementDraftId(
        deviceDefinitionId,
        ++placementDraftCounter,
        reservedIds,
      );

      const rawPosition = resolvePlacementDraftPosition({
        centerGridPoint,
        footprint: definition.footprint,
      });
      const snappedPlacement = snapPlacementToOuterRingEdge({
        definition,
        baseDefinition: resolveBaseDefinition(currentDocument.baseId, workspace.registry.baseDefinitions),
        position: rawPosition,
        rotation: 0,
      });
      const draft: DraftEntity = {
        id: nextDraftId,
        definitionId: deviceDefinitionId,
        position: snappedPlacement.position,
        rotation: snappedPlacement.rotation,
        config: {},
        tags: [],
        originalEntityId: nextDraftId,
      };

      // placementDefaults 必须在 state.drafts 赋值之前应用到 draft，
      // 确保 MobX 追踪到的 draft 已携带完整 config 与 slotLinks。
      state.internalTransientState.placementDraftSlotLinks = null;
      if (definition.placementDefaults) {
        const expanded = expandPlacementDefaults(
          definition.placementDefaults,
          draft.id,
        );
        draft.config = expanded.config;
        state.internalTransientState.placementDraftSlotLinks = expanded.slotLinks;
      }

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts: [draft],
      });
      preview.replace([draft.id]);

      state.internalTransientState.placementHistoryAction = {
        type: "entity.place",
        label: "放置设备",
        detail: deviceDefinitionId,
        entityIds: [draft.id],
        definitionIds: [deviceDefinitionId],
        count: 1,
      };
      syncPlacementValidationState({
        document: currentDocument,
        state,
        workspace,
      });
    }),

    createBlueprintPlacementDraft: action((
      blueprint: BlueprintDocument,
      centerGridPoint: GridPoint,
    ) => {
      const currentDocument = document.getSnapshot();
      const preview = resolveCollection(EntityCollectionType.preview);
      // draft ID 仅需与已有 draft 去重；最终 ID 在 commit 时基于文档状态重新分配。
      const reservedIds = new Set<string>(
        state.drafts.map((entity) => entity.id),
      );
      const placementVector = {
        x: centerGridPoint.x - blueprint.initialGridPoint.x,
        y: centerGridPoint.y - blueprint.initialGridPoint.y,
      };
      const nextPreviewDrafts: DraftEntity[] = [];
      const entityIdMap = new Map<string, string>();

      for (const entityId of blueprint.entityOrder) {
        const entity = blueprint.entities[entityId];

        if (entity === undefined) {
          continue;
        }

        const draftId = generatePlacementDraftId(
          entity.definitionId,
          ++placementDraftCounter,
          reservedIds,
        );

        entityIdMap.set(entity.id, draftId);
        nextPreviewDrafts.push({
          ...cloneWorldEntity(entity),
          id: draftId,
          originalEntityId: draftId,
          position: {
            x: entity.position.x + placementVector.x,
            y: entity.position.y + placementVector.y,
          },
        });
      }

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts,
      });
      preview.replace(nextPreviewDrafts.map((draft) => draft.id));
      state.internalTransientState.placementDraftEntityIdMap = entityIdMap;
      state.internalTransientState.placementOriginEntityIds = Object.keys(blueprint.entities);
      state.internalTransientState.placementDraftSlotLinks = blueprint.slotLinks.flatMap((slotLink) => {
        const sourceEntityId = resolveSlotLinkEntityIdForPlacement(slotLink.source.entityId, entityIdMap);
        const targetEntityId = resolveSlotLinkEntityIdForPlacement(slotLink.target.entityId, entityIdMap);

        if (sourceEntityId === null || targetEntityId === null) {
          return [];
        }

        return [{
          ...cloneSlotLinkDefinition(slotLink),
          id: createUuid(),
          source: {
            ...slotLink.source,
            entityId: sourceEntityId,
          },
          target: {
            ...slotLink.target,
            entityId: targetEntityId,
          },
        } satisfies SlotLinkDefinition];
      });
      state.internalTransientState.placementHistoryAction = {
        type: "blueprint.place",
        label: "放置蓝图",
        detail: blueprint.name,
        entityIds: nextPreviewDrafts.map((draft) => draft.id),
        definitionIds: resolveUniqueStrings(
          nextPreviewDrafts.map((draft) => draft.definitionId),
        ),
        blueprintId: blueprint.blueprintId,
        blueprintName: blueprint.name,
        count: nextPreviewDrafts.length,
      };
      syncPlacementValidationState({
        document: currentDocument,
        state,
        workspace,
      });
    }),

    applyPlacementDraft: action(() => {
      const currentDocument = document.getSnapshot();
      const previewDrafts = resolvePreviewDrafts({
        previewDraftIds: resolveCollection(EntityCollectionType.preview),
        drafts: state.drafts,
      });

      // 2026-05-24: 禁止确认放置 outside-base 的设备。
      const validationByEntityId = state.internalTransientState.placementValidationByEntityId;
      if (previewDrafts.some((draft) => {
        const validation = validationByEntityId[draft.id];

        return validation?.reasons.some((reason) => reason.code === "outside-base") ?? false;
      })) {
        return false;
      }

      // 构建 definition 查找表，用于物流族判定。
      const definitionMap = new Map(
        workspace.registry.entityDefinitions.map((def) => [def.id, def]),
      );

      // 找出被同一物流族设备放置替换的文档实体（仅单设备放置参与替换）。
      const replacementTargets = resolvePlacementReplacementTargets({
        previewDrafts,
        currentEntities: currentDocument.entities,
        definitionMap,
        registryQueries: workspace.registry.queries,
      });
      const replacedEntityIds = new Set(Object.keys(replacementTargets));

      // 蓝图包含协议核心时，标记当前文档中的协议核心为被替换实体，
      // 使其在同一 commit 内被移除，避免出现两个协议核心。
      const previewHasProtocolCore = previewDrafts.some(
        (draft) => workspace.registry.queries.isProtocolCore(draft.definitionId),
      );
      if (previewHasProtocolCore) {
        for (const [entityId, entity] of Object.entries(currentDocument.entities)) {
          if (workspace.registry.queries.isProtocolCore(entity.definitionId)) {
            replacedEntityIds.add(entityId);
          }
        }
      }

      const nextEntities = { ...currentDocument.entities };
      // 从 entities 中删除被替换的旧实体。
      for (const targetId of replacedEntityIds) {
        delete nextEntities[targetId];
      }
      // 从 entityOrder 中移除被替换的旧实体，并对历史累积的重复条目做去重。
      const nextEntityOrder = Array.from(new Set(
        currentDocument.entityOrder.filter(
          (id) => !replacedEntityIds.has(id),
        ),
      ));
      // 移除指向被替换实体的 slotLinks。
      const nextSlotLinks = currentDocument.slotLinks.filter(
        (link) =>
          !replacedEntityIds.has(link.source.entityId)
          && !replacedEntityIds.has(link.target.entityId),
      );

      // 替换 entity ID：基于文档现有实体 + 本次已分配 ID，按 definitionId 重新分配最终 ID。
      const oldIdToNewId = new Map<string, string>();
      const newlyAllocatedIds = new Set<string>();
      const existingDocumentIds = new Set(Object.keys(currentDocument.entities));

      for (const draft of previewDrafts) {
        const newId = generateFinalEntityId(
          draft.definitionId,
          existingDocumentIds,
          newlyAllocatedIds,
        );
        oldIdToNewId.set(draft.id, newId);
      }

      for (const draft of previewDrafts) {
        const newId = oldIdToNewId.get(draft.id) ?? draft.id;

        // AI-CORRECTION 2026-06-09: config 中不再存储 entity ID 引用（links 已迁移至 document.slotLinks），
        // 不再需要 rewriteEntityIdInConfig 重写。
        const nextConfig = { ...draft.config };

        nextEntities[newId] = {
          id: newId,
          definitionId: draft.definitionId,
          position: { ...draft.position },
          rotation: draft.rotation,
          config: nextConfig,
          tags: [...draft.tags],
        };
        // 2026-05-31: 防御 entityOrder 重复——若已存在则跳过。
        if (!nextEntityOrder.includes(newId)) {
          nextEntityOrder.push(newId);
        }
      }

      if (state.internalTransientState.placementDraftSlotLinks !== null) {
        nextSlotLinks.push(
          ...state.internalTransientState.placementDraftSlotLinks.map((link) =>
            rewriteSlotLinkEntityIds(link, oldIdToNewId),
          ),
        );
      }

      // AI-CORRECTION 2026-05-24: 必须在 documentWriter.commit 之前清除 placement state，
      // 因为 commit → setSnapshot → notify 会同步触发 hookPlacementValidation，
      // 而 syncPlacementValidationState 的 resolveValidationEntries 会包含 state.drafts。
      // 如果 drafts 未清除，预览 draft 会与刚放置的正式实体位置重叠，导致两者都被打入
      // invalidPlacement collection，进而被 resolveSimulationCompileDocument 过滤掉，
      // 最终导致仿真拓扑缺失该实体（如供电桩），触发 "运行中放置供电桩不生效" 的 bug。
      const historyAction = state.internalTransientState.placementHistoryAction
        ?? createPlacementHistoryAction(previewDrafts);
      clearPlacementState(state);

      const committedDocument = documentWriter.commit({
        action: historyAction,
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          entities: nextEntities,
          entityOrder: nextEntityOrder,
          slotLinks: nextSlotLinks,
        }),
      });

      syncPlacementValidationState({
        document: committedDocument ?? document.getSnapshot(),
        state,
        workspace,
      });
      return true;
    }),

    cancelPlacementDraft: action(() => {
      clearPlacementState(state);
      syncPlacementValidationState({
        document: document.getSnapshot(),
        state,
        workspace,
      });
    }),
  };
}

function resolvePlacementDraftPosition(options: {
  centerGridPoint: GridPoint;
  footprint: GridRectSize;
}): GridPoint {
  const centerOffset = {
    x: resolvePlacementCenterOffset(options.footprint.width),
    y: resolvePlacementCenterOffset(options.footprint.height),
  };

  return {
    x: options.centerGridPoint.x - centerOffset.x,
    y: options.centerGridPoint.y - centerOffset.y,
  };
}

function resolvePlacementCenterOffset(size: number): number {
  return Math.floor((size - 1) / 2);
}

function resolveBaseDefinition(
  baseId: string,
  baseDefinitions: EditorActionsContext["workspace"]["registry"]["baseDefinitions"],
) {
  return baseDefinitions.find((definition) => definition.id === baseId) ?? null;
}

const PLACEMENT_SELF = "[Self]";

function expandPlacementDefaults(
  defaults: EntityPlacementDefaults,
  entityId: string,
): { config: Record<string, unknown>; slotLinks: SlotLinkDefinition[] } {
  return {
    config: defaults.config ? { ...defaults.config } : {},
    slotLinks: (defaults.slotLinks ?? []).map((link) => ({
      ...link,
      id: link.id.replaceAll(PLACEMENT_SELF, entityId),
      source: {
        ...link.source,
        entityId: link.source.entityId.replaceAll(PLACEMENT_SELF, entityId),
      },
    })),
  };
}

function clearPlacementState(state: EditorActionsContext["state"]): void {
  const preview = state.collections[EntityCollectionType.preview];
  const previewDraftIds = [...preview];

  state.drafts = state.drafts.filter((entity) => !previewDraftIds.includes(entity.id));
  preview.replace([]);
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementDraftEntityIdMap = null;
  state.internalTransientState.placementOriginEntityIds = null;
  state.internalTransientState.placementHistoryAction = null;
}

function replacePreviewDrafts(options: {
  drafts: readonly DraftEntity[];
  previewDraftIds: readonly string[];
  nextPreviewDrafts: readonly DraftEntity[];
}): DraftEntity[] {
  const previewDraftIdSet = new Set(options.previewDraftIds);

  return [
    ...options.drafts.filter((entity) => !previewDraftIdSet.has(entity.id)),
    ...options.nextPreviewDrafts,
  ];
}

function resolvePreviewDrafts(options: {
  previewDraftIds: readonly string[];
  drafts: readonly DraftEntity[];
}): DraftEntity[] {
  const draftMap = new Map(options.drafts.map((entity) => [entity.id, entity]));
  const previewDrafts: DraftEntity[] = [];

  for (const draftId of options.previewDraftIds) {
    const draft = draftMap.get(draftId);

    if (draft === undefined) {
      continue;
    }

    previewDrafts.push(draft);
  }

  return previewDrafts;
}

function generatePlacementDraftId(
  definitionId: string,
  counter: number,
  reservedIds: Set<string>,
): string {
  const baseId = `placement-draft:${definitionId}`;
  let nextId = `${baseId}:${counter}`;

  while (reservedIds.has(nextId)) {
    nextId = `${baseId}:${++counter}`;
  }

  reservedIds.add(nextId);
  return nextId;
}

/**
 * 基于文档现有实体 ID 和本次已分配 ID，为指定 definitionId 生成不冲突的最终实体 ID。
 *
 * 格式：`definitionId:N`，N 为当前最大值 +1（从 1 开始）。
 *
 * @param definitionId 设备定义 ID，如 "item_port_storager_1"
 * AI-CORRECTION 2026-07-19: 当前无前缀示例为 "storager_1"；上行保留迁移前 ID 作历史审计。
 * @param existingDocumentIds 提交前文档快照中所有实体 ID 的集合
 * @param newlyAllocatedIds 本次 commit 中已分配的最终 ID 集合（防止同一批 draft 内冲突）
 */
function generateFinalEntityId(
  definitionId: string,
  existingDocumentIds: ReadonlySet<string>,
  newlyAllocatedIds: Set<string>,
): string {
  const prefix = `${definitionId}:`;
  let maxCounter = 0;

  for (const id of existingDocumentIds) {
    if (id.startsWith(prefix)) {
      const num = parseInt(id.slice(prefix.length), 10);

      if (!isNaN(num) && num > maxCounter) {
        maxCounter = num;
      }
    }
  }

  for (const id of newlyAllocatedIds) {
    if (id.startsWith(prefix)) {
      const num = parseInt(id.slice(prefix.length), 10);

      if (!isNaN(num) && num > maxCounter) {
        maxCounter = num;
      }
    }
  }

  const newId = `${prefix}${maxCounter + 1}`;

  newlyAllocatedIds.add(newId);
  return newId;
}

/**
 * 替换 slotLink 中 source / target 的 entityId。
 */
function rewriteSlotLinkEntityIds(
  link: SlotLinkDefinition,
  oldIdToNewId: ReadonlyMap<string, string>,
): SlotLinkDefinition {
  const newSourceId = oldIdToNewId.get(link.source.entityId) ?? link.source.entityId;
  const newTargetId = oldIdToNewId.get(link.target.entityId) ?? link.target.entityId;

  if (newSourceId === link.source.entityId && newTargetId === link.target.entityId) {
    return link;
  }

  return {
    ...link,
    source: { ...link.source, entityId: newSourceId },
    target: { ...link.target, entityId: newTargetId },
  };
}

function cloneWorldEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    position: {
      ...entity.position,
    },
    config: {
      ...entity.config,
    },
    tags: [...entity.tags],
  };
}

function createPlacementHistoryAction(
  previewDrafts: readonly DraftEntity[],
) {
  return {
    type: "entity.place" as const,
    label: "放置设备",
    entityIds: previewDrafts.map((draft) => draft.id),
    definitionIds: resolveUniqueStrings(
      previewDrafts.map((draft) => draft.definitionId),
    ),
    count: previewDrafts.length,
  };
}

function resolveUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
  return {
    ...slotLink,
    source: {
      ...slotLink.source,
    },
    target: {
      ...slotLink.target,
    },
  };
}

/**
 * 蓝图放置时解析 slotLink 端点的 entityId。
 * - 在 entityIdMap 中 → 替换为 draft ID
 * - 是全球哨兵（warehouse / base-builtin） → 保留原值
 * - 其他（蓝图外部引用） → 返回 null，整个 link 被丢弃
 */
function resolveSlotLinkEntityIdForPlacement(
  entityId: string,
  entityIdMap: ReadonlyMap<string, string>,
): string | null {
  const draftId = entityIdMap.get(entityId);
  if (draftId !== undefined) {
    return draftId;
  }
  // AI-CORRECTION 2026-06-10: warehouse 和 base-builtin 哨兵不在 blueprint entities 中，
  // 但必须保留——否则取货口/暗管出口的仓库链接会被丢弃。
  if (entityId === "warehouse" || entityId.startsWith("warehouse:") || entityId.startsWith("base-builtin:")) {
    return entityId;
  }
  return null;
}

/**
 * 解析物流族标签，返回 "belt" | "pipe" | null。
 * 与 placement-validation.ts 中的同名函数保持语义一致。
 * AI-CORRECTION 2026-07-27: 当前返回 registry 物流族类型，不再解析 tag；
 * 字面值由 LOGISTICS_KIND 统一提供。
 */
function resolveLogisticsKind(
  definition: EntityDefinition,
  registryQueries: RegistryQuery,
): LogisticsKind | null {
  // AI-CORRECTION 2026-07-27: 物流族由 RegistryQuery 判定，不再读取 BeltFamily / PipeFamily tag。
  if (registryQueries.isBeltFamily(definition.id)) {
    return LOGISTICS_KIND.belt;
  }

  if (registryQueries.isPipeFamily(definition.id)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

/**
 * 找出应被放置替换的现有文档实体。
 *
 * 仅单设备 placement draft 参与替换：
 *   - previewDrafts 必须恰好有 1 个，且其 id 以 "placement-draft:" 开头
 *   - 该 draft 覆盖的文档实体与之属于同一物流族（BeltFamily / PipeFamily）
 *     AI-CORRECTION 2026-07-27: 同族关系由 isBeltFamily / isPipeFamily Query 判定。
 *   - 两者占据的 grid rect 完全相同
 *
 * 蓝图放置（多个 previewDrafts）不会被此函数处理，避免批量误删。
 */
function resolvePlacementReplacementTargets(options: {
  previewDrafts: readonly DraftEntity[];
  currentEntities: Record<string, WorldEntity>;
  definitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
}): Record<string, WorldEntity> {
  // 仅单设备放置参与替换。
  if (options.previewDrafts.length !== 1) {
    return {};
  }

  const draft = options.previewDrafts[0];
  if (draft === undefined || !draft.id.startsWith("placement-draft:")) {
    return {};
  }

  const draftDef = options.definitionMap.get(draft.definitionId);
  if (draftDef === undefined) {
    return {};
  }

  const draftFamily = resolveLogisticsKind(draftDef, options.registryQueries);
  if (draftFamily === null) {
    return {};
  }

  const result: Record<string, WorldEntity> = {};

  for (const [entityId, entity] of Object.entries(options.currentEntities)) {
    // 与 draft 位置不同，跳过。
    if (
      entity.position.x !== draft.position.x
      || entity.position.y !== draft.position.y
    ) {
      continue;
    }

    const entityDef = options.definitionMap.get(entity.definitionId);
    if (entityDef === undefined) {
      continue;
    }

    if (resolveLogisticsKind(entityDef, options.registryQueries) !== draftFamily) {
      continue;
    }

    result[entityId] = entity;
  }

  return result;
}
