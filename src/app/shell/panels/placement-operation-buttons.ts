import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { canCurrentBaseAcceptWulingOnlyEntities } from "@/app/placement-zone-availability";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { UiKey } from "@/shared/i18n";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { ComponentProps } from "react";

type PlacementOperationIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

export interface PlacementOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: UiKey;
  readonly icon?: PlacementOperationIconKind;
  readonly iconSrc?: string;
  readonly hotkey?: string | null;
  readonly hotkeyKeyId?: ShortcutKeyId;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

const SELECT_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-tool-select",
  labelKey: "workbench.button.select",
  icon: "select-arrow",
  // AI-REMOVED 2026-08-03:
  // Reason: Escape 不再属于可配置快捷键，选择按钮提示改用硬编码键名。
  // Trigger: ST2-RQ-002 禁止任何快捷键绑定 Escape。
  // Evidence: hypergryph-select-gesture-module.ts 已直接匹配 Escape。
  // Replacement: 本对象的 hotkey: "Esc"。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // hotkeyKeyId: SHORTCUT_KEY.RETURN_SELECT,
  hotkey: "Esc",
  activeWhen: (appHost) => appHost.state.activeTool === "select",
};

const MARQUEE_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-tool-marquee",
  labelKey: "workbench.button.batchSelect",
  icon: "batch-select",
  // AI-REMOVED 2026-08-03:
  // Reason: 框选快捷键已接入统一可配置体系，工具栏提示必须动态读取当前绑定。
  // Trigger: ST2-RQ-002 新增 MARQUEE 快捷键。
  // Evidence: hypergryph-marquee-gesture-module.ts 已使用 SHORTCUT_KEY.MARQUEE。
  // Replacement: 本对象的 hotkeyKeyId: SHORTCUT_KEY.MARQUEE。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // hotkey: "X",
  hotkeyKeyId: SHORTCUT_KEY.MARQUEE,
  // AI-REMOVED 2026-09-10:
  // Reason: 操作模式总开关已废弃，不再保留关闭分支
  // Trigger: 用户要求彻底移除 hypergryphOperationMode。
  // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
  // Replacement: getVisiblePlacementOperationButtons 默认显示批量选择
  // Risk: 历史 false 设置统一使用当前操作行为。
  // Human Review: Required
  //
  // Original code:
  // visibleWhen: (appHost) => appHost.state.settings.hypergryphOperationMode,
  activeWhen: (appHost) => appHost.state.activeTool === "marquee",
};

const BELT_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-belt-draw",
  labelKey: "workbench.button.beltDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_belt_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  activeWhen: (appHost) =>
    appHost.state.activeTool === "logistics-placement"
    && appHost.internalState.runtime.logisticsPlacement.kind === LOGISTICS_KIND.belt,
};

const PIPE_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-pipe-draw",
  labelKey: "workbench.button.pipeDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_pipe_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_PIPE,
  visibleWhen: canCurrentBaseAcceptWulingOnlyEntities,
  activeWhen: (appHost) =>
    appHost.state.activeTool === "logistics-placement"
    && appHost.internalState.runtime.logisticsPlacement.kind === LOGISTICS_KIND.pipe,
};

export const PLACEMENT_OPERATION_BUTTONS = [
  SELECT_OPERATION_BUTTON,
  MARQUEE_OPERATION_BUTTON,
  BELT_DRAW_OPERATION_BUTTON,
  PIPE_DRAW_OPERATION_BUTTON,
] as const satisfies readonly PlacementOperationButtonDefinition[];

export function getVisiblePlacementOperationButtons(
  appHost: AppHost,
): PlacementOperationButtonDefinition[] {
  return PLACEMENT_OPERATION_BUTTONS.filter((button) => button.visibleWhen?.(appHost) ?? true);
}
