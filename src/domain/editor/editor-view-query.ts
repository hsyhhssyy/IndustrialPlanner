import type { ClientPixelPoint, ClientPixelRect, GridPoint } from "./types/editor-view-types";

export interface EditorViewQuery {
  findGridCellForClientPixelPoint(point: ClientPixelPoint): GridPoint | null;
  findClientRectForGridCell(cell: GridPoint): ClientPixelRect | null;
  hasPendingMotion(): boolean;
}
