// AI-REMOVED 2026-05-09:
// Reason: Blueprint preview 已切换到 renderer action/query 模式，旧的 app 本地 renderer 接口不再是有效实现入口。
// Trigger: ST1-RQ-060 要求使用独立 PixiJS Application + renderer action/query 协议替代占位 canvas renderer factory。
// Evidence: 当前活跃调用链已经改为 domain/renderer RenderAction/RenderQuery + src/renderer/blueprint-preview/blueprint-preview-manager.ts。
// Replacement: src/renderer/blueprint-preview/blueprint-preview-manager.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// import type { BlueprintDocument } from "@/domain/document/blueprint-document";
//
// export interface BlueprintPreviewRenderer {
//   mount: () => void;
//   render: () => void;
//   dispose: () => void;
// }
//
// export interface CreateBlueprintPreviewRendererInput {
//   readonly blueprint: BlueprintDocument;
//   readonly canvasElement: HTMLCanvasElement;
// }
//
// export type BlueprintPreviewRendererFactory = (
//   input: CreateBlueprintPreviewRendererInput,
// ) => BlueprintPreviewRenderer;