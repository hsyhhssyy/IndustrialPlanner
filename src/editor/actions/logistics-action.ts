import type { EditorAction } from "@/domain/action/editor-action";
import type { EditorActionsContext } from "./types";

type EditorLogisticsActions = Pick<
  EditorAction,
  | "applyLogisticDraft"
  | "cancelLogisticsDraft"
  | "createLogisticsDraftStart"
  | "moveLogisticEnd"
>;

export function createEditorLogisticsActions(
  _context: EditorActionsContext,
): EditorLogisticsActions {
  return {
    createLogisticsDraftStart: () => {
      // TODO: 实现物流草稿起点创建逻辑
    },
    moveLogisticEnd: () => {
      // TODO: 实现物流终点移动逻辑
    },
    applyLogisticDraft: () => {
      // TODO: 实现物流草稿应用逻辑
      return true;
    },
    cancelLogisticsDraft: () => {
      // TODO: 实现物流草稿取消逻辑
    },
  };
}
