import type { ActiveTool } from "@/domain/app/types/app-types";
import type {
  CacheLinkEndpointDefinition,
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

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

export function getDarkPipeManualRecipeOnlyPatch(definition: EntityDefinition): Record<string, true> {
  const role = resolveDarkPipeRole(definition.id);
  if (role !== "inlet") {
    return {};
  }

  return Object.fromEntries(
    definition.recipeChannels.map((_, index) => [
      `recipeChannels[${index}].manualRecipeOnly`,
      true,
    ]),
  );
}
