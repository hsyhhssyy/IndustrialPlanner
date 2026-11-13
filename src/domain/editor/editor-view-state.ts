import type { ClientPixelRect, GridFloatPoint, GridRotation } from "./types/editor-view-types";

export interface EditorViewState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
  readonly gridCellPixelSize: number;
  readonly displayRotation: GridRotation;
}
