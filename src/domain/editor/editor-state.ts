import type { GridRect } from "../shared/grid";
import type {
  EditorHistoryState,
} from "./editor-history";
import type {
	EditorViewportState,
	EntityCollections,
	HoverTarget,
} from "./types/editor-types";

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如 collection 会标记哪些 entity 当前被选中或处于 preview
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  readonly viewport: EditorViewportState;
  readonly marqueeGridRect: GridRect | null;
  readonly history: EditorHistoryState;

  readonly collections: EntityCollections;

  /** 当前鼠标悬浮目标（设备或空单元格） */
  readonly hoverTarget: HoverTarget | null;

  /** 抑制传送带渲染与命中检测 */
  readonly suppressBelts: boolean;
  /** 抑制管道渲染与命中检测 */
  readonly suppressPipes: boolean;
}
