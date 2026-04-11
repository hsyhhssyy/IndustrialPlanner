import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { GridBounds, GridPoint } from "@/shared/geometry/grid";

export interface MarqueeDraftState {
  interactionMode: PlacementInteractionMode;
  selectionMode: EditorSelectionUpdateMode;
  originGridPoint: GridPoint;
  gridPoint: GridPoint;
  bounds: GridBounds;
  entityIds: string[];
  baseSelection: string[];
}

export function isSameMarqueeDraftState(
  left: MarqueeDraftState | null,
  right: MarqueeDraftState | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.interactionMode === right.interactionMode &&
    left.selectionMode === right.selectionMode &&
    left.originGridPoint.x === right.originGridPoint.x &&
    left.originGridPoint.y === right.originGridPoint.y &&
    left.gridPoint.x === right.gridPoint.x &&
    left.gridPoint.y === right.gridPoint.y &&
    left.bounds.left === right.bounds.left &&
    left.bounds.top === right.bounds.top &&
    left.bounds.width === right.bounds.width &&
    left.bounds.height === right.bounds.height &&
    areStringArraysEqual(left.entityIds, right.entityIds) &&
    areStringArraysEqual(left.baseSelection, right.baseSelection)
  );
}

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