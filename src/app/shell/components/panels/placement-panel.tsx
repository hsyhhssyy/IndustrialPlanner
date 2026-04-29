import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import { Fragment, type ComponentProps } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import type { UiGroup } from "@/domain/types/registry/entity-definition";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";

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
const UI_GROUP_SECTION_CONFIG: Record<Exclude<UiGroup, "hidden">, {
  titleKey: string;
  shortcutKeyId: string;
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
const DEVICE_SECTION_ORDER: readonly Exclude<UiGroup, "hidden">[] = [
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
  readonly titleKey: string;
  readonly shortcutKey: string | null;
  readonly buttons: readonly PlacementButtonDefinition[];
}

// ─── 操作区按钮（保持硬编码） ───

const OPERATION_BUTTONS: readonly PlacementButtonDefinition[] = [
  {
    uiButtonId: "placement-tool-select",
    labelKey: "workbench.button.select",
    icon: "select-arrow",
    hotkey: "Esc",
    activeWhen: (appHost) => appHost.state.activeTool === "select",
  },
  {
    uiButtonId: "placement-tool-marquee",
    labelKey: "workbench.button.batchSelect",
    icon: "batch-select",
    hotkey: "X",
    visibleWhen: (appHost) => appHost.state.settings.hypergryphOperationMode,
    activeWhen: (appHost) => appHost.state.activeTool === "marquee",
  },
  {
    uiButtonId: "placement-action-belt-draw",
    labelKey: "workbench.button.beltDraw",
    iconSrc: "/device-icons/item_log_belt_01.webp",
    hotkeyKeyId: SHORTCUT_KEY.PLACE_CONVEYOR,
  },
  {
    uiButtonId: "placement-action-pipe-draw",
    labelKey: "workbench.button.pipeDraw",
    iconSrc: "/device-icons/item_log_pipe_01.webp",
    hotkeyKeyId: SHORTCUT_KEY.PLACE_PIPE,
  },
] as const;

// ─── 动态构建设备分组 ───

function buildPlacementSections(appHost: AppHost): readonly PlacementSectionDefinition[] {
  // 1. 操作区
  const operationSection: PlacementSectionDefinition = {
    titleKey: "workbench.section.operation",
    shortcutKey: null,
    buttons: OPERATION_BUTTONS.filter((b) => (b.visibleWhen?.(appHost) ?? true)),
  };

  // 2. 按 uiGroup 分组设备（过滤 hidden，组内按 id 排序）
  const groupedByUiGroup = new Map<Exclude<UiGroup, "hidden">, typeof ENTITY_DEFINITIONS>();
  for (const group of DEVICE_SECTION_ORDER) {
    groupedByUiGroup.set(group, []);
  }

  for (const entity of ENTITY_DEFINITIONS) {
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

  // 3. 构建设备分组 section
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
        titleKey: config.titleKey,
        shortcutKey: shortcutKey || null,
        buttons,
      };
    });

  return [operationSection, ...deviceSections];
}

export const PlacementPanel = observer(function PlacementPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const screenProfile = appHost.state.screenProfile;
  const isMobileLayout = screenProfile.deviceClass === "mobile";
  const showShortcutHints = screenProfile.deviceClass !== "mobile" && appHost.state.settings.gameShowHotkeys;
  const sections = buildPlacementSections(appHost);

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: PlacementButtonDefinition,
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

  return (
    <div className="placement-panel">
      {sections.map((section, sectionIndex) => {
        const isOperationSection = sectionIndex === 0;
        const isResourcePowerSection = section.titleKey === "workbench.section.resourcePower";
        const sectionTitleId = `placement-section-${sectionIndex}`;

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
                  const hotkey = button.hotkey
                    ?? (button.hotkeyKeyId
                      ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId)
                      : (
                        isOperationSection
                          ? null
                          : DEVICE_SHORTCUT_KEYS[buttonIndex % DEVICE_SHORTCUT_KEYS.length]
                      ));
                  const deviceId = button.uiButtonId.replace("placement-", "");
                  const isActive = isOperationSection
                    ? (button.activeWhen?.(appHost) ?? false)
                    : (
                      appHost.state.activeTool === "single-placement"
                      && appHost.internalState.runtime.singlePlacementDeviceId === deviceId
                    );
                  const className = isOperationSection
                    ? (isActive
                      ? "placement-button placement-action-button is-active"
                      : "placement-button placement-action-button")
                    : (isActive
                      ? "placement-button placement-device-button is-active"
                      : "placement-button placement-device-button");

                  return (
                    <button
                      aria-pressed={isActive || button.activeWhen ? isActive : undefined}
                      className={className}
                      data-ui-button-id={button.uiButtonId}
                      key={button.uiButtonId}
                      onPointerUp={(event) => {
                        handleButtonPointerUp(event, button, !isOperationSection);
                      }}
                      type="button"
                    >
                      {isOperationSection ? (
                        <span className="button-icon" aria-hidden="true">
                          {button.icon ? <WorkbenchIcon className="button-icon-image" kind={button.icon} /> : null}
                          {button.iconSrc ? <img alt="" className="button-icon-image" src={button.iconSrc} /> : null}
                        </span>
                      ) : (
                        <span className="button-icon" aria-hidden="true">
                          <img alt="" className="button-icon-image" src={resolveDeviceIconPath(deviceId)} />
                        </span>
                      )}
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
