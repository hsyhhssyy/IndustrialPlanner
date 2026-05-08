import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import { Fragment, type ComponentProps } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { PlacementGroup } from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  getVisiblePlacementOperationButtons,
  type PlacementOperationButtonDefinition,
} from "@/app/shell/panels/placement-operation-buttons";
import { isTouchScreenProfile } from "@/shared/browser/screen-profile";

const DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

// ─── 设备图标路径映射 ───
function resolveDeviceIconPath(entityId: string): string {
  // 特殊映射：entity id 与图标文件名不一致的情况
  const SPECIAL_ICON_MAP: Record<string, string> = {
    "item_port_liquid_filling_pd_mc_1": "/device-icons/item_port_filling_pd_mc_1.webp",
  };
  if (SPECIAL_ICON_MAP[entityId]) return SPECIAL_ICON_MAP[entityId];
  return `/device-icons/${entityId}.webp`;
}

// ─── uiGroup → 分组配置映射 ───
const UI_GROUP_SECTION_CONFIG: Record<PlacementGroup, {
  titleKey: string;
  shortcutKeyId: ShortcutKeyId;
}> = {
  beltLogistics: {
    titleKey: "workbench.section.beltLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  },
  pipeLogistics: {
    titleKey: "workbench.section.pipeLogistics",
    shortcutKeyId: SHORTCUT_KEY.PLACE_PIPE,
  },
  resourcePower: {
    titleKey: "workbench.section.resourcePower",
    shortcutKeyId: SHORTCUT_KEY.RESOURCES_POWER,
  },
  warehouse: {
    titleKey: "workbench.section.warehouse",
    shortcutKeyId: SHORTCUT_KEY.WAREHOUSE,
  },
  basicProduction: {
    titleKey: "workbench.section.production",
    shortcutKeyId: SHORTCUT_KEY.BASIC_PRODUCTION,
  },
  advancedManufacturing: {
    titleKey: "workbench.section.advancedManufacturing",
    shortcutKeyId: SHORTCUT_KEY.SYNTHESIS,
  },
};

/** 设备分组在面板中的显示顺序 */
const DEVICE_SECTION_ORDER: readonly PlacementGroup[] = [
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
  "basicProduction",
  "advancedManufacturing",
];

// ─── 类型定义 ───

interface PlacementButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly icon?: ComponentProps<typeof WorkbenchIcon>["kind"];
  readonly iconSrc?: string;
  readonly hotkey?: string | null;
  readonly hotkeyKeyId?: ShortcutKeyId;
  readonly visibleWhen?: (appHost: AppHost) => boolean;
  readonly activeWhen?: (appHost: AppHost) => boolean;
}

interface PlacementSectionDefinition {
  readonly uiGroup: PlacementGroup;
  readonly titleKey: string;
  readonly shortcutKey: string | null;
  readonly buttons: readonly PlacementButtonDefinition[];
}

// ─── 动态构建设备分组 ───

function buildPlacementDeviceSections(appHost: AppHost): readonly PlacementSectionDefinition[] {
  // 1. 按 uiGroup 分组设备（过滤 hidden，组内按 id 排序）
  const groupedByUiGroup = new Map<PlacementGroup, EntityDefinition[]>();
  for (const group of DEVICE_SECTION_ORDER) {
    groupedByUiGroup.set(group, []);
  }

  for (const entity of appHost.workspace.registry.entityDefinitions) {
    if (entity.uiGroup === "hidden") continue;
    const group = groupedByUiGroup.get(entity.uiGroup);
    if (group) {
      group.push(entity);
    }
  }

  // 组内按 id 排序
  for (const [, entities] of groupedByUiGroup) {
    entities.sort((a, b) => a.id.localeCompare(b.id));
  }

  // 2. 构建设备分组 section
  const deviceSections: PlacementSectionDefinition[] = DEVICE_SECTION_ORDER
    .map((uiGroup) => {
      const config = UI_GROUP_SECTION_CONFIG[uiGroup];
      const entities = groupedByUiGroup.get(uiGroup) ?? [];
      const shortcutKey = appHost.internalActions.getKeyboardShortcutFor(config.shortcutKeyId);

      const buttons: PlacementButtonDefinition[] = entities.map((entity) => ({
        uiButtonId: `placement-${entity.id}`,
        labelKey: entity.nameKey,
      }));

      return {
        uiGroup,
        titleKey: config.titleKey,
        shortcutKey: shortcutKey || null,
        buttons,
      };
    });

  return deviceSections;
}

export const PlacementPanel = observer(function PlacementPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isTouchScreenProfile(screenProfile);
  const showShortcutHints = !isTouchLayout && appHost.state.settings.gameShowHotkeys;
  const deviceSections = buildPlacementDeviceSections(appHost);
  const visibleOperationButtons = getVisiblePlacementOperationButtons(appHost);

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: Pick<PlacementButtonDefinition, "uiButtonId">,
    isDeviceButton: boolean,
  ) => {
    const uiButtonId = isDeviceButton
      ? `ui-left-dock-placement-mode-${button.uiButtonId.replace("placement-", "")}-${event.pointerType === "mouse" ? "mouse-tap" : "touch-tap"}`
      : button.uiButtonId;

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId,
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
        uiButtonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  const renderOperationButton = (button: PlacementOperationButtonDefinition) => {
    const buttonLabel = t(button.labelKey);
    const hotkey = button.hotkey
      ?? (button.hotkeyKeyId
        ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId)
        : null);
    const isActive = button.activeWhen?.(appHost) ?? false;
    const className = isActive
      ? "placement-button placement-action-button is-active"
      : "placement-button placement-action-button";

    return (
      <button
        aria-label={buttonLabel}
        aria-pressed={button.activeWhen ? isActive : undefined}
        className={className}
        data-ui-button-id={button.uiButtonId}
        key={button.uiButtonId}
        onPointerUp={(event) => {
          handleButtonPointerUp(event, button, false);
        }}
        title={buttonLabel}
        type="button"
      >
        <span className="button-icon" aria-hidden="true">
          {button.icon ? <WorkbenchIcon className="button-icon-image" kind={button.icon} /> : null}
          {button.iconSrc ? <img alt="" className="button-icon-image" src={button.iconSrc} /> : null}
        </span>
        {isTouchLayout ? null : <span className="placement-button-label">{buttonLabel}</span>}
        {!isTouchLayout && showShortcutHints && hotkey ? (
          <span className="placement-button-hotkey">{hotkey}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="placement-panel">
      <section
        aria-label={isTouchLayout ? t("workbench.section.operation") : undefined}
        aria-labelledby={isTouchLayout ? undefined : "placement-operation-section"}
        className={isTouchLayout
          ? "placement-panel-group placement-panel-group-operation is-mobile-layout"
          : "placement-panel-group placement-panel-group-operation"}
      >
        {isTouchLayout ? null : (
          <div className="placement-panel-group-header">
            <h3 id="placement-operation-section">{t("workbench.section.operation")}</h3>
          </div>
        )}
        <div
          className={isTouchLayout
            ? "placement-operation-button-list is-mobile-icon-grid"
            : "placement-button-list placement-operation-button-list"}
        >
          {visibleOperationButtons.map((button) => renderOperationButton(button))}
        </div>
      </section>

      <div aria-hidden="true" className="placement-panel-divider" />

      {deviceSections.map((section, sectionIndex) => {
        const sectionTitleId = `placement-device-section-${sectionIndex}`;
        const isPlacementGroupActive = (
          appHost.state.activeTool === "select"
          && appHost.internalState.runtime.selectingPlacementGroup === section.uiGroup
        ) || (
          appHost.state.activeTool === "logistics-placement"
          && appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup === section.uiGroup
        );

        return (
          <Fragment key={section.titleKey}>
            {sectionIndex > 0 ? <div aria-hidden="true" className="placement-panel-divider" /> : null}
            <section
              aria-labelledby={sectionTitleId}
              className={isPlacementGroupActive
                ? "placement-panel-group is-placement-group-active"
                : "placement-panel-group"}
            >
              <div className="placement-panel-group-header">
                <h3 id={sectionTitleId}>{t(section.titleKey)}</h3>
                {showShortcutHints && section.shortcutKey ? (
                  <span className="placement-panel-group-shortcut">{section.shortcutKey}</span>
                ) : null}
              </div>
              <div className={isTouchLayout ? "placement-button-list is-single-column" : "placement-button-list"}>
                {section.buttons.map((button, buttonIndex) => {
                  const hotkey = button.hotkey
                    ?? (button.hotkeyKeyId
                      ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId)
                      : DEVICE_SHORTCUT_KEYS[buttonIndex]);
                  const deviceId = button.uiButtonId.replace("placement-", "");
                  const isActive = appHost.state.activeTool === "single-placement"
                    && appHost.internalState.runtime.singlePlacementDeviceId === deviceId;
                  const showDeviceHotkey = !isTouchLayout && isPlacementGroupActive && hotkey;
                  const className = isActive
                    ? "placement-button placement-device-button is-active"
                    : "placement-button placement-device-button";

                  return (
                    <button
                      aria-pressed={isActive ? isActive : undefined}
                      className={className}
                      data-ui-button-id={button.uiButtonId}
                      key={button.uiButtonId}
                      onPointerUp={(event) => {
                        handleButtonPointerUp(event, button, true);
                      }}
                      type="button"
                    >
                      <span className="button-icon" aria-hidden="true">
                        <img alt="" className="button-icon-image" src={resolveDeviceIconPath(deviceId)} />
                      </span>
                      <span className="placement-button-label">{t(button.labelKey)}</span>
                      {showDeviceHotkey ? <span className="placement-button-hotkey">{hotkey}</span> : null}
                      
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
