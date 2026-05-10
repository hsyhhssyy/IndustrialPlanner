import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import type {
  EditorHistoryDocumentDelta,
  EditorHistoryValueChange,
} from "@/domain/editor/editor-history";

export function createWorldDocumentDelta(
  before: WorldDocument,
  after: WorldDocument,
): EditorHistoryDocumentDelta | null {
  const entityDelta = createEntityDelta(before.entities, after.entities);
  const entityOrder = areStringArraysEqual(before.entityOrder, after.entityOrder)
    ? null
    : {
      before: [...before.entityOrder],
      after: [...after.entityOrder],
    };
  const slotLinks = areJsonEqual(before.slotLinks, after.slotLinks)
    ? null
    : {
      before: before.slotLinks.map(cloneSlotLinkDefinition),
      after: after.slotLinks.map(cloneSlotLinkDefinition),
    };
  const documentSettings = createDocumentSettingsDelta(
    before.documentSettings,
    after.documentSettings,
  );

  if (
    Object.keys(entityDelta.added).length === 0
    && Object.keys(entityDelta.removed).length === 0
    && Object.keys(entityDelta.updated).length === 0
    && entityOrder === null
    && slotLinks === null
    && Object.keys(documentSettings).length === 0
  ) {
    return null;
  }

  return {
    entities: entityDelta,
    entityOrder,
    slotLinks,
    documentSettings,
  };
}

export function applyWorldDocumentDelta(
  document: WorldDocument,
  delta: EditorHistoryDocumentDelta,
  direction: "forward" | "inverse",
): WorldDocument {
  const nextEntities = { ...document.entities };

  if (direction === "forward") {
    for (const entityId of Object.keys(delta.entities.removed)) {
      delete nextEntities[entityId];
    }

    for (const [entityId, change] of Object.entries(delta.entities.updated)) {
      nextEntities[entityId] = cloneWorldEntity(change.after);
    }

    for (const [entityId, entity] of Object.entries(delta.entities.added)) {
      nextEntities[entityId] = cloneWorldEntity(entity);
    }
  } else {
    for (const entityId of Object.keys(delta.entities.added)) {
      delete nextEntities[entityId];
    }

    for (const [entityId, change] of Object.entries(delta.entities.updated)) {
      nextEntities[entityId] = cloneWorldEntity(change.before);
    }

    for (const [entityId, entity] of Object.entries(delta.entities.removed)) {
      nextEntities[entityId] = cloneWorldEntity(entity);
    }
  }

  const entityOrderChange = delta.entityOrder;
  const slotLinksChange = delta.slotLinks;
  const nextDocumentSettings = {
    ...document.documentSettings,
  };

  for (const [key, change] of Object.entries(delta.documentSettings)) {
    const nextValue = direction === "forward" ? change.after : change.before;

    if (nextValue === undefined) {
      delete nextDocumentSettings[key];
      continue;
    }

    nextDocumentSettings[key] = cloneJsonValue(nextValue);
  }

  return {
    ...document,
    entities: nextEntities,
    entityOrder: entityOrderChange === null
      ? document.entityOrder
      : [...(direction === "forward" ? entityOrderChange.after : entityOrderChange.before)],
    slotLinks: slotLinksChange === null
      ? document.slotLinks
      : (direction === "forward" ? slotLinksChange.after : slotLinksChange.before)
        .map(cloneSlotLinkDefinition),
    documentSettings: nextDocumentSettings,
  };
}

function createEntityDelta(
  before: WorldDocument["entities"],
  after: WorldDocument["entities"],
): EditorHistoryDocumentDelta["entities"] {
  const added: Record<string, WorldEntity> = {};
  const removed: Record<string, WorldEntity> = {};
  const updated: Record<string, EditorHistoryValueChange<WorldEntity>> = {};
  const entityIds = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);

  for (const entityId of entityIds) {
    const beforeEntity = before[entityId];
    const afterEntity = after[entityId];

    if (beforeEntity === undefined && afterEntity !== undefined) {
      added[entityId] = cloneWorldEntity(afterEntity);
      continue;
    }

    if (beforeEntity !== undefined && afterEntity === undefined) {
      removed[entityId] = cloneWorldEntity(beforeEntity);
      continue;
    }

    if (
      beforeEntity !== undefined
      && afterEntity !== undefined
      && !areJsonEqual(beforeEntity, afterEntity)
    ) {
      updated[entityId] = {
        before: cloneWorldEntity(beforeEntity),
        after: cloneWorldEntity(afterEntity),
      };
    }
  }

  return {
    added,
    removed,
    updated,
  };
}

function createDocumentSettingsDelta(
  before: WorldDocument["documentSettings"],
  after: WorldDocument["documentSettings"],
): Record<string, EditorHistoryValueChange<unknown>> {
  const changes: Record<string, EditorHistoryValueChange<unknown>> = {};
  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);

  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (areJsonEqual(beforeValue, afterValue)) {
      continue;
    }

    changes[key] = {
      before: cloneJsonValue(beforeValue),
      after: cloneJsonValue(afterValue),
    };
  }

  return changes;
}

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function areJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneWorldEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    position: {
      ...entity.position,
    },
    config: cloneJsonValue(entity.config),
    tags: [...entity.tags],
  };
}

function cloneSlotLinkDefinition(
  slotLink: SlotLinkDefinition,
): SlotLinkDefinition {
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

function cloneJsonValue<TValue>(value: TValue): TValue {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}
