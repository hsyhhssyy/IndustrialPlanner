import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";

export function prepareCurrentSimulationDocument(options: {
  readonly document: WorldDocument;
  readonly workspace: WorkspaceContract;
}): WorldDocument {
  const invalidPlacementCollection =
    options.workspace.editor?.state?.collections?.[EntityCollectionType.invalidPlacement];
  if (invalidPlacementCollection === undefined || invalidPlacementCollection.length === 0) {
    return appendSimulationBaseBuiltinEntities(options);
  }

  const invalidEntityIds = new Set(
    invalidPlacementCollection.filter((entityId) =>
      options.document.entities[entityId] !== undefined,
    ),
  );
  if (invalidEntityIds.size === 0) {
    return appendSimulationBaseBuiltinEntities(options);
  }

  const nextEntities = { ...options.document.entities };
  for (const entityId of invalidEntityIds) {
    delete nextEntities[entityId];
  }

  return appendSimulationBaseBuiltinEntities({
    workspace: options.workspace,
    document: {
      ...options.document,
      entities: nextEntities,
      entityOrder: options.document.entityOrder.filter((entityId) =>
        !invalidEntityIds.has(entityId),
      ),
      slotLinks: options.document.slotLinks.filter((slotLink) =>
        !invalidEntityIds.has(slotLink.source.entityId)
        && !invalidEntityIds.has(slotLink.target.entityId),
      ),
    },
  });
}

export function appendSimulationBaseBuiltinEntities(options: {
  readonly document: WorldDocument;
  readonly workspace: WorkspaceContract;
}): WorldDocument {
  const builtinEntities = resolveBaseBuiltinEntities({
    baseDefinitions: options.workspace.registry.baseDefinitions,
    baseId: options.document.baseId,
  });
  if (builtinEntities.length === 0) {
    return options.document;
  }

  const builtinEntityIds = new Set(builtinEntities.map((entity) => entity.id));
  const nextEntities = { ...options.document.entities };
  for (const entity of builtinEntities) {
    nextEntities[entity.id] = entity;
  }

  return {
    ...options.document,
    entities: nextEntities,
    entityOrder: [
      ...builtinEntities.map((entity) => entity.id),
      ...options.document.entityOrder.filter((entityId) => !builtinEntityIds.has(entityId)),
    ],
  };
}
