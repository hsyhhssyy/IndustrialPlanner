import type { EditorQuery } from "@/domain/query/editor-query";
import type { EditorQueriesContext } from "./types";

type EditorLogisticsQueries = Pick<
  EditorQuery,
  | "canCreateLogisticsDraftStartHere"
  | "findLogisticsDraftEndpointAtGridPoint"
  | "resolveLogisticsDraftState"
>;

export function createEditorLogisticsQueries(
  _context: EditorQueriesContext,
): EditorLogisticsQueries {
  return {
    resolveLogisticsDraftState: () => {
      return _context.state.internalTransientState.logisticsDraft;
    },
    findLogisticsDraftEndpointAtGridPoint: () => {
      return null;
    },
    canCreateLogisticsDraftStartHere: () => {
      return false;
    },
  };
}
