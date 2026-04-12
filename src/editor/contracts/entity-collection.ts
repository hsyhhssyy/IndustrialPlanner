import type { WorldEntity } from "@/domain/document/world-document";
import type { GridBounds } from "@/shared/geometry/grid";

export type RotatableEntityCollectionKind = "selected" | "draft";

export interface EntityCollectionCenterCellsDerived {
  x: number;
  y: number;
}

export interface EditorEntityCollectionState {
  ids: string[];
  boundsDerived: GridBounds | null;
  geometricCenterCellsDerived: EntityCollectionCenterCellsDerived | null;
}

export interface SelectedEntitiesState extends EditorEntityCollectionState {}

export interface DraftEntityState extends WorldEntity {
  sourceEntityId: string | null;
  valid: boolean;
  invalidReason: string | null;
}

export interface DraftsState {
  entities: Record<string, DraftEntityState>;
}

export interface DraftEntitiesState extends EditorEntityCollectionState {}

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function areRecordValuesEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  if (left === right) {
    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!(key in right) || !Object.is(left[key], right[key])) {
      return false;
    }
  }

  return true;
}

export function isSameDraftEntityState(
  left: DraftEntityState,
  right: DraftEntityState,
): boolean {
  return (
    left.id === right.id &&
    left.definitionId === right.definitionId &&
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.rotation === right.rotation &&
    left.sourceEntityId === right.sourceEntityId &&
    left.valid === right.valid &&
    left.invalidReason === right.invalidReason &&
    areStringArraysEqual(left.tags, right.tags) &&
    areRecordValuesEqual(left.config, right.config)
  );
}

export function cloneDraftEntityState(entity: DraftEntityState): DraftEntityState {
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

export function isSameDraftsState(
  left: DraftsState,
  right: DraftsState,
): boolean {
  if (left === right) {
    return true;
  }

  const leftIds = Object.keys(left.entities);
  const rightIds = Object.keys(right.entities);

  if (leftIds.length !== rightIds.length) {
    return false;
  }

  for (const id of leftIds) {
    const leftEntity = left.entities[id];
    const rightEntity = right.entities[id];

    if (!leftEntity || !rightEntity || !isSameDraftEntityState(leftEntity, rightEntity)) {
      return false;
    }
  }

  return true;
}

export function cloneDraftsState(drafts: DraftsState): DraftsState {
  return {
    entities: Object.fromEntries(
      Object.entries(drafts.entities).map(([id, entity]) => [
        id,
        cloneDraftEntityState(entity),
      ]),
    ),
  };
}