export type { RenderAction } from "./render-action";
export type { RenderQuery } from "./render-query";
export type { RenderContract } from "./render-contract";
export type { RenderViewHandle, MountSceneViewOptions, SceneViewUpdate, RenderViewStatus } from "./types/scene-render-types";

// AI-REMOVED 2026-11-12:
// Reason: 渲染契约统一为 SceneSource 与独立 View，退出专用预览接口。
// Trigger: REQ-048 D5/D6 已确认整体迁移。
// Evidence: 所有图形消费者需要相同的时间、失效和生命周期语义。
// Replacement: scene-render-types.ts / document/scene-view-input.ts
// Risk: 旧调用方需整体迁移。
// Human Review: Required
// Original code:
// export type { RenderAction } from "./render-action";
// export type { RenderQuery } from "./render-query";
// export type { RenderContract } from "./render-contract";
// export type {
// 	BlueprintPreviewHandle,
// 	BlueprintPreviewViewport,
// 	MountBlueprintPreviewOptions,
// 	BlueprintPreviewPoint,
// 	BlueprintPreviewLink,
// 	BlueprintPreviewOverlay,
// 	BlueprintPreviewScene,
// } from "./types/blueprint-preview-types";
//
