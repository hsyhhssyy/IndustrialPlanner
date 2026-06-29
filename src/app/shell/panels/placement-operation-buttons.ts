import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { canCurrentBaseAcceptWulingOnlyEntities } from "@/app/placement-zone-availability";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { MessageKey } from "@/shared/i18n/messages";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { ComponentProps } from "react";

type PlacementOperationIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

export interface PlacementOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: MessageKey;
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
  hotkeyKeyId: SHORTCUT_KEY.RETURN_SELECT,
  activeWhen: (appHost) => appHost.state.activeTool === "select",
};

const MARQUEE_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-tool-marquee",
  labelKey: "workbench.button.batchSelect",
  icon: "batch-select",
  hotkey: "X",
  visibleWhen: (appHost) => appHost.state.settings.hypergryphOperationMode,
  activeWhen: (appHost) => appHost.state.activeTool === "marquee",
};

const BELT_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-belt-draw",
  labelKey: "workbench.button.beltDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_belt_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  activeWhen: (appHost) =>
    appHost.state.activeTool === "logistics-placement"
    && appHost.internalState.runtime.logisticsPlacement.kind === "belt",
};

const PIPE_DRAW_OPERATION_BUTTON: PlacementOperationButtonDefinition = {
  uiButtonId: "placement-action-pipe-draw",
  labelKey: "workbench.button.pipeDraw",
  iconSrc: createDeviceIconAssetUrl("item_log_pipe_01"),
  hotkeyKeyId: SHORTCUT_KEY.PLACE_PIPE,
  visibleWhen: canCurrentBaseAcceptWulingOnlyEntities,
  activeWhen: (appHost) =>
    appHost.state.activeTool === "logistics-placement"
    && appHost.internalState.runtime.logisticsPlacement.kind === "pipe",
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
