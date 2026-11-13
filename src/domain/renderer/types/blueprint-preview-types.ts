
// AI-REMOVED 2026-11-12:
// Reason: 渲染契约统一为 SceneSource 与独立 View，退出专用预览接口。
// Trigger: REQ-048 D5/D6 已确认整体迁移。
// Evidence: 所有图形消费者需要相同的时间、失效和生命周期语义。
// Replacement: scene-render-types.ts / document/scene-view-input.ts
// Risk: 旧调用方需整体迁移。
// Human Review: Required
// Original code:
// import type { BlueprintDocument } from "../../document/blueprint-document";
// import type { GridBounds, GridPoint } from "../../shared/grid";
//
// export type BlueprintPreviewPoint = GridPoint;
//
// export interface BlueprintPreviewLink {
//   readonly sourceEntityId: string;
//   readonly targetEntityId: string;
//   readonly binding: boolean;
// }
//
// export interface BlueprintPreviewOverlay {
//   readonly selectedEntityIds: readonly string[];
//   readonly invalidEntityIds: readonly string[];
//   readonly productionItemIds: Readonly<Record<string, readonly string[]>>;
//   readonly links: readonly BlueprintPreviewLink[];
// }
//
// export interface BlueprintPreviewScene {
//   readonly blueprint: BlueprintDocument;
//   readonly overlay?: BlueprintPreviewOverlay;
// }
//
// export type BlueprintPreviewHandle = string;
//
// export interface BlueprintPreviewViewport {
// 	zoom: number;
// 	offsetX: number;
// 	offsetY: number;
// }
//
// export interface MountBlueprintPreviewOptions {
// 	blueprint: BlueprintDocument;
// 	width: number;
// 	height: number;
// 	viewport?: Partial<BlueprintPreviewViewport>;
// 	/** 固定视口边界，传入后不根据蓝图实体自动计算 bounds */
// 	viewportBounds?: GridBounds;
// 	/** 需要在预览中叠加扫描线高亮特效的实体 ID */
// 	highlightedEntityId?: string;
// }
//
