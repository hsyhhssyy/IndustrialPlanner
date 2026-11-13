import type { MountSceneViewOptions, RenderViewHandle, SceneViewUpdate, SceneTimePolicy } from "./types/scene-render-types";

export interface RenderAction {
  mountView(options: MountSceneViewOptions): Promise<RenderViewHandle>;
  updateViews(updates: readonly SceneViewUpdate[]): void;
  invalidateView(handle: RenderViewHandle): void;
  setViewTimePolicy(handle: RenderViewHandle, policy: SceneTimePolicy): void;
  suspendView(handle: RenderViewHandle): () => void;
  disposeView(handle: RenderViewHandle): void;
}

// AI-REMOVED 2026-11-12:
// Reason: 渲染契约统一为 SceneSource 与独立 View，退出专用预览接口。
// Trigger: REQ-048 D5/D6 已确认整体迁移。
// Evidence: 所有图形消费者需要相同的时间、失效和生命周期语义。
// Replacement: scene-render-types.ts / document/scene-view-input.ts
// Risk: 旧调用方需整体迁移。
// Human Review: Required
// Original code:
// import type {
// 	BlueprintPreviewHandle,
// 	BlueprintPreviewViewport,
// 	MountBlueprintPreviewOptions,
// 	BlueprintPreviewScene,
// } from "./types/blueprint-preview-types";
//
// export interface RenderAction {
// 	updateBlueprintPreviewScene(handle: BlueprintPreviewHandle, scene: BlueprintPreviewScene): void;
// 	mountBlueprintPreview(
// 		options: MountBlueprintPreviewOptions,
// 	): Promise<BlueprintPreviewHandle>;
// 	updateBlueprintPreviewViewport(
// 		handle: BlueprintPreviewHandle,
// 		viewport: Partial<BlueprintPreviewViewport>,
// 	): void;
// 	resizeBlueprintPreview(
// 		handle: BlueprintPreviewHandle,
// 		width: number,
// 		height: number,
// 	): void;
// 	disposeBlueprintPreview(handle: BlueprintPreviewHandle): void;
// }
//
