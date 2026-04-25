import type { EditorQuery } from "@/domain/query/editor-query";

import type { EditorQueriesContext } from "./types";
import { resolveClientRectForGridCell } from "./viewport-geometry";

type EditorViewportQueries = Pick<EditorQuery, "findClientRectForGridCell">;

export function createEditorViewportQueries({
  state,
}: EditorQueriesContext): EditorViewportQueries {
  return {
    findClientRectForGridCell: (gridCell) => resolveClientRectForGridCell({
      gridCell,
      viewportState: state.viewport,
    }),
  };
}
