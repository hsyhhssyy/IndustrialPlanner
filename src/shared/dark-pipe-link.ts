import type { ActiveTool } from "@/domain/app/types/app-types";
import type {
  CacheLinkEndpointDefinition,
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
// AI-REMOVED 2026-08-19:
// Reason: 暗管入口不再通过 recipe channel 销毁流体，创建直连无需读取 EntityDefinition 生成 manualRecipeOnly 配置。
// Trigger: 用户明确要求暗管入口在所有仿真模式下提交仓库并抛弃销毁机制。
// Evidence: getDarkPipeManualRecipeOnlyPatch 已退出，文件内不再消费 EntityDefinition。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

export type DarkPipeRole = "inlet" | "outlet";

export const DARK_PIPE_LINK_TOOL: ActiveTool = "dark-pipe-link";

export const DARK_PIPE_INLET_DEFINITION_IDS = [
  "udpipe_loader_1",
  "udpipe_loader_2",
] as const;

export const DARK_PIPE_OUTLET_DEFINITION_IDS = [
  "udpipe_unloader_1",
  "udpipe_unloader_2",
] as const;

export const DARK_PIPE_INLET_STORAGE_GROUP_ID = "loader_buffer";
export const DARK_PIPE_OUTLET_STORAGE_GROUP_ID = "unloader_buffer";
export const DARK_PIPE_SLOT_ID = "slot_1";
export const DARK_PIPE_LINK_ID_PREFIX = "dark-pipe-link:";

const DARK_PIPE_INLET_DEFINITION_ID_SET = new Set<string>(DARK_PIPE_INLET_DEFINITION_IDS);
const DARK_PIPE_OUTLET_DEFINITION_ID_SET = new Set<string>(DARK_PIPE_OUTLET_DEFINITION_IDS);

export function resolveDarkPipeRole(definitionId: string): DarkPipeRole | null {
  if (DARK_PIPE_INLET_DEFINITION_ID_SET.has(definitionId)) {
    return "inlet";
  }
  if (DARK_PIPE_OUTLET_DEFINITION_ID_SET.has(definitionId)) {
    return "outlet";
  }
  return null;
}

export function isDarkPipeDefinitionId(definitionId: string): boolean {
  return resolveDarkPipeRole(definitionId) !== null;
}

export function resolveOppositeDarkPipeRole(role: DarkPipeRole): DarkPipeRole {
  return role === "inlet" ? "outlet" : "inlet";
}

export function resolveDarkPipeEndpoint(entity: Pick<WorldEntity, "id" | "definitionId">): CacheLinkEndpointDefinition | null {
  const role = resolveDarkPipeRole(entity.definitionId);
  if (role === null) {
    return null;
  }

  return {
    entityId: entity.id,
    storageSlotGroupId: role === "inlet" ? DARK_PIPE_INLET_STORAGE_GROUP_ID : DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
    slotId: DARK_PIPE_SLOT_ID,
  };
}

export function createDarkPipeSlotLink(options: {
  inletEntityId: string;
  outletEntityId: string;
}): SlotLinkDefinition {
  return {
    id: `${DARK_PIPE_LINK_ID_PREFIX}${options.outletEntityId}:${options.inletEntityId}`,
    linkType: "share-all",
    source: {
      entityId: options.outletEntityId,
      storageSlotGroupId: DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
      slotId: DARK_PIPE_SLOT_ID,
    },
    target: {
      entityId: options.inletEntityId,
      storageSlotGroupId: DARK_PIPE_INLET_STORAGE_GROUP_ID,
      slotId: DARK_PIPE_SLOT_ID,
    },
  };
}

export function isDarkPipeSlotLink(
  link: SlotLinkDefinition,
  entities: Readonly<Record<string, WorldEntity>>,
): boolean {
  if (link.linkType !== "share-all") {
    return false;
  }

  const sourceEntity = entities[link.source.entityId];
  const targetEntity = entities[link.target.entityId];
  if (sourceEntity === undefined || targetEntity === undefined) {
    return false;
  }

  return resolveDarkPipeRole(sourceEntity.definitionId) === "outlet"
    && resolveDarkPipeRole(targetEntity.definitionId) === "inlet"
    && link.source.storageSlotGroupId === DARK_PIPE_OUTLET_STORAGE_GROUP_ID
    && link.source.slotId === DARK_PIPE_SLOT_ID
    && link.target.storageSlotGroupId === DARK_PIPE_INLET_STORAGE_GROUP_ID
    && link.target.slotId === DARK_PIPE_SLOT_ID;
}

export function findDarkPipeSlotLinkForEntity(
  document: Pick<WorldDocument, "entities" | "slotLinks">,
  entityId: string,
): SlotLinkDefinition | null {
  return document.slotLinks.find((link) =>
    isDarkPipeSlotLink(link, document.entities)
    && (link.source.entityId === entityId || link.target.entityId === entityId),
  ) ?? null;
}

export function isEntityInDarkPipeLink(
  document: Pick<WorldDocument, "entities" | "slotLinks">,
  entityId: string,
): boolean {
  return findDarkPipeSlotLinkForEntity(document, entityId) !== null;
}

export function listDarkPipeLinkCandidateEntityIds(options: {
  document: Pick<WorldDocument, "entities" | "entityOrder" | "slotLinks">;
  sourceEntity: WorldEntity;
}): string[] {
  const sourceRole = resolveDarkPipeRole(options.sourceEntity.definitionId);
  if (sourceRole === null || isEntityInDarkPipeLink(options.document, options.sourceEntity.id)) {
    return [];
  }

  const targetRole = resolveOppositeDarkPipeRole(sourceRole);
  return options.document.entityOrder.filter((entityId) => {
    const entity = options.document.entities[entityId];
    if (entity === undefined || entity.id === options.sourceEntity.id) {
      return false;
    }
    if (resolveDarkPipeRole(entity.definitionId) !== targetRole) {
      return false;
    }
    return !isEntityInDarkPipeLink(options.document, entity.id);
  });
}

export function resolveDarkPipeLinkedEntityId(
  document: Pick<WorldDocument, "entities" | "slotLinks">,
  entityId: string,
): string | null {
  const link = findDarkPipeSlotLinkForEntity(document, entityId);
  if (link === null) {
    return null;
  }
  return link.source.entityId === entityId ? link.target.entityId : link.source.entityId;
}

// AI-REMOVED 2026-08-19:
// Reason: manualRecipeOnly 只用于暗管直连时停用隐藏销毁配方；销毁配方退出后不应继续写入无效配置。
// Trigger: 用户明确要求暗管入口在所有仿真模式下提交仓库并抛弃销毁机制。
// Evidence: udpipe_loader_1/2 的 recipeChannels 现为空，未直连入仓由 warehouse-sink-when-unlinked behavior 决定。
// Replacement: createEditorDarkPipeLinkActions 创建链接时直接清空入口遗留 config。
// Risk: 旧文档中的 manualRecipeOnly 键仍可被读取，但不会参与任何 channel 编译。
// Human Review: Required
//
// Original code:
// export function getDarkPipeManualRecipeOnlyPatch(definition: EntityDefinition): Record<string, true> {
//   const role = resolveDarkPipeRole(definition.id);
//   if (role !== "inlet") {
//     return {};
//   }
//
//   return Object.fromEntries(
//     definition.recipeChannels.map((_, index) => [
//       `recipeChannels[${index}].manualRecipeOnly`,
//       true,
//     ]),
//   );
// }
