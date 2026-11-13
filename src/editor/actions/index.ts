import type { EditorAction } from "@/domain/editor/editor-action";

import { createEditorConfigActions } from "./config-action";
import { createEditorDarkPipeLinkActions } from "./dark-pipe-link-action";
import { createEditorWarehouseSlotLinkActions } from "./warehouse-slot-link-action";
import { createEditorDefinitionActions } from "./definition-action";
import { createEditorDocumentActions } from "./document-action";
import { createEditorHistoryActions } from "./history-action";
import { createEditorHoverActions } from "./hover-action";
import { createEditorLogisticsActions } from "./logistics-action";
import { createEditorMoveActions } from "./move-action";
import { createEditorPlacementActions } from "./placement-action";
import { createEditorRegionActions } from "./region-actions";
import { createEditorSelectionActions } from "./selection-actions";
import { createEditorTransportActions } from "./transport-action";
import type { EditorActionsContext } from "./types";
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewContract
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// import { createEditorViewportActions } from "./viewport-actions";

export function createEditorActions(
  context: EditorActionsContext,
): EditorAction {
  return {
    ...createEditorConfigActions(context),
    ...createEditorDarkPipeLinkActions(context),
    ...createEditorWarehouseSlotLinkActions(context),
    ...createEditorDefinitionActions(context),
    ...createEditorDocumentActions(context),
    ...createEditorHistoryActions(context),
    ...createEditorHoverActions(context),
    ...createEditorLogisticsActions(context),
    ...createEditorMoveActions(context),
    ...createEditorPlacementActions(context),
    ...createEditorRegionActions(context),
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewContract
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
//     ...createEditorViewportActions(context),
    ...createEditorSelectionActions(context),
    ...createEditorTransportActions(context),
  };
}

export type { EditorActionsContext } from "./types";
