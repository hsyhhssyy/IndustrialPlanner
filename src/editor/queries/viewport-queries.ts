// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: src/editor/editor-view.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// import type { EditorQuery } from "@/domain/editor/editor-query";
//
// import type { EditorQueriesContext } from "./types";
// import {
//   resolveClientRectForGridCell,
//   resolveGridCellAtClientPixelPoint,
// } from "./viewport-geometry";
//
// type EditorViewportQueries = Pick<
//   EditorQuery,
//   "findClientRectForGridCell" | "findGridCellForClientPixelPoint"
// >;
//
// export function createEditorViewportQueries({
//   state,
// }: EditorQueriesContext): EditorViewportQueries {
//   return {
//     findGridCellForClientPixelPoint: (clientPixelPoint) => resolveGridCellAtClientPixelPoint({
//       clientPixelPoint,
//       viewportState: state.viewport,
//     }),
//     findClientRectForGridCell: (gridCell) => resolveClientRectForGridCell({
//       gridCell,
//       viewportState: state.viewport,
//     }),
//   };
// }
//
