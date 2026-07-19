import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import { runInAction } from "mobx";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityVariantDefinition } from "@/domain/registry/types/entity-variant-definition";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import type { PlacementGroup } from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import {
  getVisiblePlacementOperationButtons,
  type PlacementOperationButtonDefinition,
} from "@/app/shell/panels/placement-operation-buttons";
import { createDeviceIconAssetUrl, createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import {
  collapseEntityVariantDefinitions,
  resolveEntityCraftGroupKey,
  resolveEntityVariantDefinitions,
  resolveEntityVariantName,
} from "@/shared/entity-variants";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
const COMPACT_DEVICE_LABEL_MAX_WIDTH = 6.5;
const PLACEMENT_VARIANT_LONG_PRESS_MS = 500;
const PLACEMENT_VARIANT_LONG_PRESS_MOVE_SLOP_PX = 8;
const PLACEMENT_VARIANT_HOVER_CLOSE_DELAY_MS = 140;

function estimateDeviceLabelWidth(label: string): number {
  let width = 0;
  for (const character of label) {
    width += (character.codePointAt(0) ?? 0) <= 0x7f ? 0.5 : 1;
  }
  return width;
}

// ─── 设备图标路径映射 ───
function resolveDeviceIconPath(definition: EntityDefinition): string {
  // 特殊映射：entity id 与图标文件名不一致的情况
  const SPECIAL_ICON_MAP: Record<string, string> = {
    "liquid_filling_pd_mc_1": "item_port_filling_pd_mc_1",
  };
  return createDeviceIconAssetUrl(SPECIAL_ICON_MAP[definition.id] ?? definition.spriteId);
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
  readonly entityVariant?: EntityVariantDefinition;
  readonly craftGroupKey?: string;
  readonly variantDefinitions?: readonly EntityDefinition[];
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
    if (entity.tags.includes("不可摆放")) continue;
    if (!canPlaceEntityDefinitionInCurrentBase(appHost, entity)) continue;
    const group = groupedByUiGroup.get(entity.uiGroup);
    if (group) {
      group.push(entity);
    }
  }

  // 组内按 displayOrder 排序（order 越小越靠前），同 order 按 id 兜底
  for (const [, entities] of groupedByUiGroup) {
    entities.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  }

  // 2. 构建设备分组 section
  const deviceSections: PlacementSectionDefinition[] = DEVICE_SECTION_ORDER
    .map((uiGroup) => {
      const config = UI_GROUP_SECTION_CONFIG[uiGroup];
      const entities = groupedByUiGroup.get(uiGroup) ?? [];
      const shortcutKey = appHost.internalActions.getKeyboardShortcutFor(config.shortcutKeyId);

      const visibleEntities = appHost.state.settings.collapseDeviceModes
        ? collapseEntityVariantDefinitions({
            definitions: entities,
            selectedVariantNameByCraftGroup:
              appHost.state.workbench.selectedPlacementVariantByCraftGroup,
          })
        : entities;
      const buttons: PlacementButtonDefinition[] = visibleEntities.map((entity) => {
        const variantDefinitions = resolveEntityVariantDefinitions({
          definitionId: entity.id,
          definitions: entities,
        });
        const variantName = resolveEntityVariantName(entity);
        const entityVariant = variantDefinitions.length > 1 && variantName !== null
          ? appHost.workspace.registry.entityVariantDefinitions[variantName]
          : undefined;

        return {
          uiButtonId: `placement-${entity.id}`,
          labelKey: entity.nameKey,
          entityVariant,
          craftGroupKey: entityVariant === undefined
            ? undefined
            : resolveEntityCraftGroupKey(entity) ?? undefined,
          variantDefinitions: entityVariant === undefined ? undefined : variantDefinitions,
        };
      });

      return {
        uiGroup,
        titleKey: config.titleKey,
        shortcutKey: shortcutKey || null,
        buttons,
      };
    })
    .filter((section) => section.buttons.length > 0);

  return deviceSections;
}

const VARIANT_CAP_COLOR_BY_NAME: Readonly<Record<string, string>> = {
  normal: "var(--placement-variant-cap-solid)",
  solidtrans: "var(--placement-variant-cap-solid)",
  liquid: "var(--placement-variant-cap-liquid)",
  liquidtrans: "var(--placement-variant-cap-liquid)",
  gas: "var(--placement-variant-cap-gas)",
  gastrans: "var(--placement-variant-cap-gas)",
};

function resolveVariantCapStyle(entityVariant: EntityVariantDefinition): CSSProperties {
  const maskImage = `url("${createPublicAssetUrl(entityVariant.iconPath)}")`;

  return {
    backgroundColor: VARIANT_CAP_COLOR_BY_NAME[entityVariant.variantName]
      ?? "var(--placement-button-bg-end)",
    maskImage,
    WebkitMaskImage: maskImage,
  };
}

function resolveVariantMenuStyle(
  anchor: DOMRect,
  itemCount: number,
): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 336 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 480 : window.innerHeight;
  const width = Math.min(320, Math.max(240, viewportWidth - 16));
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
  const estimatedHeight = Math.min(300, itemCount * 46 + 8);
  const openAbove = anchor.bottom + estimatedHeight + 8 > viewportHeight
    && anchor.top > estimatedHeight + 8;

  return {
    left,
    top: openAbove ? anchor.top - 4 : anchor.bottom + 4,
    width,
    transform: openAbove ? "translateY(-100%)" : undefined,
  };
}

function persistSelectedPlacementVariant(
  appHost: AppHost,
  craftGroupKey: string,
  definition: EntityDefinition,
): void {
  const variantName = resolveEntityVariantName(definition);
  if (variantName === null) {
    return;
  }

  runInAction(() => {
    appHost.internalState.workbench.selectedPlacementVariantByCraftGroup = {
      ...appHost.internalState.workbench.selectedPlacementVariantByCraftGroup,
      [craftGroupKey]: variantName,
    };
  });
}

function triggerPlacementDeviceFromKeyboard(
  appHost: AppHost,
  deviceId: string,
  event: ReactKeyboardEvent<HTMLButtonElement>,
): void {
  appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-mouse-tap`,
    button: 0,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    sourceEvent: event.nativeEvent,
  });
}

const PlacementDeviceButton = observer(function PlacementDeviceButton({
  appHost,
  button,
  buttonLabel,
  deviceId,
  hotkey,
  isActive,
  labelClassName,
  onButtonPointerDown,
  onButtonPointerUp,
  showDeviceHotkey,
}: {
  readonly appHost: AppHost;
  readonly button: PlacementButtonDefinition;
  readonly buttonLabel: string;
  readonly deviceId: string;
  readonly hotkey: string | null | undefined;
  readonly isActive: boolean;
  readonly labelClassName: string;
  readonly onButtonPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onButtonPointerUp: (
    event: ReactPointerEvent<HTMLButtonElement>,
    button: Pick<PlacementButtonDefinition, "uiButtonId">,
    isDeviceButton: boolean,
  ) => void;
  readonly showDeviceHotkey: boolean;
}) {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mainButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressPointerRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
  } | null>(null);
  const openedByLongPressRef = useRef(false);
  const t = appHost.actions.translate;
  const entityVariant = button.entityVariant;
  const craftGroupKey = button.craftGroupKey;
  const variantDefinitions = button.variantDefinitions ?? [];
  const definition = appHost.workspace.registry.entityDefinitions.find((entry) => entry.id === deviceId);
  const canOpenVariantMenu = appHost.state.settings.collapseDeviceModes
    && entityVariant !== undefined
    && craftGroupKey !== undefined
    && variantDefinitions.length > 1;
  const isMenuOpen = canOpenVariantMenu && menuAnchor !== null;
  const variantLongName = entityVariant === undefined
    ? null
    : t(entityVariant.longNameKey);
  const className = isActive
    ? "placement-button placement-device-button is-active"
    : "placement-button placement-device-button";

  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const scheduleHoverClose = () => {
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      setMenuAnchor(null);
    }, PLACEMENT_VARIANT_HOVER_CLOSE_DELAY_MS);
  };

  const openVariantMenu = () => {
    if (!canOpenVariantMenu) {
      return;
    }

    const anchor = mainButtonRef.current?.getBoundingClientRect();
    if (anchor !== undefined) {
      setMenuAnchor(anchor);
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canOpenVariantMenu || (event.pointerType !== "touch" && event.pointerType !== "pen")) {
      return;
    }

    clearLongPressTimer();
    openedByLongPressRef.current = false;
    longPressPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      openedByLongPressRef.current = true;
      openVariantMenu();
    }, PLACEMENT_VARIANT_LONG_PRESS_MS);
  };

  const handleLongPressPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = longPressPointerRef.current;
    if (pointer === null || pointer.pointerId !== event.pointerId || openedByLongPressRef.current) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pointer.startX,
      event.clientY - pointer.startY,
    );
    if (distance > PLACEMENT_VARIANT_LONG_PRESS_MOVE_SLOP_PX) {
      clearLongPressTimer();
      longPressPointerRef.current = null;
    }
  };

  const finishLongPress = (event: ReactPointerEvent<HTMLButtonElement>): boolean => {
    const pointer = longPressPointerRef.current;
    if (pointer === null || pointer.pointerId !== event.pointerId) {
      return false;
    }

    clearLongPressTimer();
    longPressPointerRef.current = null;
    const openedByLongPress = openedByLongPressRef.current;
    openedByLongPressRef.current = false;
    return openedByLongPress;
  };

  const cancelLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (longPressPointerRef.current?.pointerId !== event.pointerId) {
      return;
    }

    clearLongPressTimer();
    longPressPointerRef.current = null;
    openedByLongPressRef.current = false;
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const closeMenu = () => setMenuAnchor(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (shellRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [isMenuOpen]);

  useEffect(() => () => {
    cancelHoverClose();
    clearLongPressTimer();
  }, []);

  const handleVariantSelection = (
    definition: EntityDefinition,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (craftGroupKey !== undefined) {
      persistSelectedPlacementVariant(appHost, craftGroupKey, definition);
    }
    setMenuAnchor(null);
    onButtonPointerUp(event, { uiButtonId: `placement-${definition.id}` }, true);
  };

  const handleVariantSelectionKeyDown = (
    definition: EntityDefinition,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    if (craftGroupKey !== undefined) {
      persistSelectedPlacementVariant(appHost, craftGroupKey, definition);
    }
    setMenuAnchor(null);
    triggerPlacementDeviceFromKeyboard(appHost, definition.id, event);
  };

  return (
    <div
      className={cm(
        styles,
        entityVariant === undefined
          ? "placement-device-button-shell"
          : "placement-device-button-shell has-entity-variant",
      )}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" || !canOpenVariantMenu) {
          return;
        }
        cancelHoverClose();
        openVariantMenu();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && canOpenVariantMenu) {
          scheduleHoverClose();
        }
      }}
      ref={shellRef}
    >
      <button
        aria-expanded={canOpenVariantMenu ? isMenuOpen : undefined}
        aria-haspopup={canOpenVariantMenu ? "menu" : undefined}
        aria-pressed={isActive ? isActive : undefined}
        className={cm(styles, className, entityVariant === undefined ? null : "has-entity-variant")}
        data-ui-button-id={button.uiButtonId}
        onPointerCancel={cancelLongPress}
        onPointerDown={(event) => {
          onButtonPointerDown(event);
          startLongPress(event);
        }}
        onPointerMove={handleLongPressPointerMove}
        onPointerUp={(event) => {
          if (finishLongPress(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onButtonPointerUp(event, button, true);
        }}
        ref={mainButtonRef}
        type="button"
      >
        <span className={cm(styles, "button-icon")} aria-hidden="true">
          <img
            alt=""
            className={cm(styles, "button-icon-image")}
            src={definition === undefined ? "" : resolveDeviceIconPath(definition)}
          />
        </span>
        <span className={cm(styles, labelClassName)}>{buttonLabel}</span>
        {showDeviceHotkey ? <span className={cm(styles, "placement-button-hotkey")}>{hotkey}</span> : null}
        {entityVariant === undefined ? null : (
          <span
            aria-hidden="true"
            className={cm(styles, "placement-entity-variant-cap")}
            style={resolveVariantCapStyle(entityVariant)}
            title={variantLongName ?? undefined}
          />
        )}
      </button>
      {canOpenVariantMenu ? (
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={variantLongName ?? buttonLabel}
          className={cm(styles, "placement-entity-variant-trigger")}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            if (menuAnchor === null) {
              openVariantMenu();
            } else {
              setMenuAnchor(null);
            }
          }}
          onPointerCancel={cancelLongPress}
          onPointerDown={(event) => {
            event.stopPropagation();
            onButtonPointerDown(event);
            startLongPress(event);
          }}
          onPointerMove={handleLongPressPointerMove}
          onPointerUp={(event) => {
            event.stopPropagation();
            if (finishLongPress(event)) {
              event.preventDefault();
              return;
            }
            if (event.pointerType === "touch" || event.pointerType === "pen") {
              openVariantMenu();
            }
          }}
          title={variantLongName ?? undefined}
          type="button"
        />
      ) : null}
      <OverlayStackLayer
        kind="system"
        layerId={`placement-variant-menu-${craftGroupKey ?? deviceId}`}
        visible={isMenuOpen}
      >
        {({ zIndex }) => (
          <div className={cm(styles, "placement-variant-menu-layer")} style={{ zIndex }}>
            {/* AI-REMOVED 2026-07-19:
                Reason: 全屏 backdrop 会截获鼠标命中，破坏主按钮到浮层菜单的 hover 链路。
                Trigger: PC 端悬停主按钮任意位置显示菜单，并允许鼠标移入菜单。
                Evidence: 真实浏览器中全屏命中层会让主按钮立即收到 pointerleave；外部关闭已由 document pointerdown 处理。
                Replacement: PlacementDeviceButton 的 handleDocumentPointerDown。
                Risk: Low；外部点击会在关闭菜单后继续传递给原目标，符合普通弹出菜单行为。
                Human Review: Required

                Original code:
                <div
                  aria-hidden="true"
                  className={cm(styles, "placement-variant-menu-backdrop")}
                  onPointerDown={() => setMenuAnchor(null)}
                />
            */}
            <div
              aria-label={buttonLabel}
              className={cm(styles, "placement-variant-menu")}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") {
                  cancelHoverClose();
                }
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") {
                  scheduleHoverClose();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              ref={menuRef}
              role="menu"
              style={resolveVariantMenuStyle(menuAnchor as DOMRect, variantDefinitions.length)}
            >
              {variantDefinitions.map((definition) => {
                const variantName = resolveEntityVariantName(definition);
                const variantDefinition = variantName === null
                  ? undefined
                  : appHost.workspace.registry.entityVariantDefinitions[variantName];
                if (variantDefinition === undefined) {
                  return null;
                }

                const isSelected = definition.id === deviceId;
                const menuItemLabel = `${t(definition.nameKey)} · ${t(variantDefinition.longNameKey)}`;

                return (
                  <button
                    aria-checked={isSelected}
                    className={cm(
                      styles,
                      isSelected
                        ? "placement-variant-menu-item is-selected"
                        : "placement-variant-menu-item",
                    )}
                    data-entity-variant-name={variantName}
                    key={definition.id}
                    onKeyDown={(event) => handleVariantSelectionKeyDown(definition, event)}
                    onPointerDown={onButtonPointerDown}
                    onPointerUp={(event) => handleVariantSelection(definition, event)}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className={cm(styles, "placement-variant-menu-icon")} aria-hidden="true">
                      <img alt="" src={resolveDeviceIconPath(definition)} />
                    </span>
                    <span className={cm(styles, "placement-variant-menu-label")}>{menuItemLabel}</span>
                    <span
                      aria-hidden="true"
                      className={cm(styles, "placement-entity-variant-cap placement-variant-menu-cap")}
                      style={resolveVariantCapStyle(variantDefinition)}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </OverlayStackLayer>
    </div>
  );
});

export const PlacementPanel = observer(function PlacementPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化以在切换基地后重新过滤设备列表
  useEditorDocumentSnapshot(editor);
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const showShortcutHints = !isTouchLayout && appHost.state.settings.gameShowHotkeys;
  const deviceSections = buildPlacementDeviceSections(appHost);
  const visibleOperationButtons = getVisiblePlacementOperationButtons(appHost);

  const handleButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
  };

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
        className={cm(styles, className)}
        data-ui-button-id={button.uiButtonId}
        key={button.uiButtonId}
        onPointerDown={handleButtonPointerDown}
        onPointerUp={(event) => {
          handleButtonPointerUp(event, button, false);
        }}
        title={buttonLabel}
        type="button"
      >
        <span className={cm(styles, "button-icon")} aria-hidden="true">
          {button.icon ? <WorkbenchIcon className={cm(styles, "button-icon-image")} kind={button.icon} /> : null}
          {button.iconSrc ? <img alt="" className={cm(styles, "button-icon-image")} src={button.iconSrc} /> : null}
        </span>
        {isTouchLayout ? null : <span className={cm(styles, "placement-button-label")}>{buttonLabel}</span>}
        {!isTouchLayout && showShortcutHints && hotkey ? (
          <span className={cm(styles, "placement-button-hotkey")}>{hotkey}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div className={cm(styles, "placement-panel")}>
      <section
        aria-label={isTouchLayout ? t("workbench.section.operation") : undefined}
        aria-labelledby={isTouchLayout ? undefined : "placement-operation-section"}
        className={cm(styles, isTouchLayout
          ? "placement-panel-group placement-panel-group-operation is-mobile-layout"
          : "placement-panel-group placement-panel-group-operation")}
      >
        {isTouchLayout ? null : (
          <div className={cm(styles, "placement-panel-group-header")}>
            <h3 id="placement-operation-section">{t("workbench.section.operation")}</h3>
          </div>
        )}
        <div
          className={cm(styles, isTouchLayout
            ? "placement-operation-button-list is-mobile-icon-grid"
            : "placement-button-list placement-operation-button-list")}
        >
          {visibleOperationButtons.map((button) => renderOperationButton(button))}
        </div>
      </section>

      <div aria-hidden="true" className={cm(styles, "placement-panel-divider")} />

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
            {sectionIndex > 0 ? <div aria-hidden="true" className={cm(styles, "placement-panel-divider")} /> : null}
            <section
              aria-labelledby={sectionTitleId}
              className={cm(styles, isPlacementGroupActive
                ? "placement-panel-group is-placement-group-active"
                : "placement-panel-group")}
            >
              <div className={cm(styles, "placement-panel-group-header")}>
                <h3 id={sectionTitleId}>{t(section.titleKey)}</h3>
                {showShortcutHints && section.shortcutKey ? (
                  <span className={cm(styles, "placement-panel-group-shortcut")}>{section.shortcutKey}</span>
                ) : null}
              </div>
              <div className={cm(styles, isTouchLayout ? "placement-button-list is-single-column" : "placement-button-list")}>
                {section.buttons.map((button, buttonIndex) => {
                  const buttonLabel = t(button.labelKey);
                  const hotkey = button.hotkey
                    ?? (button.hotkeyKeyId
                      ? appHost.internalActions.getKeyboardShortcutFor(button.hotkeyKeyId)
                      : DEVICE_SHORTCUT_KEYS[buttonIndex]);
                  const deviceId = button.uiButtonId.replace("placement-", "");
                  const activePlacementDeviceId = appHost.internalState.runtime.singlePlacementDeviceId;
                  const isActive = appHost.state.activeTool === "single-placement"
                    && (
                      activePlacementDeviceId === deviceId
                      || (
                        appHost.state.settings.collapseDeviceModes
                        && button.variantDefinitions?.some((definition) =>
                          definition.id === activePlacementDeviceId,
                        ) === true
                      )
                    );
                  const showDeviceHotkey = Boolean(
                    !isTouchLayout && isPlacementGroupActive && hotkey,
                  );
                  const labelClassName = estimateDeviceLabelWidth(buttonLabel) > COMPACT_DEVICE_LABEL_MAX_WIDTH
                    ? "placement-button-label is-compact"
                    : "placement-button-label";

                  return (
                    <PlacementDeviceButton
                      appHost={appHost}
                      button={button}
                      buttonLabel={buttonLabel}
                      deviceId={deviceId}
                      hotkey={hotkey}
                      isActive={isActive}
                      key={button.uiButtonId}
                      labelClassName={labelClassName}
                      onButtonPointerDown={handleButtonPointerDown}
                      onButtonPointerUp={handleButtonPointerUp}
                      showDeviceHotkey={showDeviceHotkey}
                    />
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
