import type { EditorAction } from "@/domain/action/editor-action";
import { EntityCollectionType } from "@/domain/state/types";
import type { LogisticsDraftActionResult } from "@/domain/types/logistics";
import type { EditorActionsContext } from "./types";

type EditorLogisticsActions = Pick<
  EditorAction,
  | "applyLogisticDraft"
  | "cancelLogisticsDraft"
  | "createLogisticsDraftStart"
  | "moveLogisticEnd"
>;

export function createEditorLogisticsActions(
  context: EditorActionsContext,
): EditorLogisticsActions {
  return {
    createLogisticsDraftStart: () => {
      // TODO: 实现物流草稿起点创建逻辑
      // 2026-04-30 订正：ST1-RQ-047 先建立 action result 接口，路径逻辑在后续步骤实现。
      return createIgnoredLogisticsActionResult();
    },
    moveLogisticEnd: () => {
      // TODO: 实现物流终点移动逻辑
      // 2026-04-30 订正：ST1-RQ-047 先建立 action result 接口，路径逻辑在后续步骤实现。
      return createIgnoredLogisticsActionResult();
    },
    applyLogisticDraft: () => {
      // TODO: 实现物流草稿应用逻辑
      // 2026-04-30 订正：ST1-RQ-047 先接入 canApply 返回语义，真实写入在后续步骤实现。
      const draft = context.state.internalTransientState.logisticsDraft;
      return draft?.canApply === true ? false : false;
    },
    cancelLogisticsDraft: () => {
      // TODO: 实现物流草稿取消逻辑
      // 2026-04-30 订正：ST1-RQ-047 已实现 logistics draft / collection 的最小清理。
      clearLogisticsDraftState(context);
    },
  };
}

function clearLogisticsDraftState(context: EditorActionsContext): void {
  const preview = context.state.collections[EntityCollectionType.preview];
  const logisticsHead = context.state.collections[EntityCollectionType.logisticsHead];
  const ghost = context.state.collections[EntityCollectionType.ghost];
  const previewDraftIds = new Set(preview);

  context.state.drafts = context.state.drafts.filter((entity) => !previewDraftIds.has(entity.id));
  preview.replace([]);
  logisticsHead.replace([]);
  ghost.replace([]);
  context.state.internalTransientState.logisticsDraft = null;
}

function createIgnoredLogisticsActionResult(): LogisticsDraftActionResult {
  return {
    status: "ignored",
    canApply: false,
    invalidReason: null,
    headGridPoint: null,
    headDraftEntityId: null,
    sourceEntityId: null,
    targetEntityId: null,
  };
}
