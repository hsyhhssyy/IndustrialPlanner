import type { ScenePresentationSettings } from "@/domain/document/scene-view-input";

/** 启用蓝图设备样式时联动的显示设置。 */
export const BLUEPRINT_STYLE_SETTINGS = {
  gameAlwaysShowGridLines: true,
  gameShowDeviceIcons: true,
  showGrassBackground: false,
} as const satisfies Partial<ScenePresentationSettings>;
