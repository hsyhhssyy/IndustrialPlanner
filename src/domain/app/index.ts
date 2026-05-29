export type { AppAction } from "./app-action";
export type { AppQuery } from "./app-query";
export type { AppContract } from "./app-contract";
export type { UiState } from "./types/app-types";
export type {
	AppLocale,
	AppSettings,
	RightDockTabId,
	WorkbenchState,
	ActiveTool,
	ToolInfo,
} from "./types/app-types";
// AI-CORRECTION 2026-05-29: DialogState 已从 index.ts 移除，对应 domain/app/types/app-types.ts 中已删除。workerbenchState dialogState 字段已移除。
export type { ScreenProfile, DeviceClass, ScreenShape } from "./types/screen-profile";
export type {
	AppTheme,
	AppThemeId,
	AppThemeColorKey,
	AppThemeColorMap,
	AppThemeRendererColorKeys,
} from "./types/theme";
export { APP_THEME_COLOR_KEYS } from "./types/theme";
