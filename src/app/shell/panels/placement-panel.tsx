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
import { KeyboardShortcutPrompt } from "@/app/shell/shared";
import LucideChevronDown from "~icons/lucide/chevron-down";
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
// AI-REMOVED 2026-07-21:
// Reason: 变体菜单触发区域改为独立下拉按钮，主按钮 hover/长按不再打开菜单。
// Trigger: 新设计要求放置主体与尾部下拉按钮分离。
// Evidence: PlacementDeviceButton 现在只在 placement-entity-variant-trigger 上调用 openVariantMenu。
// Replacement: PlacementDeviceButton 的 toggleVariantMenu 和 triggerButtonRef。
// Risk: Low；触屏端仍可直接点击尾部按钮打开菜单。
// Human Review: Required
//
// Original code:
// const PLACEMENT_VARIANT_LONG_PRESS_MS = 500;
// const PLACEMENT_VARIANT_LONG_PRESS_MOVE_SLOP_PX = 8;
// const PLACEMENT_VARIANT_HOVER_CLOSE_DELAY_MS = 140;

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

// AI-REMOVED 2026-07-21:
// Reason: 放置面板不再用端帽 mask 表达变体，改为直接显示 mode 图片。
// Trigger: 新设计要求尾部为普通样式图标加下拉按钮。
// Evidence: entityVariant.iconPath 现在由 registry 指向 MachineMode 图标，并通过 img 渲染。
// AI-CORRECTION 2026-07-21: MachineMode PNG 是白色 mask，当前通过普通小图标 mask 着色渲染。
// Replacement: resolveVariantModeIconSrc。
// Risk: Low；菜单与按钮仍使用同一 EntityVariantDefinition.iconPath。
// Human Review: Required
//
// Original code:
// const VARIANT_CAP_COLOR_BY_NAME: Readonly<Record<string, string>> = {
//   normal: "var(--placement-variant-cap-solid)",
//   solidtrans: "var(--placement-variant-cap-solid)",
//   liquid: "var(--placement-variant-cap-liquid)",
//   liquidtrans: "var(--placement-variant-cap-liquid)",
//   gas: "var(--placement-variant-cap-gas)",
//   gastrans: "var(--placement-variant-cap-gas)",
// };
//
// function resolveVariantCapStyle(entityVariant: EntityVariantDefinition): CSSProperties {
//   const maskImage = `url("${createPublicAssetUrl(entityVariant.iconPath)}")`;
//
//   return {
//     backgroundColor: VARIANT_CAP_COLOR_BY_NAME[entityVariant.variantName]
//       ?? "var(--placement-button-bg-end)",
//     maskImage,
//     WebkitMaskImage: maskImage,
//   };
// }

function resolveVariantModeIconSrc(entityVariant: EntityVariantDefinition): string {
  return createPublicAssetUrl(entityVariant.iconPath);
}

function resolveVariantModeIconStyle(entityVariant: EntityVariantDefinition): CSSProperties {
  const maskImage = `url("${resolveVariantModeIconSrc(entityVariant)}")`;

  return {
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
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // AI-REMOVED 2026-07-21:
  // Reason: 菜单不再由主按钮 hover/长按控制，相关计时状态不再参与交互。
  // Trigger: 新设计要求尾部独立下拉按钮是唯一展开入口。
  // Evidence: 主按钮仅保留放置事件，触发按钮通过 triggerButtonRef 作为菜单锚点。
  // Replacement: triggerButtonRef。
  // Risk: Low；外部点击、Esc、resize/scroll 关闭逻辑仍保留。
  // Human Review: Required
  //
  // Original code:
  // const hoverCloseTimerRef = useRef<number | null>(null);
  // const longPressTimerRef = useRef<number | null>(null);
  // const longPressPointerRef = useRef<{
  //   readonly pointerId: number;
  //   readonly startX: number;
  //   readonly startY: number;
  // } | null>(null);
  // const openedByLongPressRef = useRef(false);
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

  const openVariantMenu = () => {
    if (!canOpenVariantMenu) {
      return;
    }

    const anchor = triggerButtonRef.current?.getBoundingClientRect();
    if (anchor !== undefined) {
      setMenuAnchor(anchor);
    }
  };

  const toggleVariantMenu = () => {
    if (menuAnchor === null) {
      openVariantMenu();
      return;
    }
    setMenuAnchor(null);
  };

  // AI-REMOVED 2026-07-21:
  // Reason: 主按钮 hover/长按打开菜单的行为已被尾部下拉按钮替代。
  // Trigger: 新设计要求下拉触发区域不再是主按钮任意位置。
  // Evidence: openVariantMenu 仅读取 triggerButtonRef，主按钮 pointer 事件不再调用菜单逻辑。
  // Replacement: toggleVariantMenu。
  // Risk: Low；键盘和指针仍可通过真实 button 打开菜单。
  // Human Review: Required
  //
  // Original code:
  // const cancelHoverClose = () => { ... };
  // const scheduleHoverClose = () => { ... };
  // const clearLongPressTimer = () => { ... };
  // const startLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => { ... };
  // const handleLongPressPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => { ... };
  // const finishLongPress = (event: ReactPointerEvent<HTMLButtonElement>): boolean => { ... };
  // const cancelLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => { ... };

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

  // AI-REMOVED 2026-07-21:
  // Reason: hover/长按计时器已随旧触发方式删除，不再需要卸载清理。
  // Trigger: 菜单展开入口收敛为尾部下拉按钮。
  // Evidence: 组件不再创建 hoverCloseTimerRef 或 longPressTimerRef。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => () => {
  //   cancelHoverClose();
  //   clearLongPressTimer();
  // }, []);

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
      ref={shellRef}
    >
      {/* AI-REMOVED 2026-07-21:
          Reason: 主按钮区域不再负责展开变体菜单，避免放置与展开边界混杂。
          Trigger: 新设计要求尾部下拉按钮是唯一菜单触发区域。
          Evidence: 下方 placement-entity-variant-trigger 是独立 button。
          Replacement: placement-entity-variant-trigger 的 pointer/key handlers。
          Risk: Low。
          Human Review: Required

          Original code:
          onPointerEnter={(event) => { ... openVariantMenu(); }}
          onPointerLeave={(event) => { ... scheduleHoverClose(); }}
      */}
      <button
        aria-pressed={isActive ? isActive : undefined}
        className={cm(styles, className, entityVariant === undefined ? null : "has-entity-variant")}
        data-ui-button-id={button.uiButtonId}
        onPointerDown={onButtonPointerDown}
        onPointerUp={(event) => {
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
        {/* AI-REMOVED 2026-08-03:
            Reason: 设备快捷键提示不再直接渲染文字。
            Trigger: ST2-RQ-002 快捷键图片化展示。
            Evidence: 下方 KeyboardShortcutPrompt 使用 input-prompts SVG。
            Replacement: 下方 showDeviceHotkey 分支。
            Risk: Low
            Human Review: Required

            Original code:
            {showDeviceHotkey ? <span className={cm(styles, "placement-button-hotkey")}>{hotkey}</span> : null}
        */}
        {showDeviceHotkey ? (
          <span className={cm(styles, "placement-button-hotkey")}>
            <KeyboardShortcutPrompt shortcut={hotkey ?? ""} size="small" />
          </span>
        ) : null}
        {/* AI-REMOVED 2026-07-21:
            Reason: 变体端帽已替换为尾部独立 mode 图标下拉按钮。
            Trigger: 新设计要求去掉端帽，只在下拉按钮显示 mode 图标。
            Evidence: placement-entity-variant-trigger 内渲染 placement-entity-variant-mode-icon。
            Replacement: placement-entity-variant-trigger。
            Risk: Low。
            Human Review: Required

            Original code:
            {entityVariant === undefined ? null : (
              <span
                aria-hidden="true"
                className={cm(styles, "placement-entity-variant-cap")}
                style={resolveVariantCapStyle(entityVariant)}
                title={variantLongName ?? undefined}
              />
            )}
        */}
      </button>
      {entityVariant !== undefined && !canOpenVariantMenu ? (
        <span
          aria-hidden="true"
          className={cm(styles, "placement-entity-variant-indicator")}
          data-entity-variant-name={entityVariant.variantName}
          title={variantLongName ?? undefined}
        >
          <span
            className={cm(styles, "placement-entity-variant-mode-icon")}
            data-machine-mode-icon="true"
            style={resolveVariantModeIconStyle(entityVariant)}
          />
        </span>
      ) : null}
      {canOpenVariantMenu ? (
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={variantLongName ?? buttonLabel}
          className={cm(styles, "placement-entity-variant-trigger")}
          data-entity-variant-name={entityVariant.variantName}
          data-ui-button-id={`${button.uiButtonId}-variant-trigger`}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            toggleVariantMenu();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onButtonPointerDown(event);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            if (event.pointerType === "mouse" && event.button !== 0) {
              return;
            }
            toggleVariantMenu();
          }}
          ref={triggerButtonRef}
          title={variantLongName ?? undefined}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cm(styles, "placement-entity-variant-mode-icon")}
            data-machine-mode-icon="true"
            style={resolveVariantModeIconStyle(entityVariant as EntityVariantDefinition)}
          />
          <LucideChevronDown className={cm(styles, "placement-entity-variant-chevron")} aria-hidden="true" />
        </button>
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
                      <span
                        className={cm(styles, "placement-entity-variant-mode-icon")}
                        data-machine-mode-icon="true"
                        style={resolveVariantModeIconStyle(variantDefinition)}
                      />
                    </span>
                    <span className={cm(styles, "placement-variant-menu-label")}>{menuItemLabel}</span>
                    {/* AI-REMOVED 2026-07-21:
                        Reason: 菜单项头部图标改为 mode 图标，不再渲染尾部端帽。
                        Trigger: 新设计要求打开的菜单里头部图标是 mode 图标。
                        Evidence: placement-variant-menu-icon 现在使用 resolveVariantModeIconSrc。
                        AI-CORRECTION 2026-07-21: MachineMode PNG 为白色 mask，当前由 placement-entity-variant-mode-icon 以 mask 样式渲染。
                        Replacement: placement-variant-menu-icon img。
                        AI-CORRECTION 2026-07-21: 实际替代实现是 placement-variant-menu-icon 内的 placement-entity-variant-mode-icon span。
                        Risk: Low。
                        Human Review: Required

                        Original code:
                        <span
                          aria-hidden="true"
                          className={cm(styles, "placement-entity-variant-cap placement-variant-menu-cap")}
                          style={resolveVariantCapStyle(variantDefinition)}
                        />
                    */}
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
        {/* AI-REMOVED 2026-08-03:
            Reason: 操作按钮快捷键提示不再直接渲染文字。
            Trigger: ST2-RQ-002 快捷键图片化展示。
            Evidence: 下方 KeyboardShortcutPrompt 使用 input-prompts SVG。
            Replacement: 下方快捷键提示分支。
            Risk: Low
            Human Review: Required

            Original code:
            <span className={cm(styles, "placement-button-hotkey")}>{hotkey}</span>
        */}
        {!isTouchLayout && showShortcutHints && hotkey ? (
          <span className={cm(styles, "placement-button-hotkey")}>
            <KeyboardShortcutPrompt shortcut={hotkey} size="small" />
          </span>
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
                {/* AI-REMOVED 2026-08-03:
                    Reason: 分组快捷键提示不再直接渲染文字。
                    Trigger: ST2-RQ-002 快捷键图片化展示。
                    Evidence: 下方 KeyboardShortcutPrompt 使用 input-prompts SVG。
                    Replacement: 下方分组快捷键提示分支。
                    Risk: Low
                    Human Review: Required

                    Original code:
                    <span className={cm(styles, "placement-panel-group-shortcut")}>{section.shortcutKey}</span>
                */}
                {showShortcutHints && section.shortcutKey ? (
                  <span className={cm(styles, "placement-panel-group-shortcut")}>
                    <KeyboardShortcutPrompt shortcut={section.shortcutKey} size="small" />
                  </span>
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
