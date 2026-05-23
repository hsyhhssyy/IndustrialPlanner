import { makeAutoObservable } from "mobx";

import type { MessageKey } from "@/shared/i18n/messages";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

export const USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY = "v3-user-settings-dialog";

export type SettingsGroupId = "system" | "display" | "game" | "arknights-operation" | "shortcuts" | "other" | "debug";

export type WorkbenchSettingControlValue = string | number | boolean;

interface WorkbenchSettingEditableWhenDefinition {
  readonly settingId: string;
  readonly equals: WorkbenchSettingControlValue;
}

interface WorkbenchSettingBaseDefinition {
  readonly id: string;
  readonly labelKey?: MessageKey;
  readonly labelText?: string;
  readonly descriptionKey?: MessageKey;
  readonly descriptionText?: string;
  readonly disabled?: boolean;
  readonly editableWhen?: WorkbenchSettingEditableWhenDefinition;
}

interface WorkbenchSelectOptionDefinition {
  readonly value: string;
  readonly labelKey: MessageKey;
}

interface WorkbenchSelectSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "select";
  readonly defaultValue: string;
  readonly options: readonly WorkbenchSelectOptionDefinition[];
}

interface WorkbenchSliderSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "slider";
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

interface WorkbenchSwitchSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "switch";
  readonly defaultValue: boolean;
}

interface WorkbenchKeybindingSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "keybinding";
  readonly defaultValue: string;
}

export type WorkbenchSettingDefinition =
  | WorkbenchSelectSettingDefinition
  | WorkbenchSliderSettingDefinition
  | WorkbenchSwitchSettingDefinition
  | WorkbenchKeybindingSettingDefinition;

export interface WorkbenchSettingsGroupDefinition {
  readonly id: SettingsGroupId;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly items: readonly WorkbenchSettingDefinition[];
}

interface WorkbenchSettingExternalBinding {
  readonly readValue: () => WorkbenchSettingControlValue;
  readonly writeValue: (value: WorkbenchSettingControlValue) => void;
}

interface WorkbenchSettingsDialogControllerOptions {
  readonly externalBindings?: Readonly<Record<string, WorkbenchSettingExternalBinding>>;
  readonly shortcutReader?: (key: string) => string;
  readonly shortcutWriter?: (key: string, value: string) => void;
}

interface PersistedUserSettingsDialogState {
  readonly selectedGroupId: SettingsGroupId;
  readonly values: Record<string, WorkbenchSettingControlValue>;
}

const SIMPLIFIED_DEVICE_ICONS_SETTING_ID = "game-use-simplified-device-icons";
const ALWAYS_SHOW_GRID_LINES_SETTING_ID = "game-always-show-grid-lines";
const SHOW_GRASS_BACKGROUND_SETTING_ID = "game-show-grass-background";
const SHOW_DEVICE_NAMES_SETTING_ID = "game-show-device-names";
const SHOW_DEVICE_ICONS_SETTING_ID = "game-show-device-icons";

export const WORKBENCH_SETTINGS_GROUPS = [
  {
    id: "system",
    labelKey: "settingsGroup.system",
    descriptionKey: "settingsGroup.systemDescription",
    items: [
      {
        id: "system-language",
        kind: "select",
        labelKey: "settingsField.language",
        descriptionKey: "settingsField.languageDescription",
        defaultValue: "zh-CN",
        options: [
          { value: "zh-CN", labelKey: "settingsOption.languageZhHans" },
          { value: "en-US", labelKey: "settingsOption.languageEnglish" },
        ],
      },
      {
        id: "system-theme",
        kind: "select",
        labelKey: "settingsField.theme",
        descriptionKey: "settingsField.themeDescription",
        defaultValue: "ayu-light",
        options: [
          { value: "ayu-light", labelKey: "settingsOption.ayuLight" },
          { value: "ayu-dark", labelKey: "settingsOption.ayuDark" },
        ],
      },
    ],
  },
  {
    id: "display",
    labelKey: "settingsGroup.display",
    descriptionKey: "settingsGroup.displayDescription",
    items: [
      {
        id: "display-frame-rate-limit",
        kind: "select",
        labelKey: "settingsField.frameRateLimit",
        descriptionKey: "settingsField.frameRateLimitDescription",
        defaultValue: "unlimited",
        options: [
          { value: "30", labelKey: "settingsOption.frameRate30" },
          { value: "60", labelKey: "settingsOption.frameRate60" },
          { value: "unlimited", labelKey: "settingsOption.unlimited" },
        ],
      },
    ],
  },
  {
    id: "game",
    labelKey: "settingsGroup.game",
    descriptionKey: "settingsGroup.gameDescription",
    items: [
      {
        id: "game-arknights-operation-mode",
        kind: "switch",
        labelKey: "settingsField.arknightsOperationMode",
        descriptionKey: "settingsField.arknightsOperationModeDescription",
        defaultValue: true,
        disabled: true,
      },
      {
        id: "game-use-simplified-device-icons",
        kind: "switch",
        labelKey: "settingsField.useSimplifiedDeviceIcons",
        descriptionKey: "settingsField.useSimplifiedDeviceIconsDescription",
        defaultValue: false,
      },
      {
        id: SHOW_DEVICE_NAMES_SETTING_ID,
        kind: "switch",
        labelText: "显示设备名称",
        descriptionText: "在设备上显示名称文本。",
        defaultValue: true,
      },
      {
        id: SHOW_DEVICE_ICONS_SETTING_ID,
        kind: "switch",
        labelText: "显示设备图标",
        descriptionText: "在设备上显示图标；开启蓝图样式设备图片时会锁定为开启。",
        defaultValue: false,
        editableWhen: {
          settingId: SIMPLIFIED_DEVICE_ICONS_SETTING_ID,
          equals: false,
        },
      },
      {
        id: "game-use-inspector-panel",
        kind: "switch",
        labelKey: "settingsField.useInspectorPanel",
        descriptionKey: "settingsField.useInspectorPanelDescription",
        defaultValue: false,
      },
      {
        id: "game-show-hotkeys",
        kind: "switch",
        labelKey: "settingsField.showHotkeys",
        descriptionKey: "settingsField.showHotkeysDescription",
        defaultValue: true,
      },
      {
        id: "game-always-show-grid-lines",
        kind: "switch",
        labelKey: "settingsField.alwaysShowGridLines",
        descriptionKey: "settingsField.alwaysShowGridLinesDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-use-simplified-device-icons",
          equals: false,
        },
      },
      {
        id: "game-show-grass-background",
        kind: "switch",
        labelKey: "settingsField.showGrassBackground",
        descriptionKey: "settingsField.showGrassBackgroundDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-use-simplified-device-icons",
          equals: false,
        },
      },
    ],
  },
  {
    id: "arknights-operation",
    labelKey: "settingsGroup.arknightsOperation",
    descriptionKey: "settingsGroup.arknightsOperationDescription",
    items: [
      {
        id: "game-arknights-immediate-move",
        kind: "switch",
        labelKey: "settingsField.arknightsImmediateMove",
        descriptionKey: "settingsField.arknightsImmediateMoveDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: true,
        },
      },
      {
        id: "game-arknights-immediate-marquee",
        kind: "switch",
        labelKey: "settingsField.arknightsImmediateMarquee",
        descriptionKey: "settingsField.arknightsImmediateMarqueeDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: true,
        },
      },
      {
        id: "game-arknights-selection-right-dock-sync",
        kind: "switch",
        labelKey: "settingsField.arknightsSelectionRightDockSync",
        descriptionKey: "settingsField.arknightsSelectionRightDockSyncDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: true,
        },
      },
      {
        id: "game-arknights-inspector-open-on-second-click",
        kind: "switch",
        labelKey: "settingsField.arknightsInspectorOpenOnSecondClick",
        descriptionKey: "settingsField.arknightsInspectorOpenOnSecondClickDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: true,
        },
      },
    ],
  },
  {
    id: "shortcuts",
    labelKey: "settingsGroup.shortcuts",
    descriptionKey: "settingsGroup.shortcutsDescription",
    items: [
      {
        id: "shortcut-place-conveyor",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-place-conveyor"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-place-conveyor"),
        defaultValue: "E",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-place-pipe",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-place-pipe"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-place-pipe"),
        defaultValue: "Q",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-resources-power",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-resources-power"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-resources-power"),
        defaultValue: "G",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-warehouse",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-warehouse"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-warehouse"),
        defaultValue: "C",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-basic-production",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-basic-production"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-basic-production"),
        defaultValue: "V",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-synthesis",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-synthesis"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-synthesis"),
        defaultValue: "B",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-save-blueprint",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-save-blueprint"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-save-blueprint"),
        defaultValue: "Ctrl+S",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-return-select",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-return-select"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-return-select"),
        defaultValue: "Esc",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-rotate",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-rotate"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-rotate"),
        defaultValue: "R",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-rotate-viewport",
        kind: "keybinding",
        labelText: "旋转画布",
        descriptionText: "设置旋转画布视角的快捷键。",
        defaultValue: "Ctrl+R",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-delete-device",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-delete-device"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-delete-device"),
        defaultValue: "F",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-move-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-move-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-move-selection"),
        defaultValue: "M",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-copy-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-copy-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-copy-selection"),
        defaultValue: "Ctrl+C",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
      {
        id: "shortcut-paste-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-paste-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-paste-selection"),
        defaultValue: "Ctrl+V",
        editableWhen: {
          settingId: "game-arknights-operation-mode",
          equals: false,
        },
      },
    ],
  },
  {
    id: "other",
    labelKey: "settingsGroup.other",
    descriptionKey: "settingsGroup.otherDescription",
    items: [
      {
        id: "other-debug-mode",
        kind: "switch",
        labelKey: "settingsField.debugMode",
        descriptionKey: "settingsField.debugModeDescription",
        defaultValue: false,
      },
    ],
  },
  {
    id: "debug",
    labelKey: "settingsGroup.debug",
    descriptionKey: "settingsGroup.debugDescription",
    items: [
      {
        id: "debug-show-fps",
        kind: "switch",
        labelKey: "settingsField.showFps",
        descriptionKey: "settingsField.showFpsDescription",
        defaultValue: false,
      },
      {
        id: "debug-show-gesture-diagnostics-window",
        kind: "switch",
        labelKey: "settingsField.showGestureTestWindow",
        descriptionKey: "settingsField.showGestureTestWindowDescription",
        defaultValue: false,
      },
    ],
  },
] as const satisfies readonly [
  WorkbenchSettingsGroupDefinition,
  ...WorkbenchSettingsGroupDefinition[],
];

const DEFAULT_SETTINGS_GROUP = WORKBENCH_SETTINGS_GROUPS[0];

const SETTING_DEFINITION_BY_ID = new Map<string, WorkbenchSettingDefinition>(
  WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
    group.items.map((setting): [string, WorkbenchSettingDefinition] => [setting.id, setting])
  ),
);

/** 所有 keybinding 类型的 setting 定义 */
const ALL_KEYBINDING_SETTINGS: readonly WorkbenchKeybindingSettingDefinition[] =
  WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
    group.items.filter((setting) => setting.kind === "keybinding"),
  ) as WorkbenchKeybindingSettingDefinition[];

/** 从 shortcut setting id 推导 i18n label key。前缀 `settingsField.` + setting id */
function shortcutKeybindingLabelKey(id: string): MessageKey {
  return `settingsField.${id}` as MessageKey;
}

/** 从 shortcut setting id 推导 i18n description key。前缀 `settingsField.` + setting id + `Description` */
function shortcutKeybindingDescriptionKey(id: string): MessageKey {
  return `settingsField.${id}Description` as MessageKey;
}

function createDefaultValues(externalBindingIds: ReadonlySet<string> = new Set()): Record<string, WorkbenchSettingControlValue> {
  const values = Object.fromEntries(
    WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
      group.items
        .filter((setting) => !externalBindingIds.has(setting.id))
        .map((setting) => [setting.id, setting.defaultValue])
    ),
  );

  normalizeLocalValues(values, (settingId) => externalBindingIds.has(settingId) ? undefined : values[settingId]);

  return values;
}

export class WorkbenchSettingsDialogController {
  public selectedGroupId: SettingsGroupId = DEFAULT_SETTINGS_GROUP.id;
  public values: Record<string, WorkbenchSettingControlValue> = {};

  private readonly externalBindings: ReadonlyMap<string, WorkbenchSettingExternalBinding>;
  private readonly externalBindingIds: ReadonlySet<string>;

  public constructor(options: WorkbenchSettingsDialogControllerOptions = {}) {
    const explicitBindings = new Map(Object.entries(options.externalBindings ?? {}));

    // 自动为所有 keybinding 类型生成 externalBinding
    if (options.shortcutReader && options.shortcutWriter) {
      for (const setting of ALL_KEYBINDING_SETTINGS) {
        if (explicitBindings.has(setting.id)) continue;

        explicitBindings.set(setting.id, {
          readValue: () => options.shortcutReader!(setting.id),
          writeValue: (value: WorkbenchSettingControlValue) => {
            if (typeof value === "string") {
              options.shortcutWriter!(setting.id, value);
            }
          },
        });
      }
    }

    this.externalBindings = explicitBindings;
    this.externalBindingIds = new Set(this.externalBindings.keys());
    this.values = createDefaultValues(this.externalBindingIds);
    this.hydrate(readFromLocalStorage<unknown>(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY));

    makeAutoObservable<
      WorkbenchSettingsDialogController,
      | "externalBindingIds"
      | "externalBindings"
      | "getValue"
      | "isSettingEditable"
    >(
      this,
      {
        externalBindingIds: false,
        externalBindings: false,
        getValue: false,
        isSettingEditable: false,
      },
      { autoBind: true },
    );
  }

  public get selectedGroup(): WorkbenchSettingsGroupDefinition {
    return WORKBENCH_SETTINGS_GROUPS.find((group) => group.id === this.selectedGroupId)
      ?? DEFAULT_SETTINGS_GROUP;
  }

  public getValue(settingId: string): WorkbenchSettingControlValue | undefined {
    return this.externalBindings.get(settingId)?.readValue() ?? this.values[settingId];
  }

  public isSettingEditable(settingId: string): boolean {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (!setting) {
      return false;
    }

    if (setting.disabled) {
      return false;
    }

    if (!setting.editableWhen) {
      return true;
    }

    return this.getValue(setting.editableWhen.settingId) === setting.editableWhen.equals;
  }

  public selectGroup(groupId: SettingsGroupId): void {
    if (!WORKBENCH_SETTINGS_GROUPS.some((group) => group.id === groupId)) {
      return;
    }

    if (this.selectedGroupId === groupId) {
      return;
    }

    this.selectedGroupId = groupId;
    this.persist();
  }

  public updateSelectValue(settingId: string, value: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "select" || !this.isSettingEditable(settingId)) {
      return;
    }

    if (!setting.options.some((option) => option.value === value)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue(value);

      return;
    }

    this.values[settingId] = value;
    this.persist();
  }

  public updateSliderValue(settingId: string, value: number): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "slider" || !Number.isFinite(value) || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue(normalizeSliderValue(setting, value));

      return;
    }

    this.values[settingId] = normalizeSliderValue(setting, value);
    this.persist();
  }

  public updateSwitchValue(settingId: string, checked: boolean): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "switch" || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue(checked);

      if (this.normalizeLocalValues()) {
        this.persist();
      }

      return;
    }

    this.values[settingId] = checked;
    this.normalizeLocalValues();
    this.persist();
  }

  public updateKeybindingValue(settingId: string, value: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "keybinding" || !this.isSettingEditable(settingId)) {
      return;
    }

    const normalizedValue = normalizeKeybindingValue(value);
    if (normalizedValue === null) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue(normalizedValue);

      return;
    }

    this.values[settingId] = normalizedValue;
    this.persist();
  }

  private hydrate(persistedState: unknown): void {
    if (!isRecord(persistedState)) {
      return;
    }

    if (isSettingsGroupId(persistedState.selectedGroupId)) {
      this.selectedGroupId = persistedState.selectedGroupId;
    }

    if (!isRecord(persistedState.values)) {
      return;
    }

    const nextValues = createDefaultValues(this.externalBindingIds);

    for (const [settingId, rawValue] of Object.entries(persistedState.values)) {
      if (this.externalBindings.has(settingId)) {
        continue;
      }

      const setting = SETTING_DEFINITION_BY_ID.get(settingId);
      if (!setting) {
        continue;
      }

      if (setting.kind === "select" && typeof rawValue === "string") {
        if (setting.options.some((option) => option.value === rawValue)) {
          nextValues[settingId] = rawValue;
        }

        continue;
      }

      if (setting.kind === "slider" && typeof rawValue === "number" && Number.isFinite(rawValue)) {
        nextValues[settingId] = normalizeSliderValue(setting, rawValue);

        continue;
      }

      if (setting.kind === "switch" && typeof rawValue === "boolean") {
        nextValues[settingId] = rawValue;

        continue;
      }

      if (setting.kind === "keybinding" && typeof rawValue === "string") {
        const normalizedValue = normalizeKeybindingValue(rawValue);
        if (normalizedValue !== null) {
          nextValues[settingId] = normalizedValue;
        }
      }
    }

    this.values = nextValues;
    this.normalizeLocalValues();
  }

  private persist(): PersistedUserSettingsDialogState {
    return saveToLocalStorage(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, {
      selectedGroupId: this.selectedGroupId,
      values: this.values,
    });
  }

  private normalizeLocalValues(): boolean {
    return normalizeLocalValues(this.values, (settingId) => this.getValue(settingId), (settingId, value) => {
      this.values[settingId] = value;
    });
  }

}

function normalizeLocalValues(
  values: Record<string, WorkbenchSettingControlValue>,
  getValue: (settingId: string) => WorkbenchSettingControlValue | undefined,
  setValue?: (settingId: string, value: boolean) => void,
): boolean {
  let changed = false;
  const applyValue = (settingId: string, nextValue: boolean) => {
    if (getValue(settingId) === nextValue) {
      return;
    }

    if (setValue) {
      setValue(settingId, nextValue);
    } else {
      values[settingId] = nextValue;
    }

    changed = true;
  };

  if (getValue(SIMPLIFIED_DEVICE_ICONS_SETTING_ID) === true) {
    applyValue(ALWAYS_SHOW_GRID_LINES_SETTING_ID, true);
    applyValue(SHOW_GRASS_BACKGROUND_SETTING_ID, false);
    applyValue(SHOW_DEVICE_ICONS_SETTING_ID, true);
  }

  return changed;
}

function normalizeSliderValue(
  setting: WorkbenchSliderSettingDefinition,
  value: number,
): number {
  const clamped = Math.min(setting.max, Math.max(setting.min, value));
  const steps = Math.round((clamped - setting.min) / setting.step);
  const rounded = setting.min + (steps * setting.step);
  const decimals = countDecimals(setting.step);

  return Number(rounded.toFixed(decimals));
}

function countDecimals(step: number): number {
  const [, decimals = ""] = `${step}`.split(".");

  return decimals.length;
}

function normalizeKeybindingValue(value: string): string | null {
  const normalized = value.trim();

  return normalized === "" ? null : normalized;
}

function isSettingsGroupId(value: unknown): value is SettingsGroupId {
  return WORKBENCH_SETTINGS_GROUPS.some((group) => group.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
