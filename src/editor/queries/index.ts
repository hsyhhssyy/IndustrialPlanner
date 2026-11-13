import type { EditorQuery } from "@/domain/editor/editor-query";

import { createEditorDocumentQueries } from "./document-queries";
import { createEditorEntityQueries } from "./entity-queries";
import { createEditorLogisticsQueries } from "./logistics-queries";
import { createEditorRegionQueries } from "./region-queries";
import type { EditorQueriesContext } from "./types";
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewContract
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// import { createEditorViewportQueries } from "./viewport-queries";

export function createEditorQueries(
  context: EditorQueriesContext,
): EditorQuery {
  return {
    getOperationAvailability: context.getOperationAvailability,
    subscribeCommittedEdits: (listener) => context.history.subscribeCommittedEdits(listener),
    ...createEditorDocumentQueries(context),
    ...createEditorEntityQueries(context),
    ...createEditorLogisticsQueries(context),
    ...createEditorRegionQueries(context),
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewContract
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
//     ...createEditorViewportQueries(context),
  };
}

export type { EditorQueriesContext } from "./types";

export { resolveGridCellAtClientPixelPoint, resolveClientRectForGridCell } from "./viewport-geometry";
