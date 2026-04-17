
// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
// 比如SelectedEntities就是指这些Entity被选中了，这个状态是运行时的

import { WorldEntity } from "../entity/world-document";

// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  //currentMode: EditorMode;
  //displayTool: DisplayTool;
  
  drafts: EntityCollection;

  selectedEntities: EntityCollection;
  previewEntities: EntityCollection;

  //marquee的entity存储归属于ui!
}

export interface HistoryState {
  undoDepth: number;
  redoDepth: number;
  lastCommandId: string | null;
}

export interface UiState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  bottomBarOpen: boolean;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null;
}

export interface EntityCollection {
  [id: string]: WorldEntity;
}