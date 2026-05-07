import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

export function resolveEntityById(options: {
  entityId: string;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
}): WorldEntity | null {
  const entityFromDocument = options.document.entities[options.entityId];
  if (entityFromDocument !== undefined) {
    return entityFromDocument;
  }

  return options.drafts.find((entity) => entity.id === options.entityId) ?? null;
}

export function resolveListedEntities(options: {
  document: WorldDocument;
  drafts: readonly WorldEntity[];
}): readonly WorldEntity[] {
  const entities: WorldEntity[] = [];
  const knownEntityIds = new Set<string>();
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
