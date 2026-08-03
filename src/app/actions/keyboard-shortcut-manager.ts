import type { AppHost } from "@/app/host/app-host";
import { makeAutoObservable, reaction } from "mobx";
import {
  readFromLocalStorageWithMigration,
  saveToLocalStorageWithVersion,
  type StorageMigration,
} from "@/shared/storage/migration";

// ─── Key 常量定义 ───
/** 所有快捷键 key 的常量对象。新增快捷键只需在此添加。 */
export const SHORTCUT_KEY = {
  PLACE_CONVEYOR:      "shortcut-place-conveyor",
  PLACE_PIPE:          "shortcut-place-pipe",
  RESOURCES_POWER:     "shortcut-resources-power",
  WAREHOUSE:           "shortcut-warehouse",
  BASIC_PRODUCTION:    "shortcut-basic-production",
  SYNTHESIS:           "shortcut-synthesis",
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

/** 所有有效的 key id 集合（用于运行时校验） */
const VALID_SHORTCUT_KEYS: ReadonlySet<string> = new Set(Object.values(SHORTCUT_KEY));

// ─── 默认值 ───
/** 所有快捷键的默认值（鹰角网络模式下的固定值）。 */
const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutKeyId, string>> = {
  [SHORTCUT_KEY.PLACE_CONVEYOR]:   "E",
  [SHORTCUT_KEY.PLACE_PIPE]:       "Q",
  [SHORTCUT_KEY.RESOURCES_POWER]:  "G",
  [SHORTCUT_KEY.WAREHOUSE]:        "C",
  [SHORTCUT_KEY.BASIC_PRODUCTION]: "V",
  [SHORTCUT_KEY.SYNTHESIS]:        "B",
  [SHORTCUT_KEY.SAVE_BLUEPRINT]:   "Ctrl+S",
  // AI-REMOVED 2026-08-03:
  // Reason: 返回选择使用硬编码 Escape，不再属于可配置快捷键默认值。
  // Trigger: ST2-RQ-002 禁止绑定 Escape。
  // Evidence: SHORTCUT_KEY.RETURN_SELECT 已从有效快捷键常量中归档。
  // Replacement: hypergryph-select-gesture-module.ts 的 Escape 硬编码判断。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // [SHORTCUT_KEY.RETURN_SELECT]:    "Esc",
  [SHORTCUT_KEY.ROTATE]:           "R",
  [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
  [SHORTCUT_KEY.ROTATE_VIEWPORT]:  "Ctrl+R",
  [SHORTCUT_KEY.DELETE_DEVICE]:    "F",
  [SHORTCUT_KEY.MOVE_SELECTION]:   "M",
  [SHORTCUT_KEY.COPY_SELECTION]:   "Ctrl+C",
  [SHORTCUT_KEY.PASTE_SELECTION]:  "Ctrl+V",
  [SHORTCUT_KEY.UNDO]:             "Ctrl+Z",
  [SHORTCUT_KEY.REDO]:             "Ctrl+Y",
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "P",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]:   "H",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]:      "K",
  [SHORTCUT_KEY.QUICK_PLACE]:            "Z",
  [SHORTCUT_KEY.OPEN_TOOLBOX]:           "T",
  [SHORTCUT_KEY.PAN_VIEWPORT_UP]:        "W;ArrowUp",
  [SHORTCUT_KEY.PAN_VIEWPORT_DOWN]:      "S;ArrowDown",
  [SHORTCUT_KEY.PAN_VIEWPORT_LEFT]:      "A;ArrowLeft",
  [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT]:     "D;ArrowRight",
  [SHORTCUT_KEY.MARQUEE]:                "X",
};

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
    for (const key of Object.values(SHORTCUT_KEY)) {
      this.shortcuts[key] = SHORTCUT_DEFAULTS[key];
    }
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

function doesShortcutMatchKeyEvent(options: {
  shortcut: string;
  code: string | null;
  key: string | null;
  modifiers: ShortcutEventModifiers;
}): boolean {
  const parsedShortcuts = parseShortcutBindings(options.shortcut);

  return parsedShortcuts.some((parsedShortcut) => (
    doShortcutModifiersMatch(parsedShortcut.modifiers, options.modifiers)
    && doesShortcutPrimaryKeyMatch(parsedShortcut.primaryKey, options.code, options.key)
  ));
}

function doesShortcutPrimaryKeyMatch(
  primaryKey: string,
  code: string | null,
  eventKey: string | null,
): boolean {
  const key = normalizeShortcut(eventKey ?? "");
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

interface ParsedShortcutBinding {
  readonly modifiers: Required<ShortcutEventModifiers>;
  readonly primaryKey: string;
}

function parseShortcutBindings(shortcut: string): readonly ParsedShortcutBinding[] {
  return shortcut
    .split(";")
    .slice(0, 2)
    .map((binding) => parseShortcutBinding(binding))
    .filter((binding): binding is ParsedShortcutBinding => binding !== null);
}

function parseShortcutBinding(shortcut: string): ParsedShortcutBinding | null {
  const parts = shortcut
    .split("+")
    .map((part) => normalizeShortcut(part))
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
    return null;
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

function normalizeShortcut(shortcut: string): string {
  const normalized = shortcut.trim().toLowerCase();

  return normalized === "+" ? "plus" : normalized;
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

  return code.trim().toLowerCase();
}

function normalizeConfigurableShortcutValue(value: string): string {
  const [first = "", second = ""] = value
    .trim()
    .split(";", 2)
    .map((binding) => binding.trim());
  const normalizedSlots: [string, string] = [
    isReservedEscapeBinding(first) ? "" : first,
    isReservedEscapeBinding(second) ? "" : second,
  ];

  if (normalizedSlots[1] === "") {
    return normalizedSlots[0];
  }

  return `${normalizedSlots[0]};${normalizedSlots[1]}`;
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
