import type { AppHost } from "@/app/host/app-host";
import { makeAutoObservable, reaction } from "mobx";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

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
  RETURN_SELECT:       "shortcut-return-select",
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
  [SHORTCUT_KEY.RETURN_SELECT]:    "Esc",
  [SHORTCUT_KEY.ROTATE]:           "R",
  [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
  [SHORTCUT_KEY.ROTATE_VIEWPORT]:  "Ctrl+R",
  [SHORTCUT_KEY.DELETE_DEVICE]:    "F",
  [SHORTCUT_KEY.MOVE_SELECTION]:   "M",
  [SHORTCUT_KEY.COPY_SELECTION]:   "Ctrl+C",
  [SHORTCUT_KEY.PASTE_SELECTION]:  "Ctrl+V",
  [SHORTCUT_KEY.UNDO]:             "Ctrl+Z",
  [SHORTCUT_KEY.REDO]:             "Ctrl+Y",
  [SHORTCUT_KEY.TOGGLE_PLACEMENT_PANEL]: "Z",
  [SHORTCUT_KEY.TOGGLE_BLUEPRINT_PANEL]: "L",
  [SHORTCUT_KEY.TOGGLE_HISTORY_PANEL]:   "H",
  [SHORTCUT_KEY.TOGGLE_BASE_PANEL]:      "K",
};

const LEGACY_SHORTCUT_MIGRATIONS: Partial<Record<ShortcutKeyId, string>> = {
  [SHORTCUT_KEY.SAVE_BLUEPRINT]: "N",
};

// ─── Contract State 类型 ───
/** 快捷键合约态：字典结构，key 为 ShortcutKeyId，value 为用户绑定的按键字符串 */
export type AppShortcutState = Record<ShortcutKeyId, string>;

// ─── localStorage key ───
export const APP_SHORTCUTS_LOCAL_STORAGE_KEY = "v3-app-shortcuts";

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
    const persisted = readFromLocalStorage<Partial<AppShortcutState>>(
      APP_SHORTCUTS_LOCAL_STORAGE_KEY,
    );
    if (persisted !== null) {
      for (const [k, v] of Object.entries(persisted)) {
        if (isShortcutKey(k) && typeof v === "string" && v.trim() !== "") {
          initial[k] = migrateLegacyShortcutValue(k, v.trim());
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
        saveToLocalStorage(APP_SHORTCUTS_LOCAL_STORAGE_KEY, this.shortcuts);
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
   * 鹰角网络模式下静默拒绝。
   */
  public readonly setShortcutFor = (key: string, value: string): void => {
    if (!isShortcutKey(key)) return;
    if (this.appHost.state.settings.hypergryphOperationMode) return;

    const normalized = value.trim();
    if (normalized === "") return;

    this.shortcuts[key] = normalized;
  };

  /**
   * 根据快捷键 key 获取当前快捷键值。
   * 鹰角网络模式下始终返回默认值。
   * 此方法同时用于：画布上的快捷键显示、settings 界面上的 keybinding 值展示。
   */
  public getKeyboardShortcutFor(key: string): string {
    if (!isShortcutKey(key)) return "";
    if (this.appHost.state.settings.hypergryphOperationMode) return SHORTCUT_DEFAULTS[key];

    return this.shortcuts[key] || SHORTCUT_DEFAULTS[key];
  }

  public isShortcutFor(
    key: string,
    code: string | null,
    eventKey: string | null = null,
    modifiers: ShortcutEventModifiers = {},
  ): boolean {
    if (!isShortcutKey(key)) return false;

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

function doesShortcutMatchKeyEvent(options: {
  shortcut: string;
  code: string | null;
  key: string | null;
  modifiers: ShortcutEventModifiers;
}): boolean {
  const parsedShortcut = parseShortcutBinding(options.shortcut);
  if (parsedShortcut === null) {
    return false;
  }

  if (!doShortcutModifiersMatch(parsedShortcut.modifiers, options.modifiers)) {
    return false;
  }

  return doesShortcutPrimaryKeyMatch(parsedShortcut.primaryKey, options.code, options.key);
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

function parseShortcutBinding(shortcut: string): {
  modifiers: Required<ShortcutEventModifiers>;
  primaryKey: string;
} | null {
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
  return shortcut.trim().toLowerCase();
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

function migrateLegacyShortcutValue(key: ShortcutKeyId, value: string): string {
  const legacyValue = LEGACY_SHORTCUT_MIGRATIONS[key];
  if (legacyValue !== undefined && normalizeShortcut(value) === normalizeShortcut(legacyValue)) {
    return SHORTCUT_DEFAULTS[key];
  }

  return value;
}
