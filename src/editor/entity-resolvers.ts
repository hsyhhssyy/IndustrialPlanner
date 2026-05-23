import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";

export function resolveEntityById(options: {
  entityId: string;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  baseDefinitions?: readonly BaseDefinition[];
}): WorldEntity | null {
  const entityFromDocument = options.document.entities[options.entityId];
  if (entityFromDocument !== undefined) {
    return entityFromDocument;
  }

  const entityFromDraft = options.drafts.find((entity) => entity.id === options.entityId);
  if (entityFromDraft !== undefined) {
    return entityFromDraft;
  }

  return resolveOptionalBaseBuiltinEntities(options).find((entity) =>
    entity.id === options.entityId,
  ) ?? null;
}

export function resolveListedEntities(options: {
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  baseDefinitions?: readonly BaseDefinition[];
}): readonly WorldEntity[] {
  const entities: WorldEntity[] = [...resolveOptionalBaseBuiltinEntities(options)];
  const knownEntityIds = new Set<string>(entities.map((entity) => entity.id));
  const orderedEntityIds = resolveOrderedEntityIds(options.document);

  for (const entityId of orderedEntityIds) {
    const entity = options.document.entities[entityId];

    if (entity === undefined || knownEntityIds.has(entity.id)) {
      continue;
    }

    entities.push(entity);
    knownEntityIds.add(entity.id);
  }

  for (const entity of options.drafts) {
    if (knownEntityIds.has(entity.id)) {
      continue;
    }

    entities.push(entity);
    knownEntityIds.add(entity.id);
  }

  return entities;
}

function resolveOptionalBaseBuiltinEntities(options: {
  document: WorldDocument;
  baseDefinitions?: readonly BaseDefinition[];
}): readonly WorldEntity[] {
  if (options.baseDefinitions === undefined) {
    return [];
  }

  return resolveBaseBuiltinEntities({
    baseDefinitions: options.baseDefinitions,
    baseId: options.document.baseId,
  });
}

export function resolveOrderedEntityIds(document: WorldDocument): string[] {
  const orderedEntityIds = [...document.entityOrder];
  const knownEntityIds = new Set(orderedEntityIds);

  for (const entityId of Object.keys(document.entities)) {
    if (knownEntityIds.has(entityId)) {
      continue;
    }

    orderedEntityIds.push(entityId);
  }

  return orderedEntityIds;
}
