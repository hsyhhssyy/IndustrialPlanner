import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import type { DraftEntity } from "../draft-entity";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRectSize } from "@/domain/shared/grid";
import { createUuid } from "@/domain/shared/uuid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { isBaseBuiltinEntityId } from "@/domain/registry/types/base-definition";

import { syncPlacementValidationState } from "../placement-validation";
import { syncPoweredEntityCollection } from "./powered-collection";
import { action } from "mobx";
import type { EditorActionsContext } from "./types";

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
      const reservedIds = new Set<string>([
        ...Object.keys(currentDocument.entities),
        ...state.drafts.map((entity) => entity.id),
      ]);

      const nextDraftId = generatePlacementDraftId(
        deviceDefinitionId,
        ++placementDraftCounter,
        reservedIds,
      );

      const draft: DraftEntity = {
        id: nextDraftId,
        definitionId: deviceDefinitionId,
        position: resolvePlacementDraftPosition({
          centerGridPoint,
          footprint: definition.footprint,
        }),
        rotation: 0,
        config: {},
        tags: [],
        originalEntityId: nextDraftId,
      };

      state.drafts = replacePreviewDrafts({
        drafts: state.drafts,
        previewDraftIds: preview,
        nextPreviewDrafts: [draft],
      });
      preview.replace([draft.id]);
      state.internalTransientState.placementDraftSlotLinks = null;
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
      const reservedIds = new Set<string>([
        ...Object.keys(currentDocument.entities),
        ...state.drafts.map((entity) => entity.id),
      ]);
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
      state.internalTransientState.placementDraftSlotLinks = blueprint.slotLinks.flatMap((slotLink) => {
        const sourceEntityId = entityIdMap.get(slotLink.source.entityId);
        const targetEntityId = entityIdMap.get(slotLink.target.entityId);

        if (sourceEntityId === undefined || targetEntityId === undefined) {
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
      // 从 entityOrder 中移除被替换的旧实体。
      const nextEntityOrder = currentDocument.entityOrder.filter(
        (id) => !replacedEntityIds.has(id),
      );
      // 移除指向被替换实体的 slotLinks。
      const nextSlotLinks = currentDocument.slotLinks.filter(
        (link) =>
          !replacedEntityIds.has(link.source.entityId)
          && !replacedEntityIds.has(link.target.entityId),
      );

      // 替换 entity ID：去掉 "placement-draft:" 前缀后成为正式实体 ID。
      const oldIdToNewId = new Map<string, string>();
      for (const draft of previewDrafts) {
        const newId = draft.id.startsWith("placement-draft:")
          ? draft.id.slice("placement-draft:".length)
          : draft.id;
        oldIdToNewId.set(draft.id, newId);
      }

      // 构建完整 ID 映射：原始蓝图 entity ID → 最终正式 ID
      // entityIdMap 来自 createBlueprintPlacementDraft 中存储的 原始ID → draftID 映射
      const entityIdMap = state.internalTransientState.placementDraftEntityIdMap;
      const originalIdToFinalId = new Map<string, string>();
      if (entityIdMap !== null) {
        for (const [originalId, draftId] of entityIdMap) {
          const finalId = oldIdToNewId.get(draftId);
          if (finalId !== undefined) {
            originalIdToFinalId.set(originalId, finalId);
          }
        }
      }

      for (const draft of previewDrafts) {
        const newId = oldIdToNewId.get(draft.id) ?? draft.id;

        // 重写 entity.config 中的 entity ID 引用（如 links[N].source.entityId）。
        const nextConfig = rewriteEntityIdInConfig({
          config: draft.config,
          originalIdToFinalId,
          documentEntityIds: new Set(Object.keys(currentDocument.entities)),
        });

        nextEntities[newId] = {
          id: newId,
          definitionId: draft.definitionId,
          position: { ...draft.position },
          rotation: draft.rotation,
          config: nextConfig,
          tags: [...draft.tags],
        };
        nextEntityOrder.push(newId);
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

      if (committedDocument !== null) {
        syncPoweredEntityCollection({
          document: committedDocument,
          state,
          workspace,
        });
      }

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

function clearPlacementState(state: EditorActionsContext["state"]): void {
  const preview = state.collections[EntityCollectionType.preview];
  const previewDraftIds = [...preview];

  state.drafts = state.drafts.filter((entity) => !previewDraftIds.includes(entity.id));
  preview.replace([]);
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementDraftEntityIdMap = null;
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
 * 在蓝图放置时重写 entity.config 中的 entity ID 引用。
 *
 * 规则（按优先级）：
 *   1. 值在 originalIdToFinalId 映射中 → 替换为新的最终 ID（蓝图内实体间的引用）
 *   2. 值为 "warehouse" 或以 "warehouse:" 开头 → 保留（全球仓库哨兵）
 *   3. 值为 base-builtin 格式（"base-builtin:*"） → 保留（每个基地都有的形式化实体）
 *   4. 值在 document.entityIds 中但不在映射中 → 断连为 ""（指向蓝图外的普通实体）
 *   5. 其他 → 保持原值（如 storageSlotGroupId、slotId 等非 entity ID 配置值）
 *
 * @param config 原始设备 config
 * @param originalIdToFinalId 原始蓝图实体 ID → 最终正式实体 ID 的映射
 * @param documentEntityIds 当前文档中所有实体 ID 的集合
 */
function rewriteEntityIdInConfig(options: {
  config: Record<string, unknown>;
  originalIdToFinalId: ReadonlyMap<string, string>;
  documentEntityIds: ReadonlySet<string>;
}): Record<string, unknown> {
  const { config, originalIdToFinalId, documentEntityIds } = options;
  let didChange = false;
  const nextConfig: Record<string, unknown> = { ...config };

  for (const [key, value] of Object.entries(nextConfig)) {
    if (typeof value !== "string") {
      continue;
    }

    let nextValue: string | undefined;

    if (originalIdToFinalId.has(value)) {
      // 规则 1：蓝图内引用 → 替换为最终 ID
      nextValue = originalIdToFinalId.get(value);
    } else if (value === "warehouse" || value.startsWith("warehouse:")) {
      // 规则 2：仓库哨兵 → 保留
      continue;
    } else if (isBaseBuiltinEntityId(value)) {
      // 规则 3：base-builtin → 保留
      continue;
    } else if (documentEntityIds.has(value)) {
      // 规则 4：文档中存在但不属于蓝图 → 断连
      nextValue = "";
    }
    // 规则 5：不在任何规则命中 → 保持原值

    if (nextValue !== undefined && nextValue !== value) {
      nextConfig[key] = nextValue;
      didChange = true;
    }
  }

  return didChange ? nextConfig : config;
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
 * 解析物流族标签，返回 "belt" | "pipe" | null。
 * 与 placement-validation.ts 中的同名函数保持语义一致。
 */
function resolveLogisticsFamilyTag(
  definition: EntityDefinition,
): "belt" | "pipe" | null {
  if (definition.tags.includes("BeltFamily")) {
    return "belt";
  }

  if (definition.tags.includes("PipeFamily")) {
    return "pipe";
  }

  return null;
}

/**
 * 找出应被放置替换的现有文档实体。
 *
 * 仅单设备 placement draft 参与替换：
 *   - previewDrafts 必须恰好有 1 个，且其 id 以 "placement-draft:" 开头
 *   - 该 draft 覆盖的文档实体与之属于同一物流族（BeltFamily / PipeFamily）
 *   - 两者占据的 grid rect 完全相同
 *
 * 蓝图放置（多个 previewDrafts）不会被此函数处理，避免批量误删。
 */
function resolvePlacementReplacementTargets(options: {
  previewDrafts: readonly DraftEntity[];
  currentEntities: Record<string, WorldEntity>;
  definitionMap: ReadonlyMap<string, EntityDefinition>;
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

  const draftFamily = resolveLogisticsFamilyTag(draftDef);
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

    if (resolveLogisticsFamilyTag(entityDef) !== draftFamily) {
      continue;
    }

    result[entityId] = entity;
  }

  return result;
}
