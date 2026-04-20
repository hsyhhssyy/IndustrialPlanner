
// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
// 比如SelectedEntities就是指这些Entity被选中了，这个状态是运行时的

import type { AppLocale } from "@/shared/i18n/messages";
import type { WorldEntity } from "../entity/world-document";

export interface EditorViewportCenter {
  readonly x: number;
  readonly y: number;
}

export interface EditorViewportPixelSize {
  readonly width: number;
  readonly height: number;
}

export interface EditorViewportState {
  readonly center: EditorViewportCenter;
  readonly pixelSize: EditorViewportPixelSize;
  readonly gridSize: number;
}

// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  //currentMode: EditorMode;
  //displayTool: DisplayTool;

  readonly viewport: EditorViewportState;
  
  readonly drafts: EntityCollection;

  readonly selectedEntities: EntityCollection;
  readonly previewEntities: EntityCollection;

  

  //marquee的entity存储归属于ui!
}

export interface HistoryState {
  undoDepth: number;
  redoDepth: number;
  lastCommandId: string | null;
}

export interface AppSettings {
  readonly locale: AppLocale;
}

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
}

export type EntityCollection = Readonly<Record<string, WorldEntity>>;