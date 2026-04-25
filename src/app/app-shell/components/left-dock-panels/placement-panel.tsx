import type { AppHost } from "@/app/app-host";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const PLACEMENT_ICON_PATHS = [
  "/device-icons/item_log_belt_01.webp",
  "/device-icons/item_log_connector.webp",
  "/device-icons/item_log_converger.webp",
  "/device-icons/item_log_pipe_01.webp",
  "/device-icons/item_log_splitter.webp",
  "/device-icons/item_pipe_connector.webp",
  "/device-icons/item_pipe_converger.webp",
  "/device-icons/item_pipe_splitter.webp",
  "/device-icons/item_port_filling_pd_mc_1.webp",
  "/device-icons/item_port_grinder_1.webp",
  "/device-icons/item_port_log_hongs_bus.webp",
  "/device-icons/item_port_log_hongs_bus_source.webp",
  "/device-icons/item_port_mix_pool_1.webp",
  "/device-icons/item_port_storager_1.webp",
  "/device-icons/item_port_udpipe_loader_1.webp",
  "/device-icons/item_port_udpipe_unloader_1.webp",
  "/device-icons/item_port_unloader_1.webp",
] as const;

const DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

interface PlacementButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly hotkey?: string | null;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

interface PlacementSectionDefinition {
  readonly titleKey: string;
  readonly shortcutKey: string | null;
  readonly buttons: readonly PlacementButtonDefinition[];
}

const OPERATION_BUTTONS: readonly PlacementButtonDefinition[] = [
  {
    uiButtonId: "placement-tool-select",
    labelKey: "workbench.button.select",
    hotkey: "Esc",
    activeWhen: (appHost) => appHost.internalState.runtime.activeTool === "select",
  },
  {
    uiButtonId: "placement-tool-marquee",
    labelKey: "workbench.button.batchSelect",
    visibleWhen: (appHost) => appHost.state.settings.hypergryphOperationMode,
    activeWhen: (appHost) => appHost.internalState.runtime.activeTool === "marquee",
  },
  {
    uiButtonId: "placement-action-belt-draw",
    labelKey: "workbench.button.beltDraw",
  },
  {
    uiButtonId: "placement-action-pipe-draw",
    labelKey: "workbench.button.pipeDraw",
  },
  {
    uiButtonId: "placement-action-save-blueprint",
    labelKey: "workbench.button.saveAsBlueprint",
    hotkey: "Ctrl+S",
  },
] as const;

const PLACEMENT_SECTIONS: readonly PlacementSectionDefinition[] = [
  {
    titleKey: "workbench.section.operation",
    shortcutKey: null,
    buttons: OPERATION_BUTTONS,
  },
  {
    titleKey: "workbench.section.beltLogistics",
    shortcutKey: "E",
    buttons: [
      { uiButtonId: "placement-belt-splitter", labelKey: "workbench.button.beltSplitter" },
      { uiButtonId: "placement-belt-converger", labelKey: "workbench.button.beltConverger" },
      { uiButtonId: "placement-belt-bridge", labelKey: "workbench.button.beltBridge" },
      { uiButtonId: "placement-item-inlet", labelKey: "workbench.button.itemInlet" },
    ],
  },
  {
    titleKey: "workbench.section.pipeLogistics",
    shortcutKey: "Q",
    buttons: [
      { uiButtonId: "placement-pipe-splitter", labelKey: "workbench.button.pipeSplitter" },
      { uiButtonId: "placement-pipe-converger", labelKey: "workbench.button.pipeConverger" },
      { uiButtonId: "placement-pipe-bridge", labelKey: "workbench.button.pipeBridge" },
      { uiButtonId: "placement-pipe-inlet", labelKey: "workbench.button.pipeInlet" },
    ],
  },
  {
    titleKey: "workbench.section.resourcePower",
    shortcutKey: "X",
    buttons: [
      { uiButtonId: "placement-water-pump", labelKey: "workbench.button.waterPump" },
      { uiButtonId: "placement-power-post", labelKey: "workbench.button.powerPost" },
      { uiButtonId: "placement-thermal-pool", labelKey: "workbench.button.thermalPool" },
    ],
  },
  {
    titleKey: "workbench.section.warehouse",
    shortcutKey: "C",
    buttons: [
      { uiButtonId: "placement-dark-outlet", labelKey: "workbench.button.darkOutlet" },
      { uiButtonId: "placement-dark-inlet", labelKey: "workbench.button.darkInlet" },
      { uiButtonId: "placement-warehouse-storage-port", labelKey: "workbench.button.warehouseStoragePort" },
      { uiButtonId: "placement-warehouse-pickup-port", labelKey: "workbench.button.warehousePickupPort" },
      { uiButtonId: "placement-liquid-tank", labelKey: "workbench.button.liquidTank" },
      { uiButtonId: "placement-warehouse-bus-segment", labelKey: "workbench.button.warehouseBusSegment" },
      { uiButtonId: "placement-warehouse-bus-source", labelKey: "workbench.button.warehouseBusSource" },
      { uiButtonId: "placement-protocol-storage", labelKey: "workbench.button.protocolStorage" },
    ],
  },
  {
    titleKey: "workbench.section.production",
    shortcutKey: "V",
    buttons: [
      { uiButtonId: "placement-reactor-pool", labelKey: "workbench.button.reactorPool" },
      { uiButtonId: "placement-grinder", labelKey: "workbench.button.grinder" },
      { uiButtonId: "placement-filling-machine", labelKey: "workbench.button.fillingMachine" },
    ],
  },
] as const;

function resolvePlacementIconPath(index: number): string {
  return PLACEMENT_ICON_PATHS[index % PLACEMENT_ICON_PATHS.length] ?? PLACEMENT_ICON_PATHS[0];
}

export const PlacementPanel = observer(function PlacementPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const screenProfile = appHost.state.screenProfile;
  const isMobileLayout = screenProfile.deviceClass === "mobile";
  const showShortcutHints = screenProfile.deviceClass !== "mobile";
  const sections = PLACEMENT_SECTIONS.map((section) => ({
    ...section,
    buttons: section.buttons.filter((button) => button.visibleWhen?.(appHost) ?? true),
  }));

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: PlacementButtonDefinition,
  ) => {
    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: button.uiButtonId,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: button.uiButtonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  return (
    <div className="placement-panel">
      {sections.map((section, sectionIndex) => {
        const isOperationSection = sectionIndex === 0;
        const isResourcePowerSection = section.titleKey === "workbench.section.resourcePower";
        const sectionTitleId = `placement-section-${sectionIndex}`;
        const sectionButtonStartIndex = sections.slice(0, sectionIndex).reduce(
          (count, currentSection) => count + currentSection.buttons.length,
          0,
        );

        return (
          <Fragment key={section.titleKey}>
            {sectionIndex > 0 ? <div aria-hidden="true" className="placement-panel-divider" /> : null}
            <section
              aria-labelledby={sectionTitleId}
              className={isResourcePowerSection
                ? "placement-panel-group placement-panel-group-resource-power"
                : "placement-panel-group"}
            >
              <div className="placement-panel-group-header">
                <h3 id={sectionTitleId}>{t(section.titleKey)}</h3>
                {showShortcutHints && section.shortcutKey ? (
                  <span className="placement-panel-group-shortcut">{section.shortcutKey}</span>
                ) : null}
              </div>
              <div className={isMobileLayout ? "placement-button-list is-single-column" : "placement-button-list"}>
                {section.buttons.map((button, buttonIndex) => {
                  const iconPath = resolvePlacementIconPath(sectionButtonStartIndex + buttonIndex);
                  const hotkey = button.hotkey ?? (
                    isOperationSection
                      ? null
                      : DEVICE_SHORTCUT_KEYS[buttonIndex % DEVICE_SHORTCUT_KEYS.length]
                  );
                  const isActive = button.activeWhen?.(appHost) ?? false;
                  const className = isOperationSection
                    ? (isActive
                      ? "placement-button placement-action-button is-active"
                      : "placement-button placement-action-button")
                    : "placement-button placement-device-button";

                  return (
                    <button
                      aria-pressed={button.activeWhen ? isActive : undefined}
                      className={className}
                      data-ui-button-id={button.uiButtonId}
                      key={button.uiButtonId}
                      onPointerUp={(event) => {
                        handleButtonPointerUp(event, button);
                      }}
                      type="button"
                    >
                      <span className="button-icon" aria-hidden="true">
                        <img alt="" className="button-icon-image" src={iconPath} />
                      </span>
                      <span className="placement-button-label">{t(button.labelKey)}</span>
                      {showShortcutHints && hotkey ? <span className="placement-button-hotkey">{hotkey}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
});
