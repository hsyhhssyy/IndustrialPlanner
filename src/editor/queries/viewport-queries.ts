import type { EditorQuery } from "@/domain/editor/editor-query";

import type { EditorQueriesContext } from "./types";
import {
  resolveClientRectForGridCell,
  resolveGridCellAtClientPixelPoint,
} from "./viewport-geometry";

type EditorViewportQueries = Pick<
  EditorQuery,
  "findClientRectForGridCell" | "findGridCellForClientPixelPoint"
>;

export function createEditorViewportQueries({
  state,
}: EditorQueriesContext): EditorViewportQueries {
  return {
    findGridCellForClientPixelPoint: (clientPixelPoint) => resolveGridCellAtClientPixelPoint({
      clientPixelPoint,
      viewportState: state.viewport,
    }),
    findClientRectForGridCell: (gridCell) => resolveClientRectForGridCell({
      gridCell,
      viewportState: state.viewport,
    }),
  };
}
