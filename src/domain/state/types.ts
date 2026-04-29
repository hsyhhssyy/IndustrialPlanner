


import type { AppLocale } from "@/shared/i18n/messages";
import type { ScreenProfile } from "./screen-profile";
import type { AppTheme, AppThemeId } from "./theme";
import type { ClientPixelRect } from "../types/client-pixel";
import type { GridFloatPoint, GridRect } from "../types/grid";

export interface EntityCollection extends ReadonlyArray<string> {
  contains(entityId: string): boolean;
}

export const EntityCollectionType = {
  selection: "selection",
  marquee: "marquee",
  reverseMarquee: "reverse-marquee",
  preview: "preview",
  ghost: "ghost",
} as const;

export type EntityCollectionType =
  typeof EntityCollectionType[keyof typeof EntityCollectionType];

export type MarqueeCollectionType =
  | typeof EntityCollectionType.marquee
  | typeof EntityCollectionType.reverseMarquee;

export type EntityCollections = Readonly<Record<EntityCollectionType, EntityCollection>>;

export interface EditorViewportState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
  readonly gridCellPixelSize: number;
}

/// Editor State 定义上是Document的包裹层，他为Document提供一层运行时tag
/// 比如 collection 会标记哪些 entity 当前被选中或处于 preview
/// 操作也是通过这个状态来进行的，比如MoveSelectionTo, MovePreviewTo, PlacePreviewTo
export interface EditorState {

  readonly viewport: EditorViewportState;
  readonly marqueeGridRect: GridRect | null;

  readonly collections: EntityCollections;
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
  readonly hypergryphImmediateMove: boolean;
  readonly hypergryphImmediateMarquee: boolean;
  readonly gameShowHotkeys: boolean;
  readonly debugShowFps: boolean;
  readonly debugShowGestureDiagnosticsWindow: boolean;
}

export interface WorkbenchState {
  readonly leftDockOpen: boolean;
  readonly rightDockOpen: boolean;
  readonly leftDockWidth: number;
  readonly topBarCollapsed: boolean;
}

export type ActiveTool = "select" | "move" | "marquee" | "single-placement";

export interface UiState {
  readonly settings: AppSettings;
  readonly workbench: WorkbenchState;
  readonly screenProfile: ScreenProfile;
  readonly theme: AppTheme;
  readonly activeTool: ActiveTool;
}
