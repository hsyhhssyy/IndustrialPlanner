import type { WorldDocument } from "@/domain/document/world-document";

export interface SimulationPatchSet {
  entityConfigByEntityId: Record<string, Record<string, unknown>>;
}

export function createEmptySimulationPatchSet(): SimulationPatchSet {
  return {
    entityConfigByEntityId: {},
  };
}

export function getSimulationEntityConfigPatch(
  patchSet: SimulationPatchSet,
  entityId: string,
): Record<string, unknown> {
  return patchSet.entityConfigByEntityId[entityId] ?? {};
}

export function applySimulationEntityConfigPatch(
  patchSet: SimulationPatchSet,
  entityId: string,
  patch: Record<string, unknown>,
): SimulationPatchSet {
  const currentEntityPatch = getSimulationEntityConfigPatch(patchSet, entityId);
  const nextEntityPatch = { ...currentEntityPatch };

  for (const [fieldKey, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete nextEntityPatch[fieldKey];
      continue;
    }

    nextEntityPatch[fieldKey] = value;
  }

  const nextEntityConfigByEntityId = {
    ...patchSet.entityConfigByEntityId,
  };

  if (Object.keys(nextEntityPatch).length === 0) {
    delete nextEntityConfigByEntityId[entityId];
  } else {
    nextEntityConfigByEntityId[entityId] = nextEntityPatch;
  }

  return {
    entityConfigByEntityId: nextEntityConfigByEntityId,
  };
}

export function resolveSimulationEntityConfig(
  document: WorldDocument,
  patchSet: SimulationPatchSet,
  entityId: string,
): Record<string, unknown> {
  const entity = document.entities[entityId];

  if (!entity) {
    return {};
  }

  return {
    ...entity.config,
    ...getSimulationEntityConfigPatch(patchSet, entityId),
  };
}
