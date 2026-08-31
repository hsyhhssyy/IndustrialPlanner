import type { AppHost } from "@/app/host/app-host";
import { makeAutoObservable, reaction } from "mobx";
import {
  readFromLocalStorageWithMigration,
  saveToLocalStorageWithVersion,
  type StorageMigration,
} from "@/shared/storage/migration";
import type { UiKey } from "@/shared/i18n";

// ─── Key 常量定义 ───
/** 所有快捷键 key 的常量对象。新增快捷键只需在此添加。 */
export const SHORTCUT_KEY = {
  PLACE_CONVEYOR:      "shortcut-place-conveyor",
  PLACE_PIPE:          "shortcut-place-pipe",
  RESOURCES_POWER:     "shortcut-resources-power",
  WAREHOUSE:           "shortcut-warehouse",
  BASIC_PRODUCTION:    "shortcut-basic-production",
  SYNTHESIS:           "shortcut-synthesis",
  CHEAT:               "shortcut-cheat",
  SAVE_BLUEPRINT:      "shortcut-save-blueprint",
  // AI-REMOVED 2026-08-03:
  // Reason: Escape 类功能必须保持硬编码，不允许进入可配置快捷键体系。
  // Trigger: ST2-RQ-002 明确禁止任何快捷键绑定 Escape。
  // Evidence: 返回选择模式由 hypergryph-select-gesture-module.ts 直接判断 Escape。
  // Replacement: hypergryph-select-gesture-module.ts 的 Escape 硬编码判断。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // RETURN_SELECT:       "shortcut-return-select",
  ROTATE:              "shortcut-rotate",
  SWITCH_DEVICE_MODE:  "shortcut-switch-device-mode",
  ROTATE_VIEWPORT:     "shortcut-rotate-viewport",
  DELETE_DEVICE:       "shortcut-delete-device",
  MOVE_SELECTION:      "shortcut-move-selection",
  COPY_SELECTION:      "shortcut-copy-selection",
  PASTE_SELECTION:     "shortcut-paste-selection",
  UNDO:                "shortcut-undo",
  REDO:                "shortcut-redo",
  TOGGLE_PLACEMENT_PANEL: "shortcut-toggle-placement-panel",
  TOGGLE_BLUEPRINT_PANEL: "shortcut-toggle-blueprint-panel",
  TOGGLE_HISTORY_PANEL:   "shortcut-toggle-history-panel",
  TOGGLE_BASE_PANEL:      "shortcut-toggle-base-panel",
  QUICK_PLACE:            "shortcut-quick-place",
  OPEN_TOOLBOX:           "shortcut-open-toolbox",
  PAN_VIEWPORT_UP:        "shortcut-pan-viewport-up",
  PAN_VIEWPORT_DOWN:      "shortcut-pan-viewport-down",
  PAN_VIEWPORT_LEFT:      "shortcut-pan-viewport-left",
  PAN_VIEWPORT_RIGHT:     "shortcut-pan-viewport-right",
  MARQUEE:                "shortcut-marquee",
} as const;

/** 从 SHORTCUT_KEY 推导出的联合类型 */
export type ShortcutKeyId = typeof SHORTCUT_KEY[keyof typeof SHORTCUT_KEY];

export interface ShortcutEventModifiers {
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
}

export type ShortcutActionGroup =
  | "quick-access"
  | "placement"
  | "operation"
  | "viewport"
  | "history";

export interface ConfigurableShortcutActionSpec {
  readonly id: ShortcutKeyId;
  readonly group: ShortcutActionGroup;
  readonly labelKey: UiKey;
  readonly defaultBindings: readonly [string, string?];
  readonly configurable: true;
}

export interface FixedShortcutActionSpec {
  readonly id: string;
  readonly labelKey: UiKey;
  readonly defaultBindings: readonly [string];
  readonly configurable: false;
}

export type ShortcutActionSpec = ConfigurableShortcutActionSpec | FixedShortcutActionSpec;

export interface ShortcutActionGroupSpec {
  readonly id: ShortcutActionGroup;
  readonly labelKey: UiKey;
}

/** 所有有效的 key id 集合（用于运行时校验） */
const VALID_SHORTCUT_KEYS: ReadonlySet<string> = new Set(Object.values(SHORTCUT_KEY));

// ─── 默认值 ───
/** 可配置 Action 的产品元数据。作用域只能由可执行 Shortcut Route 定义。 */
// AI-CORRECTION 2026-08-31: 上述标题与注释对应下方 SHORTCUT_ACTION_SPECS；
// 分组标题元数据先行登记，供设置页按同一 Action registry 分段展示。
// AI-CORRECTION 2026-08-31: 统一 registry 纳入固定 Action 后，可配置元数据现由
// CONFIGURABLE_SHORTCUT_ACTION_SPECS 提供，SHORTCUT_ACTION_SPECS 表示全部键盘 Action。
/** 可配置 Action 的展示分组元数据；分组只影响设置页信息架构。 */
export const SHORTCUT_ACTION_GROUP_SPECS: readonly ShortcutActionGroupSpec[] = [
  { id: "quick-access", labelKey: "keyboardShortcutDialog.group.quickAccess" },
  { id: "placement", labelKey: "keyboardShortcutDialog.group.placement" },
  { id: "operation", labelKey: "keyboardShortcutDialog.group.operation" },
  { id: "viewport", labelKey: "keyboardShortcutDialog.group.viewport" },
  { id: "history", labelKey: "keyboardShortcutDialog.group.history" },
];

/** 可配置 Action 的名称、分组与默认双槽位元数据。 */
export const CONFIGURABLE_SHORTCUT_ACTION_SPECS: readonly ConfigurableShortcutActionSpec[] = [
  { id: SHORTCUT_KEY.QUICK_PLACE, group: "quick-access", labelKey: "settingsField.shortcut-quick-place", defaultBindings: ["Z"], configurable: true },
  { id: SHORTCUT_KEY.OPEN_TOOLBOX, group: "quick-access", labelKey: "settingsField.shortcut-open-toolbox", defaultBindings: ["T"], configurable: true },
  { id: SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL, group: "quick-access", labelKey: "settingsField.shortcut-toggle-placement-panel", defaultBindings: ["P"], configurable: true },
  { id: SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL, group: "quick-access", labelKey: "settingsField.shortcut-toggle-blueprint-panel", defaultBindings: ["L"], configurable: true },
  { id: SHORTCUT_KEY.TOGGLE_HISTORY_PANEL, group: "quick-access", labelKey: "settingsField.shortcut-toggle-history-panel", defaultBindings: ["H"], configurable: true },
  { id: SHORTCUT_KEY.TOGGLE_BASE_PANEL, group: "quick-access", labelKey: "settingsField.shortcut-toggle-base-panel", defaultBindings: ["K"], configurable: true },
  { id: SHORTCUT_KEY.PLACE_CONVEYOR, group: "placement", labelKey: "settingsField.shortcut-place-conveyor", defaultBindings: ["E"], configurable: true },
  { id: SHORTCUT_KEY.PLACE_PIPE, group: "placement", labelKey: "settingsField.shortcut-place-pipe", defaultBindings: ["Q"], configurable: true },
  { id: SHORTCUT_KEY.RESOURCES_POWER, group: "placement", labelKey: "settingsField.shortcut-resources-power", defaultBindings: ["G"], configurable: true },
  { id: SHORTCUT_KEY.WAREHOUSE, group: "placement", labelKey: "settingsField.shortcut-warehouse", defaultBindings: ["C"], configurable: true },
  { id: SHORTCUT_KEY.BASIC_PRODUCTION, group: "placement", labelKey: "settingsField.shortcut-basic-production", defaultBindings: ["V"], configurable: true },
  { id: SHORTCUT_KEY.SYNTHESIS, group: "placement", labelKey: "settingsField.shortcut-synthesis", defaultBindings: ["B"], configurable: true },
  { id: SHORTCUT_KEY.CHEAT, group: "placement", labelKey: "settingsField.shortcut-cheat", defaultBindings: ["U"], configurable: true },
  { id: SHORTCUT_KEY.SAVE_BLUEPRINT, group: "operation", labelKey: "settingsField.shortcut-save-blueprint", defaultBindings: ["Ctrl+S"], configurable: true },
  { id: SHORTCUT_KEY.ROTATE, group: "operation", labelKey: "settingsField.shortcut-rotate", defaultBindings: ["R"], configurable: true },
  { id: SHORTCUT_KEY.SWITCH_DEVICE_MODE, group: "operation", labelKey: "settingsField.shortcut-switch-device-mode", defaultBindings: ["Tab"], configurable: true },
  { id: SHORTCUT_KEY.MARQUEE, group: "operation", labelKey: "settingsField.shortcut-marquee", defaultBindings: ["X"], configurable: true },
  { id: SHORTCUT_KEY.DELETE_DEVICE, group: "operation", labelKey: "settingsField.shortcut-delete-device", defaultBindings: ["F"], configurable: true },
  { id: SHORTCUT_KEY.MOVE_SELECTION, group: "operation", labelKey: "settingsField.shortcut-move-selection", defaultBindings: ["M"], configurable: true },
  { id: SHORTCUT_KEY.COPY_SELECTION, group: "operation", labelKey: "settingsField.shortcut-copy-selection", defaultBindings: ["Ctrl+C"], configurable: true },
  { id: SHORTCUT_KEY.PASTE_SELECTION, group: "operation", labelKey: "settingsField.shortcut-paste-selection", defaultBindings: ["Ctrl+V"], configurable: true },
  { id: SHORTCUT_KEY.ROTATE_VIEWPORT, group: "viewport", labelKey: "settingsField.shortcut-rotate-viewport", defaultBindings: ["Ctrl+R"], configurable: true },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_UP, group: "viewport", labelKey: "settingsField.shortcut-pan-viewport-up", defaultBindings: ["W", "ArrowUp"], configurable: true },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, group: "viewport", labelKey: "settingsField.shortcut-pan-viewport-down", defaultBindings: ["S", "ArrowDown"], configurable: true },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, group: "viewport", labelKey: "settingsField.shortcut-pan-viewport-left", defaultBindings: ["A", "ArrowLeft"], configurable: true },
  { id: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, group: "viewport", labelKey: "settingsField.shortcut-pan-viewport-right", defaultBindings: ["D", "ArrowRight"], configurable: true },
  { id: SHORTCUT_KEY.UNDO, group: "history", labelKey: "settingsField.shortcut-undo", defaultBindings: ["Ctrl+Z"], configurable: true },
  { id: SHORTCUT_KEY.REDO, group: "history", labelKey: "settingsField.shortcut-redo", defaultBindings: ["Ctrl+Y"], configurable: true },
];

const FIXED_DIGIT_BINDINGS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

/** 固定 Action 仍进入统一注册表，但不会出现在普通快捷键设置中。 */
export const FIXED_SHORTCUT_ACTION_SPECS: readonly FixedShortcutActionSpec[] = [
  { id: "fixed.quick-place.close", labelKey: "keyboardShortcutAction.quickPlaceClose", defaultBindings: ["Esc"], configurable: false },
  ...FIXED_DIGIT_BINDINGS.map((binding, index): FixedShortcutActionSpec => ({
    id: `fixed.quick-place.favorite-${index}`,
    labelKey: "keyboardShortcutAction.quickPlaceFavorite",
    defaultBindings: [binding],
    configurable: false,
  })),
  { id: "fixed.quick-place.result-next", labelKey: "keyboardShortcutAction.quickPlaceResultNext", defaultBindings: ["ArrowDown"], configurable: false },
  { id: "fixed.quick-place.result-previous", labelKey: "keyboardShortcutAction.quickPlaceResultPrevious", defaultBindings: ["ArrowUp"], configurable: false },
  { id: "fixed.quick-place.confirm", labelKey: "keyboardShortcutAction.quickPlaceConfirm", defaultBindings: ["Enter"], configurable: false },
  ...FIXED_DIGIT_BINDINGS.map((binding, index): FixedShortcutActionSpec => ({
    id: `fixed.placement-device.${index}`,
    labelKey: "keyboardShortcutAction.placementDeviceSlot",
    defaultBindings: [binding],
    configurable: false,
  })),
  { id: "fixed.active-tool.cancel-to-select", labelKey: "keyboardShortcutAction.cancelToSelect", defaultBindings: ["Esc"], configurable: false },
  { id: "fixed.dark-pipe-link.cancel", labelKey: "keyboardShortcutAction.cancelDarkPipeLink", defaultBindings: ["Esc"], configurable: false },
  { id: "fixed.overlap-entity-menu.cancel", labelKey: "keyboardShortcutAction.closeOverlapEntityMenu", defaultBindings: ["Esc"], configurable: false },
];

/** 所有键盘 Action 的统一元数据注册表；作用域仍只由可执行 Shortcut Route 定义。 */
export const SHORTCUT_ACTION_SPECS: readonly ShortcutActionSpec[] = [
  ...CONFIGURABLE_SHORTCUT_ACTION_SPECS,
  ...FIXED_SHORTCUT_ACTION_SPECS,
];
assertShortcutActionSpecs(SHORTCUT_ACTION_SPECS);
assertShortcutActionGroups(SHORTCUT_ACTION_GROUP_SPECS, CONFIGURABLE_SHORTCUT_ACTION_SPECS);

// AI-REMOVED 2026-08-30:
// Reason: 默认值必须由 ActionSpec.defaultBindings 单点生成，避免设置、重置和运行时出现双默认真相。
// Trigger: ST2-RQ-020 的 P0 默认重置门槛。
// Evidence: SHORTCUT_ACTION_SPECS 已覆盖全部 28 个 ShortcutKeyId，并由下方 SHORTCUT_DEFAULTS 派生。
// Replacement: SHORTCUT_ACTION_SPECS in this file
// Risk: Low
// Human Review: Required
//
// Original code:
// const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutKeyId, string>> = {
//   [SHORTCUT_KEY.PLACE_CONVEYOR]:   "E",
//   [SHORTCUT_KEY.PLACE_PIPE]:       "Q",
//   [SHORTCUT_KEY.RESOURCES_POWER]:  "G",
//   [SHORTCUT_KEY.WAREHOUSE]:        "C",
//   [SHORTCUT_KEY.BASIC_PRODUCTION]: "V",
//   [SHORTCUT_KEY.SYNTHESIS]:        "B",
//   [SHORTCUT_KEY.CHEAT]:            "U",
//   [SHORTCUT_KEY.SAVE_BLUEPRINT]:   "Ctrl+S",
//   [SHORTCUT_KEY.ROTATE]:           "R",
//   [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
//   [SHORTCUT_KEY.ROTATE_VIEWPORT]:  "Ctrl+R",
//   [SHORTCUT_KEY.DELETE_DEVICE]:    "F",
//   [SHORTCUT_KEY.MOVE_SELECTION]:   "M",
//   [SHORTCUT_KEY.COPY_SELECTION]:   "Ctrl+C",
//   [SHORTCUT_KEY.PASTE_SELECTION]:  "Ctrl+V",
//   [SHORTCUT_KEY.UNDO]:             "Ctrl+Z",
//   [SHORTCUT_KEY.REDO]:             "Ctrl+Y",
//   [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "P",
//   [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L",
//   [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]:   "H",
//   [SHORTCUT_KEY.TOGGLE_BASE_PANEL]:      "K",
//   [SHORTCUT_KEY.QUICK_PLACE]:            "Z",
//   [SHORTCUT_KEY.OPEN_TOOLBOX]:           "T",
//   [SHORTCUT_KEY.PAN_VIEWPORT_UP]:        "W;ArrowUp",
//   [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]:      "S;ArrowDown",
//   [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]:      "A;ArrowLeft",
//   [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]:     "D;ArrowRight",
//   [SHORTCUT_KEY.MARQUEE]:                "X",
// };
// AI-CORRECTION 2026-08-31: 上述历史 Evidence 与 Replacement 中的 28 项来源现为
// CONFIGURABLE_SHORTCUT_ACTION_SPECS；SHORTCUT_ACTION_SPECS 已扩展为可配置与固定 Action 的统一 registry。
const SHORTCUT_DEFAULTS = Object.fromEntries(
  CONFIGURABLE_SHORTCUT_ACTION_SPECS.map((spec) => [spec.id, spec.defaultBindings.join(";")]),
) as Readonly<Record<ShortcutKeyId, string>>;

const LEGACY_SHORTCUT_MIGRATIONS: Partial<Record<ShortcutKeyId, string>> = {
  [SHORTCUT_KEY.SAVE_BLUEPRINT]: "N",
};

// ─── Contract State 类型 ───
/** 快捷键合约态：字典结构，key 为 ShortcutKeyId，value 为用户绑定的按键字符串 */
export type AppShortcutState = Record<ShortcutKeyId, string>;

// ─── localStorage key ───
export const APP_SHORTCUTS_LOCAL_STORAGE_KEY = "v3-app-shortcuts";
export const APP_SHORTCUTS_STORAGE_VERSION = 1;

type PersistedShortcutState = Partial<Record<ShortcutKeyId, string>>;

const APP_SHORTCUT_MIGRATIONS: readonly StorageMigration<PersistedShortcutState>[] = [
  {
    version: 1,
    migrate: (raw) => migrateLegacyShortcutStateToV1(raw),
  },
];

// ─── Manager 类 ───
export class KeyboardShortcutManager {
  /** 快捷键状态字典（MobX observable） */
  public readonly shortcuts: AppShortcutState;

  private readonly appHost: AppHost;
  private disposeReaction: (() => void) | null = null;

  public constructor(appHost: AppHost) {
    this.appHost = appHost;

    // 初始化：先取默认值，再用 localStorage 覆盖
    const initial = { ...SHORTCUT_DEFAULTS };
    const persisted = readPersistedShortcutState();
    if (persisted !== null) {
      for (const [k, v] of Object.entries(persisted)) {
        if (isShortcutKey(k) && typeof v === "string") {
          // AI-REMOVED 2026-08-03:
          // Reason: 旧存储中的 Escape 绑定也必须按保留键规则清除。
          // Trigger: ST2-RQ-002 禁止配置 Escape。
          // Evidence: normalizeConfigurableShortcutValue 会逐槽剔除 Escape 绑定。
          // Replacement: 下方规范化后的赋值。
          // Risk: Low
          // Human Review: Required
          //
          // Original code:
          // initial[k] = migrateLegacyShortcutValue(k, v.trim());
          initial[k] = normalizeConfigurableShortcutValue(
            migrateLegacyShortcutValue(k, v.trim()),
          );
        }
      }
    }

    this.shortcuts = initial;
    makeAutoObservable<KeyboardShortcutManager, "appHost" | "disposeReaction">(
      this,
      {
        appHost: false,
        disposeReaction: false,
      },
      { autoBind: true },
    );
  }

  /**
   * 启动 localStorage 持久化 reaction。
   * 在 AppHost 创建后调用一次。
   */
  public hookPersistence(): () => void {
    this.disposeReaction = reaction(
      () => JSON.stringify(this.shortcuts),
      () => {
        saveToLocalStorageWithVersion(
          APP_SHORTCUTS_LOCAL_STORAGE_KEY,
          APP_SHORTCUTS_STORAGE_VERSION,
          this.shortcuts,
        );
      },
    );

    return () => {
      this.disposeReaction?.();
      this.disposeReaction = null;
    };
  }

  /**
   * 统一的快捷键写入 action。
   * 所有 keybinding 设置写入都通过此方法。
   * 传入空字符串可清空该快捷键。
   */
  public readonly setShortcutFor = (key: string, value: string): void => {
    if (!isShortcutKey(key)) return;

    const normalized = normalizeConfigurableShortcutValue(value);
    if (normalized === "") {
      // 清空快捷键：显式设为空字符串，表示该功能无快捷键
      this.shortcuts[key] = "";
      return;
    }

    this.shortcuts[key] = normalized;
  };

  /**
   * 根据快捷键 key 获取当前快捷键值。
   * 此方法同时用于：画布上的快捷键显示、settings 界面上的 keybinding 值展示。
   */
  public getKeyboardShortcutFor(key: string): string {
    if (!isShortcutKey(key)) return "";

    // 如果用户显式设置过（包括设为空字符串），使用用户值；
    // 否则回退到默认值。
    if (Object.prototype.hasOwnProperty.call(this.shortcuts, key)) {
      return this.shortcuts[key];
    }

    return SHORTCUT_DEFAULTS[key];
  }

  public isShortcutFor(
    key: string,
    code: string | null,
    eventKey: string | null = null,
    modifiers: ShortcutEventModifiers = {},
  ): boolean {
    if (!isShortcutKey(key)) return false;
    if (isEscapeKeyEvent(code, eventKey)) return false;

    return doesShortcutMatchKeyEvent({
      shortcut: this.getKeyboardShortcutFor(key),
      code,
      key: eventKey,
      modifiers,
    });
  }

  /**
   * 判断当前按键组合是否匹配任意已配置快捷键。
   * 用于 DOM 层拦截浏览器默认行为（如 Ctrl+S 保存网页）。
   */
  public matchesAnyShortcut(
    code: string | null,
    eventKey: string | null = null,
    modifiers: ShortcutEventModifiers = {},
  ): boolean {
    for (const key of Object.values(SHORTCUT_KEY)) {
      if (this.isShortcutFor(key, code, eventKey, modifiers)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 将所有快捷键重置为默认值。
   * 不受鹰角网络模式限制，直接写入 shortcuts 并触发持久化。
   */
  public readonly resetAllShortcutsToDefaults = (): void => {
    this.appHost.gestureActionRouter.assertShortcutRouteIntegrity();
    Object.assign(this.shortcuts, createDefaultShortcutState());
  };

  /** 释放资源 */
  public dispose(): void {
    this.disposeReaction?.();
    this.disposeReaction = null;
  }
}

// ─── 辅助函数 ───
function isShortcutKey(key: string): key is ShortcutKeyId {
  return VALID_SHORTCUT_KEYS.has(key);
}

function readPersistedShortcutState(): PersistedShortcutState | null {
  const migrated = readFromLocalStorageWithMigration<PersistedShortcutState, void>(
    APP_SHORTCUTS_LOCAL_STORAGE_KEY,
    APP_SHORTCUTS_STORAGE_VERSION,
    APP_SHORTCUT_MIGRATIONS,
    undefined,
  );

  return normalizePersistedShortcutState(migrated);
}

function migrateLegacyShortcutStateToV1(raw: unknown): PersistedShortcutState | null {
  const migrated = normalizePersistedShortcutState(raw);
  if (migrated === null) {
    return null;
  }

  const quickPlaceShortcut = SHORTCUT_DEFAULTS[SHORTCUT_KEY.QUICK_PLACE];
  const placementPanelShortcut = SHORTCUT_DEFAULTS[SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL];

  for (const key of Object.values(SHORTCUT_KEY)) {
    if (
      key !== SHORTCUT_KEY.QUICK_PLACE
      && normalizeShortcut(migrated[key] ?? "") === normalizeShortcut(quickPlaceShortcut)
    ) {
      migrated[key] = "";
    }
  }

  migrated[SHORTCUT_KEY.QUICK_PLACE] = quickPlaceShortcut;
  migrated[SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL] =
    isShortcutValueOccupiedByOtherKey(
      migrated,
      placementPanelShortcut,
      SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL,
    )
      ? ""
      : placementPanelShortcut;

  return migrated;
}

function normalizePersistedShortcutState(raw: unknown): PersistedShortcutState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const normalized: PersistedShortcutState = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isShortcutKey(key) || typeof value !== "string") {
      continue;
    }

    normalized[key] = migrateLegacyShortcutValue(key, value.trim());
  }

  return normalized;
}

function isShortcutValueOccupiedByOtherKey(
  shortcuts: PersistedShortcutState,
  value: string,
  ignoredKey: ShortcutKeyId,
): boolean {
  const normalizedValue = normalizeShortcut(value);
  if (normalizedValue === "") {
    return false;
  }

  for (const key of Object.values(SHORTCUT_KEY)) {
    if (key === ignoredKey) {
      continue;
    }

    const candidate = shortcuts[key] ?? SHORTCUT_DEFAULTS[key];
    if (normalizeShortcut(candidate) === normalizedValue) {
      return true;
    }
  }

  return false;
}

export function doesShortcutMatchKeyEvent(options: {
  shortcut: string;
  code: string | null;
  key: string | null;
  modifiers: ShortcutEventModifiers;
}): boolean {
  const parsedShortcuts = parseShortcutBindings(options.shortcut);

  return parsedShortcuts.some((parsedShortcut) => (
    doShortcutModifiersMatch(
      parsedShortcut.modifiers,
      omitPrimaryModifier(parsedShortcut.primaryKey, options.modifiers),
    )
    && doesShortcutPrimaryKeyMatch(parsedShortcut.primaryKey, options.code, options.key)
  ));
}

export function doesShortcutPrimaryKeyMatch(
  primaryKey: string,
  code: string | null,
  eventKey: string | null,
): boolean {
  const key = normalizeShortcutKeyToken(eventKey ?? "");
  if (key === primaryKey) {
    return true;
  }

  const normalizedCode = code ?? "";
  if (primaryKey.length === 1 && primaryKey >= "a" && primaryKey <= "z") {
    return normalizedCode === `Key${primaryKey.toUpperCase()}`;
  }

  if (primaryKey.length === 1 && primaryKey >= "0" && primaryKey <= "9") {
    return normalizedCode === `Digit${primaryKey}` || normalizedCode === `Numpad${primaryKey}`;
  }

  return normalizeShortcutCode(normalizedCode) === primaryKey;
}

export interface ParsedShortcutBinding {
  readonly modifiers: Required<ShortcutEventModifiers>;
  readonly primaryKey: string;
}

export function parseShortcutBindings(shortcut: string): readonly ParsedShortcutBinding[] {
  return shortcut
    .split(";")
    .slice(0, 2)
    .map((binding) => parseShortcutBinding(binding))
    .filter((binding): binding is ParsedShortcutBinding => binding !== null);
}

export function parseShortcutBinding(shortcut: string): ParsedShortcutBinding | null {
  const parts = shortcut
    .split("+")
    .map((part) => normalizeShortcutKeyToken(part))
    .filter((part) => part !== "");

  if (parts.length === 0) {
    return null;
  }

  const modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean } = {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
  let primaryKey: string | null = null;

  for (const part of parts) {
    if (part === "alt" || part === "option") {
      modifiers.alt = true;
      continue;
    }

    if (part === "ctrl" || part === "control") {
      modifiers.ctrl = true;
      continue;
    }

    if (part === "meta" || part === "cmd" || part === "command") {
      modifiers.meta = true;
      continue;
    }

    if (part === "shift") {
      modifiers.shift = true;
      continue;
    }

    if (primaryKey !== null) {
      return null;
    }

    primaryKey = part;
  }

  if (primaryKey === null) {
    if (parts.length !== 1 || !isCanonicalModifier(parts[0] ?? "")) {
      return null;
    }

    primaryKey = parts[0] ?? null;
    if (primaryKey === null) {
      return null;
    }
    modifiers[primaryKey as keyof typeof modifiers] = false;
  }

  return {
    modifiers,
    primaryKey,
  };
}

function doShortcutModifiersMatch(
  expected: Required<ShortcutEventModifiers>,
  actual: ShortcutEventModifiers,
): boolean {
  return (
    expected.alt === (actual.alt ?? false)
    && expected.ctrl === (actual.ctrl ?? false)
    && expected.meta === (actual.meta ?? false)
    && expected.shift === (actual.shift ?? false)
  );
}

function omitPrimaryModifier(
  primaryKey: string,
  modifiers: ShortcutEventModifiers,
): ShortcutEventModifiers {
  if (!isCanonicalModifier(primaryKey)) {
    return modifiers;
  }

  return {
    ...modifiers,
    [primaryKey]: false,
  };
}

function normalizeShortcut(shortcut: string): string {
  const normalized = shortcut.trim().toLowerCase();

  return normalized === "+" ? "plus" : normalized;
}

function normalizeShortcutKeyToken(value: string): string {
  const normalized = normalizeShortcut(value);
  if (
    normalized === "control"
    || normalized === "controlleft"
    || normalized === "controlright"
  ) {
    return "ctrl";
  }
  if (normalized === "shiftleft" || normalized === "shiftright") {
    return "shift";
  }
  if (normalized === "altleft" || normalized === "altright" || normalized === "option") {
    return "alt";
  }
  if (
    normalized === "metaleft"
    || normalized === "metaright"
    || normalized === "cmd"
    || normalized === "command"
  ) {
    return "meta";
  }

  return normalized;
}

function isCanonicalModifier(value: string): value is keyof Required<ShortcutEventModifiers> {
  return value === "alt" || value === "ctrl" || value === "meta" || value === "shift";
}

function normalizeShortcutCode(code: string): string {
  if (code === "Escape") {
    return "esc";
  }

  if (code === "ArrowUp") {
    return "up";
  }

  if (code === "ArrowDown") {
    return "down";
  }

  if (code === "ArrowLeft") {
    return "left";
  }

  if (code === "ArrowRight") {
    return "right";
  }

  return normalizeShortcutKeyToken(code);
}

function normalizeConfigurableShortcutValue(value: string): string {
  const [first = "", second = ""] = value
    .trim()
    .split(";", 2)
    .map((binding) => binding.trim());
  const normalizedSlots: [string, string] = [
    isReservedEscapeBinding(first) ? "" : normalizeModifierOnlyBinding(first),
    isReservedEscapeBinding(second) ? "" : normalizeModifierOnlyBinding(second),
  ];

  if (normalizedSlots[1] === "") {
    return normalizedSlots[0];
  }

  return `${normalizedSlots[0]};${normalizedSlots[1]}`;
}

function normalizeModifierOnlyBinding(binding: string): string {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null || !isCanonicalModifier(parsed.primaryKey)) {
    return binding;
  }

  const hasRequiredModifier = Object.values(parsed.modifiers).some(Boolean);
  if (hasRequiredModifier) {
    return binding;
  }

  return parsed.primaryKey === "ctrl"
    ? "Ctrl"
    : parsed.primaryKey[0]?.toUpperCase() + parsed.primaryKey.slice(1);
}

function createDefaultShortcutState(): AppShortcutState {
  return { ...SHORTCUT_DEFAULTS };
}

function assertShortcutActionSpecs(specs: readonly ShortcutActionSpec[]): void {
  const expectedIds = new Set(Object.values(SHORTCUT_KEY));
  const actualIds = new Set<string>();
  const configurableIds = new Set<ShortcutKeyId>();
  for (const spec of specs) {
    if (actualIds.has(spec.id)) {
      throw new Error(`Duplicate ShortcutActionSpec: ${spec.id}`);
    }
    const defaultBindingCount: number = spec.defaultBindings.length;
    if (defaultBindingCount === 0 || defaultBindingCount > 2) {
      throw new Error(`ShortcutActionSpec has invalid default slots: ${spec.id}`);
    }
    actualIds.add(spec.id);
    if (spec.configurable) {
      configurableIds.add(spec.id);
    }
  }

  const missing = Array.from(expectedIds).filter((shortcutId) => !configurableIds.has(shortcutId));
  const unknown = Array.from(configurableIds).filter((shortcutId) => !expectedIds.has(shortcutId));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `ShortcutActionSpec registry mismatch. missing=${missing.join(",")} unknown=${unknown.join(",")}`,
    );
  }
}

function assertShortcutActionGroups(
  groups: readonly ShortcutActionGroupSpec[],
  actions: readonly ConfigurableShortcutActionSpec[],
): void {
  const groupIds = new Set<ShortcutActionGroup>();
  for (const group of groups) {
    if (groupIds.has(group.id)) {
      throw new Error(`Duplicate ShortcutActionGroupSpec: ${group.id}`);
    }
    groupIds.add(group.id);
  }

  const missingGroupIds = new Set(
    actions
      .map((action) => action.group)
      .filter((groupId) => !groupIds.has(groupId)),
  );
  if (missingGroupIds.size > 0) {
    throw new Error(
      `ShortcutActionGroupSpec registry mismatch. missing=${Array.from(missingGroupIds).join(",")}`,
    );
  }
}

function isReservedEscapeBinding(binding: string): boolean {
  const parsedBinding = parseShortcutBinding(binding);

  return parsedBinding?.primaryKey === "esc" || parsedBinding?.primaryKey === "escape";
}

function isEscapeKeyEvent(code: string | null, eventKey: string | null): boolean {
  return code === "Escape" || normalizeShortcut(eventKey ?? "") === "escape";
}

function migrateLegacyShortcutValue(key: ShortcutKeyId, value: string): string {
  const legacyValue = LEGACY_SHORTCUT_MIGRATIONS[key];
  if (legacyValue !== undefined && normalizeShortcut(value) === normalizeShortcut(legacyValue)) {
    return SHORTCUT_DEFAULTS[key];
  }

  return value;
}
