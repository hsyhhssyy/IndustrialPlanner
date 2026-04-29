import type { AppSettingsReadWrite } from "./state-impl";

/**
 * 快捷键设置 key 的联合类型。
 */
export type ShortcutKey =
  | "shortcut-place-conveyor"
  | "shortcut-place-pipe"
  | "shortcut-resources-power"
  | "shortcut-warehouse"
  | "shortcut-basic-production"
  | "shortcut-synthesis";

/**
 * 所有快捷键的默认值（鹰角网络模式下的固定值）。
 */
const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutKey, string>> = {
  "shortcut-place-conveyor": "E",
  "shortcut-place-pipe": "Q",
  "shortcut-resources-power": "X",
  "shortcut-warehouse": "C",
  "shortcut-basic-production": "V",
  "shortcut-synthesis": "B",
};

const VALID_SHORTCUT_KEYS: ReadonlySet<string> = new Set(Object.keys(SHORTCUT_DEFAULTS));

function isShortcutKey(key: string): key is ShortcutKey {
  return VALID_SHORTCUT_KEYS.has(key);
}

/**
 * 将 settings dialog 中的 kebab-case setting id 映射到 AppSettingsReadWrite 的 camelCase 属性名。
 */
const SHORTCUT_SETTINGS_KEY_MAP: Readonly<Record<ShortcutKey, keyof AppSettingsReadWrite>> = {
  "shortcut-place-conveyor": "shortcutPlaceConveyor",
  "shortcut-place-pipe": "shortcutPlacePipe",
  "shortcut-resources-power": "shortcutResourcesPower",
  "shortcut-warehouse": "shortcutWarehouse",
  "shortcut-basic-production": "shortcutBasicProduction",
  "shortcut-synthesis": "shortcutSynthesis",
};

/**
 * KeyboardShortcutManager 负责解析快捷键的值：
 * - 如果当前处于鹰角网络模式（hypergryphOperationMode），始终返回默认值。
 * - 否则从 AppSettings 中读取用户自定义的值。
 * - 如果传入的 key 不是有效的快捷键设置 key，返回空字符串。
 */
export class KeyboardShortcutManager {
  public constructor(
    private readonly getSettings: () => AppSettingsReadWrite,
  ) {}

  /**
   * 根据快捷键设置 key 获取当前的快捷键值。
   * @param key - settings dialog 中的快捷键 setting id（free text，如 "shortcut-place-conveyor"）
   * @returns 快捷键字符串，如果 key 无效则返回空字符串
   */
  public getKeyboardShortcutFor(key: string): string {
    if (!isShortcutKey(key)) {
      return "";
    }

    const settings = this.getSettings();

    // 鹰角网络模式下始终返回默认值
    if (settings.hypergryphOperationMode) {
      return SHORTCUT_DEFAULTS[key];
    }

    // 非鹰角模式下从 settings 读取
    const value = settings[SHORTCUT_SETTINGS_KEY_MAP[key]];

    return typeof value === "string" && value !== "" ? value : SHORTCUT_DEFAULTS[key];
  }
}
