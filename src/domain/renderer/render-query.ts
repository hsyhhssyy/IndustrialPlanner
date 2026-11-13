import type { RenderViewHandle, RenderViewStatus } from "./types/scene-render-types";

export interface RenderQuery {
  getViewContainer(handle: RenderViewHandle): HTMLDivElement | null;
  getViewCanvas(handle: RenderViewHandle): HTMLCanvasElement | null;
  getViewStatus(handle: RenderViewHandle): RenderViewStatus | null;
  subscribeFrameDemand(listener: () => void): () => void;
}

// AI-REMOVED 2026-11-12:
// Reason: 渲染契约统一为 SceneSource 与独立 View，退出专用预览接口。
// Trigger: REQ-048 D5/D6 已确认整体迁移。
// Evidence: 所有图形消费者需要相同的时间、失效和生命周期语义。
// Replacement: scene-render-types.ts / document/scene-view-input.ts
// Risk: 旧调用方需整体迁移。
// Human Review: Required
// Original code:
// import type { BlueprintPreviewHandle, BlueprintPreviewPoint } from "./types/blueprint-preview-types";
//
// export interface RenderQuery {
// 	blueprintPreviewScreenToGrid(handle: BlueprintPreviewHandle, point: BlueprintPreviewPoint): BlueprintPreviewPoint | null;
// 	getBlueprintPreviewCanvas(handle: BlueprintPreviewHandle): HTMLCanvasElement | null;
// }
//
