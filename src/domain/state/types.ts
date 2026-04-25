


import type { AppLocale } from "@/shared/i18n/messages";
import type { WorldEntity } from "../entity/world-document";
import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";
import type { ClientPixelRect } from "../types/client-pixel";
import type { GridFloatPoint } from "../types/grid";

export interface EditorViewportState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
}

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如SelectedEntities就是指这些Entity被选中了，这个状态是运行时的
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  readonly viewport: EditorViewportState;

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
  readonly themeId: AppThemeId;
  readonly hypergryphOperationMode: boolean;
}

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
}

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;
}

export type EntityCollection = Readonly<Record<string, WorldEntity>>;

export const EntityCollectionType = {
  selection: "selection",
  preview: "preview",
} as const;

export type EntityCollectionType =
  typeof EntityCollectionType[keyof typeof EntityCollectionType];
