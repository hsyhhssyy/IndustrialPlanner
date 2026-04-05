import type { GridPoint, GridRotation } from "@/shared/geometry/grid";

export type PlacementInteractionMode = "pointer" | "touch";

export interface PlacementPreviewState {
  definitionId: string;
  interactionMode: PlacementInteractionMode;
  gridPoint: GridPoint;
  rotation: GridRotation;
  valid: boolean;
}

export function isSamePlacementPreviewState(
  left: PlacementPreviewState | null,
  right: PlacementPreviewState | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.definitionId === right.definitionId &&
    left.interactionMode === right.interactionMode &&
    left.rotation === right.rotation &&
    left.valid === right.valid &&
    left.gridPoint.x === right.gridPoint.x &&
    left.gridPoint.y === right.gridPoint.y
  );
}
