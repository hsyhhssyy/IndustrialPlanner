import type { EditorQuery } from "@/domain/query/editor-query";
import type { EditorQueriesContext } from "./types";

type EditorLogisticsQueries = Pick<
  EditorQuery,
  "canCreateLogisticsDraftStartHere"
>;

export function createEditorLogisticsQueries(
  _context: EditorQueriesContext,
): EditorLogisticsQueries {
  return {
    canCreateLogisticsDraftStartHere: () => {
      // TODO: 实现物流草稿起点可行性检查逻辑
      return true;
    },
  };
}
