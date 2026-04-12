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