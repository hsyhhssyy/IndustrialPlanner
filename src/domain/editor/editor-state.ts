import type { GridRect } from "../shared/grid";
import type {
  EditorHistoryState,
} from "./editor-history";
import type {
	EditorViewportState,
	EntityCollections,
} from "./types/editor-types";

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如 collection 会标记哪些 entity 当前被选中或处于 preview
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  readonly viewport: EditorViewportState;
  readonly marqueeGridRect: GridRect | null;
  readonly history: EditorHistoryState;

  readonly collections: EntityCollections;
}
