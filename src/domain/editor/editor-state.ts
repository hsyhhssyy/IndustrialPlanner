import type { GridRect } from "../shared/grid";
import type {
  EditorHistoryState,
} from "./editor-history";
import type {
// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: editor-view-types.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// 	EditorViewportState,
	EntityCollections,
	HoverTarget,
} from "./types/editor-types";
import type { RegionAnnotationEditorState } from "./types/region-annotation-types";

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如 collection 会标记哪些 entity 当前被选中或处于 preview
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  // AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewContract.state
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// readonly viewport: EditorViewportState;
  readonly marqueeGridRect: GridRect | null;
  readonly history: EditorHistoryState;
  readonly regionAnnotations: RegionAnnotationEditorState;

  readonly collections: EntityCollections;

  /** 当前鼠标悬浮目标（设备或空单元格） */
  readonly hoverTarget: HoverTarget | null;

  /** 抑制传送带渲染与命中检测 */
  readonly suppressBelts: boolean;
  /** 抑制管道渲染与命中检测 */
  readonly suppressPipes: boolean;
}
