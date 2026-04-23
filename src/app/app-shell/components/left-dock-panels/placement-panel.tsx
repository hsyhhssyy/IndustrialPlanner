import {
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";

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

const OPERATION_BUTTON_KEYS = [
  "workbench.button.select",
  "workbench.button.beltDraw",
  "workbench.button.pipeDraw",
  "workbench.button.saveAsBlueprint",
] as const;

const OPERATION_BUTTON_HOTKEYS = new Map<string, string>([
  ["workbench.button.select", "Esc"],
  ["workbench.button.saveAsBlueprint", "Ctrl+S"],
]);

const PLACEMENT_SECTIONS = [
  {
    titleKey: "workbench.section.operation",
    shortcutKey: null,
    buttonKeys: OPERATION_BUTTON_KEYS,
  },
  {
    titleKey: "workbench.section.beltLogistics",
    shortcutKey: "E",
    buttonKeys: [
      "workbench.button.beltSplitter",
      "workbench.button.beltConverger",
      "workbench.button.beltBridge",
      "workbench.button.itemInlet",
    ],
  },
  {
    titleKey: "workbench.section.pipeLogistics",
    shortcutKey: "Q",
    buttonKeys: [
      "workbench.button.pipeSplitter",
      "workbench.button.pipeConverger",
      "workbench.button.pipeBridge",
      "workbench.button.pipeInlet",
    ],
  },
  {
    titleKey: "workbench.section.resourcePower",
    shortcutKey: "X",
    buttonKeys: [
      "workbench.button.waterPump",
      "workbench.button.powerPost",
      "workbench.button.thermalPool",
    ],
  },
  {
    titleKey: "workbench.section.warehouse",
    shortcutKey: "C",
    buttonKeys: [
      "workbench.button.darkOutlet",
      "workbench.button.darkInlet",
      "workbench.button.warehouseStoragePort",
      "workbench.button.warehousePickupPort",
      "workbench.button.liquidTank",
      "workbench.button.warehouseBusSegment",
      "workbench.button.warehouseBusSource",
      "workbench.button.protocolStorage",
    ],
  },
  {
    titleKey: "workbench.section.production",
    shortcutKey: "V",
    buttonKeys: [
      "workbench.button.reactorPool",
      "workbench.button.grinder",
      "workbench.button.fillingMachine",
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

  return (
    <div className="placement-panel">
      {PLACEMENT_SECTIONS.map((section, sectionIndex) => {
        const isOperationSection = sectionIndex === 0;
        const isResourcePowerSection = section.titleKey === "workbench.section.resourcePower";
        const sectionTitleId = `placement-section-${sectionIndex}`;
        const sectionButtonStartIndex = PLACEMENT_SECTIONS.slice(0, sectionIndex).reduce(
          (count, currentSection) => count + currentSection.buttonKeys.length,
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
                {section.buttonKeys.map((buttonKey, buttonIndex) => {
                  const iconPath = resolvePlacementIconPath(sectionButtonStartIndex + buttonIndex);
                  const hotkey = isOperationSection
                    ? OPERATION_BUTTON_HOTKEYS.get(buttonKey) ?? null
                    : DEVICE_SHORTCUT_KEYS[buttonIndex % DEVICE_SHORTCUT_KEYS.length];

                  return (
                    <button
                      className={isOperationSection
                        ? "placement-button placement-action-button"
                        : "placement-button placement-device-button"}
                      key={buttonKey}
                      onClick={handleUiEvent}
                      type="button"
                    >
                      <span className="button-icon" aria-hidden="true">
                        <img alt="" className="button-icon-image" src={iconPath} />
                      </span>
                      <span className="placement-button-label">{t(buttonKey)}</span>
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
