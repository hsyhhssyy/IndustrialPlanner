import type { GridPoint, GridRotation } from "@/shared/geometry/grid";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";

export interface MoveDraftState {
  entityId: string;
  interactionMode: PlacementInteractionMode;
  originGridPoint: GridPoint;
  gridPoint: GridPoint;
  rotation: GridRotation;
  valid: boolean;
  anchorWorldOffset: {
    x: number;
    y: number;
  };
}

export function isSameMoveDraftState(
  left: MoveDraftState | null,
  right: MoveDraftState | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.entityId === right.entityId &&
    left.interactionMode === right.interactionMode &&
    left.rotation === right.rotation &&
    left.valid === right.valid &&
    left.originGridPoint.x === right.originGridPoint.x &&
    left.originGridPoint.y === right.originGridPoint.y &&
    left.gridPoint.x === right.gridPoint.x &&
    left.gridPoint.y === right.gridPoint.y &&
    left.anchorWorldOffset.x === right.anchorWorldOffset.x &&
    left.anchorWorldOffset.y === right.anchorWorldOffset.y
  );
}
