export type { EditorAction } from "./editor-action";
export type { EditorBaseDocumentSummary } from "./editor-document";
export type {
	EditorHistoryActionDescriptor,
	EditorHistoryActionType,
	EditorHistoryDocumentDelta,
	EditorHistoryRecord,
	EditorHistoryState,
	EditorHistoryValueChange,
} from "./editor-history";
export type { EditorQuery } from "./editor-query";
export type { EditorState } from "./editor-state";
// AI-REMOVED 2026-11-12:
// Reason: 场景共享契约迁入 Domain Shared，避免 Editor/App 各有一份语义。
// Trigger: REQ-048 已确认 D2 契约。
// Evidence: 会话、只读源与交互画布均需要相同标识和只读快照。
// Replacement: EditorContract 与 Domain Shared SceneSnapshotSource
// Risk: 所有引用需同步迁移。
// Human Review: Required
// Original code:
// export type { EditorContract, EditorSnapshotStore } from "./editor-contract";
export type { EditorContract } from "./editor-contract";
export type {
	EntityCollection,
	EntityCollectionGeometry,
	EntityCollections,
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: editor-view-types.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// 	EditorViewportState,
	HoverTarget,
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: editor-view-types.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// 	MoveViewportByClientPixelVectorOptions,
	EntityCollectionMemberOptions,
	MoveCollectionToOptions,
	MarqueeCollectionType,
} from "./types/editor-types";
export type {
	RegionAnnotationEditorState,
	RegionMoveChange,
	RegionMoveFeedback,
	RegionRectOperation,
} from "./types/region-annotation-types";
export {
	EntityCollectionType,
} from "./types/editor-types";
