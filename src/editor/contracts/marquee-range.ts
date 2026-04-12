import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { GridBounds, GridPoint } from "@/shared/geometry/grid";

export interface MarqueeRangeState {
  selectionMode: EditorSelectionUpdateMode;
  originGridPoint: GridPoint;
  gridPoint: GridPoint;
  bounds: GridBounds;
}

export function isSameMarqueeRangeState(
  left: MarqueeRangeState | null,
  right: MarqueeRangeState | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.selectionMode === right.selectionMode &&
    left.originGridPoint.x === right.originGridPoint.x &&
    left.originGridPoint.y === right.originGridPoint.y &&
    left.gridPoint.x === right.gridPoint.x &&
    left.gridPoint.y === right.gridPoint.y &&
    left.bounds.left === right.bounds.left &&
    left.bounds.top === right.bounds.top &&
    left.bounds.width === right.bounds.width &&
    left.bounds.height === right.bounds.height
  );
}