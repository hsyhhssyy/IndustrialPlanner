import { makeAutoObservable } from "mobx";

import type { UiKey } from "@/shared/i18n";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

export const USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY = "v3-user-settings-dialog";

export type SettingsGroupId = "display-system" | "game" | "operation" | "shortcuts" | "other" | "debug";

export type WorkbenchSettingControlValue = string | number | boolean;

interface WorkbenchSettingEditableWhenDefinition {
  readonly settingId: string;
  readonly equals: WorkbenchSettingControlValue;
}

interface WorkbenchSettingBaseDefinition {
  readonly id: string;
  readonly labelKey?: UiKey;
  readonly labelText?: string;
  readonly descriptionKey?: UiKey;
  readonly descriptionText?: string;
  readonly disabled?: boolean;
  readonly editableWhen?: WorkbenchSettingEditableWhenDefinition;
  /** 非桌面端（移动端/平板）隐藏该设置项 */
  readonly mobileHidden?: boolean;
}

interface WorkbenchSelectOptionDefinition {
  readonly value: string;
  readonly labelKey: UiKey;
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

interface WorkbenchTextSettingDefinition extends WorkbenchSettingBaseDefinition {
  readonly kind: "text";
  readonly defaultValue: string;
  readonly placeholderText?: string;
}

export type WorkbenchSettingDefinition =
  | WorkbenchSelectSettingDefinition
  | WorkbenchSliderSettingDefinition
  | WorkbenchSwitchSettingDefinition
  | WorkbenchKeybindingSettingDefinition
  | WorkbenchTextSettingDefinition;

export interface WorkbenchSettingsGroupDefinition {
  readonly id: SettingsGroupId;
  readonly labelKey: UiKey;
  readonly descriptionKey: UiKey;
  readonly items: readonly WorkbenchSettingDefinition[];
  /** 非桌面端（移动端/平板）隐藏该整个设置分组 */
  readonly mobileHidden?: boolean;
}

interface WorkbenchSettingExternalBinding {
  readonly readValue: () => WorkbenchSettingControlValue;
  readonly writeValue: (value: WorkbenchSettingControlValue) => void;
}

interface WorkbenchSettingsDialogControllerOptions {
  readonly externalBindings?: Readonly<Record<string, WorkbenchSettingExternalBinding>>;
  readonly shortcutReader?: (key: string) => string;
  readonly shortcutWriter?: (key: string, value: string) => void;
  readonly shortcutResetAll?: () => void;
}

interface PersistedUserSettingsDialogState {
  readonly selectedGroupId: SettingsGroupId;
  readonly values: Record<string, WorkbenchSettingControlValue>;
}

const SIMPLIFIED_DEVICE_ICONS_SETTING_ID = "game-use-blueprint-style-device-images";
const ALWAYS_SHOW_GRID_LINES_SETTING_ID = "game-always-show-grid-lines";
const SHOW_GRASS_BACKGROUND_SETTING_ID = "game-show-grass-background";
const SHOW_DEVICE_NAMES_SETTING_ID = "game-show-device-names";
const SHOW_DEVICE_ICONS_SETTING_ID = "game-show-device-icons";
const COLLAPSE_DEVICE_MODES_SETTING_ID = "game-collapse-device-modes";

export const WORKBENCH_SETTINGS_GROUPS: readonly WorkbenchSettingsGroupDefinition[] = [
  {
    id: "display-system",
    labelKey: "settingsGroup.displaySystem",
    descriptionKey: "settingsGroup.displaySystemDescription",
    items: [
      {
        id: "system-language",
        kind: "select",
        labelKey: "settingsField.system-language",
        descriptionKey: "settingsField.system-languageDescription",
        defaultValue: "zh-CN",
        options: [
          { value: "zh-CN", labelKey: "settingsOption.languageZhHans" },
          { value: "en-US", labelKey: "settingsOption.languageEnglish" },
        ],
      },
      {
        id: "system-theme",
        kind: "select",
        labelKey: "settingsField.system-theme",
        descriptionKey: "settingsField.system-themeDescription",
        defaultValue: "ayu-light",
        options: [
          { value: "ayu-light", labelKey: "settingsOption.ayuLight" },
          { value: "ayu-dark", labelKey: "settingsOption.ayuDark" },
        ],
      },
    ],
  },
  {
    id: "game",
    labelKey: "settingsGroup.game",
    descriptionKey: "settingsGroup.gameDescription",
    // AI-REMOVED 2026-05-26:
    // Reason: 鹰角网络操作模式开关不再为用户可见设置，取消图形化入口。
    //        该字段仍保留且为 true，但不再与其他设置项关联。
    // Trigger: 用户需求 — 取消该设置的图像化入口，解耦关联。
    // Evidence: 用户明确指令。
    // Replacement: None（仅移除 UI 入口，字段本身保留于 state-impl.ts）。
    // Risk: Low
    // Human Review: Not Required
    //
    // Original code:
    // {
    //   id: "game-arknights-operation-mode",
    //   kind: "switch",
    //   labelKey: "settingsField.arknightsOperationMode",
    //   descriptionKey: "settingsField.arknightsOperationModeDescription",
    //   defaultValue: true,
    //   disabled: true,
    // },
    items: [
      {
        id: "game-use-blueprint-style-device-images",
        kind: "switch",
        labelKey: "settingsField.game-use-blueprint-style-device-images",
        descriptionKey: "settingsField.game-use-blueprint-style-device-imagesDescription",
        defaultValue: false,
      },
      {
        id: SHOW_DEVICE_NAMES_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-show-device-names",
        descriptionKey: "settingsField.game-show-device-namesDescription",
        defaultValue: true,
      },
      {
        id: SHOW_DEVICE_ICONS_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-show-device-icons",
        descriptionKey: "settingsField.game-show-device-iconsDescription",
        defaultValue: false,
        editableWhen: {
          settingId: SIMPLIFIED_DEVICE_ICONS_SETTING_ID,
          equals: false,
        },
      },
      {
        id: "other-toolbox-show-all-activity-content",
        kind: "switch",
        labelKey: "settingsField.other-toolbox-show-all-activity-content",
        descriptionKey: "settingsField.other-toolbox-show-all-activity-contentDescription",
        defaultValue: true,
      },
      {
        id: "game-use-inspector-panel",
        kind: "switch",
        labelKey: "settingsField.game-use-inspector-panel",
        descriptionKey: "settingsField.game-use-inspector-panelDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-selection-right-dock-sync",
        kind: "switch",
        labelKey: "settingsField.game-arknights-selection-right-dock-sync",
        descriptionKey: "settingsField.game-arknights-selection-right-dock-syncDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-use-inspector-panel",
          equals: true,
        },
      },
      {
        id: "game-arknights-inspector-open-on-second-click",
        kind: "switch",
        labelKey: "settingsField.game-arknights-inspector-open-on-second-click",
        descriptionKey: "settingsField.game-arknights-inspector-open-on-second-clickDescription",
        defaultValue: false,
      },
      {
        id: "game-show-hotkeys",
        kind: "switch",
        labelKey: "settingsField.game-show-hotkeys",
        descriptionKey: "settingsField.game-show-hotkeysDescription",
        defaultValue: true,
        mobileHidden: true,
      },
      {
        id: "game-always-show-grid-lines",
        kind: "switch",
        labelKey: "settingsField.game-always-show-grid-lines",
        descriptionKey: "settingsField.game-always-show-grid-linesDescription",
        defaultValue: true,
        editableWhen: {
          settingId: "game-use-blueprint-style-device-images",
          equals: false,
        },
      },
      {
        id: "game-show-grass-background",
        kind: "switch",
        labelKey: "settingsField.game-show-grass-background",
        descriptionKey: "settingsField.game-show-grass-backgroundDescription",
        defaultValue: false,
        editableWhen: {
          settingId: "game-use-blueprint-style-device-images",
          equals: false,
        },
      },
      {
        id: COLLAPSE_DEVICE_MODES_SETTING_ID,
        kind: "switch",
        labelKey: "settingsField.game-collapse-device-modes",
        descriptionKey: "settingsField.game-collapse-device-modesDescription",
        defaultValue: true,
      },
    ],
  },
  {
    id: "operation",
    labelKey: "settingsGroup.operation",
    descriptionKey: "settingsGroup.operationDescription",
    items: [
      {
        id: "game-quick-place",
        kind: "switch",
        labelKey: "settingsField.game-quick-place",
        descriptionKey: "settingsField.game-quick-placeDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-immediate-move",
        kind: "switch",
        labelKey: "settingsField.game-arknights-immediate-move",
        descriptionKey: "settingsField.game-arknights-immediate-moveDescription",
        defaultValue: true,
      },
      {
        id: "game-arknights-copy-while-moving",
        kind: "switch",
        labelKey: "settingsField.game-arknights-copy-while-moving",
        descriptionKey: "settingsField.game-arknights-copy-while-movingDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-immediate-marquee",
        kind: "switch",
        labelKey: "settingsField.game-arknights-immediate-marquee",
        descriptionKey: "settingsField.game-arknights-immediate-marqueeDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-allow-empty-logistics-endpoints",
        kind: "switch",
        labelKey: "settingsField.game-arknights-allow-empty-logistics-endpoints",
        descriptionKey: "settingsField.game-arknights-allow-empty-logistics-endpointsDescription",
        defaultValue: false,
      },
      {
        id: "game-arknights-auto-create-splitters-and-convergers",
        kind: "switch",
        labelKey: "settingsField.game-arknights-auto-create-splitters-and-convergers",
        descriptionKey: "settingsField.game-arknights-auto-create-splitters-and-convergersDescription",
        defaultValue: true,
      },
    ],
  },
  {
    id: "shortcuts",
    labelKey: "settingsGroup.shortcuts",
    descriptionKey: "settingsGroup.shortcutsDescription",
    mobileHidden: true,
    items: [
      {
        id: "shortcut-quick-place",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-quick-place"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-quick-place"),
        defaultValue: "Z",
      },
      {
        id: "shortcut-place-conveyor",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-place-conveyor"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-place-conveyor"),
        defaultValue: "E",
      },
      {
        id: "shortcut-place-pipe",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-place-pipe"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-place-pipe"),
        defaultValue: "Q",
      },
      {
        id: "shortcut-resources-power",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-resources-power"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-resources-power"),
        defaultValue: "G",
      },
      {
        id: "shortcut-warehouse",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-warehouse"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-warehouse"),
        defaultValue: "C",
      },
      {
        id: "shortcut-basic-production",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-basic-production"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-basic-production"),
        defaultValue: "V",
      },
      {
        id: "shortcut-synthesis",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-synthesis"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-synthesis"),
        defaultValue: "B",
      },
      {
        id: "shortcut-save-blueprint",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-save-blueprint"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-save-blueprint"),
        defaultValue: "Ctrl+S",
      },
      {
        id: "shortcut-return-select",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-return-select"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-return-select"),
        defaultValue: "Esc",
      },
      {
        id: "shortcut-rotate",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-rotate"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-rotate"),
        defaultValue: "R",
      },
      {
        id: "shortcut-switch-device-mode",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-switch-device-mode"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-switch-device-mode"),
        defaultValue: "Tab",
      },
      {
        id: "shortcut-rotate-viewport",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-rotate-viewport"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-rotate-viewport"),
        defaultValue: "Ctrl+R",
      },
      {
        id: "shortcut-delete-device",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-delete-device"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-delete-device"),
        defaultValue: "F",
      },
      {
        id: "shortcut-move-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-move-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-move-selection"),
        defaultValue: "M",
      },
      {
        id: "shortcut-copy-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-copy-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-copy-selection"),
        defaultValue: "Ctrl+C",
      },
      {
        id: "shortcut-paste-selection",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-paste-selection"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-paste-selection"),
        defaultValue: "Ctrl+V",
      },
      {
        id: "shortcut-undo",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-undo"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-undo"),
        defaultValue: "Ctrl+Z",
      },
      {
        id: "shortcut-redo",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-redo"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-redo"),
        defaultValue: "Ctrl+Y",
      },
      {
        id: "shortcut-toggle-placement-panel",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-toggle-placement-panel"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-toggle-placement-panel"),
        defaultValue: "P",
      },
      {
        id: "shortcut-toggle-blueprint-panel",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-toggle-blueprint-panel"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-toggle-blueprint-panel"),
        defaultValue: "L",
      },
      {
        id: "shortcut-toggle-history-panel",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-toggle-history-panel"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-toggle-history-panel"),
        defaultValue: "H",
      },
      {
        id: "shortcut-toggle-base-panel",
        kind: "keybinding",
        labelKey: shortcutKeybindingLabelKey("shortcut-toggle-base-panel"),
        descriptionKey: shortcutKeybindingDescriptionKey("shortcut-toggle-base-panel"),
        defaultValue: "K",
      },
    ],
  },
  {
    id: "other",
    labelKey: "settingsGroup.other",
    descriptionKey: "settingsGroup.otherDescription",
    items: [],
  },
  {
    id: "debug",
    labelKey: "settingsGroup.debug",
    descriptionKey: "settingsGroup.debugDescription",
    items: [
      {
        id: "other-debug-mode",
        kind: "switch",
        labelKey: "settingsField.other-debug-mode",
        descriptionKey: "settingsField.other-debug-modeDescription",
        defaultValue: false,
      },
      {
        id: "debug-simulation-worker-detailed-report",
        kind: "switch",
        labelKey: "settingsField.debug-simulation-worker-detailed-report",
        descriptionKey: "settingsField.debug-simulation-worker-detailed-reportDescription",
        defaultValue: false,
      },
      {
        id: "debug-backend-api-address-override",
        kind: "text",
        labelKey: "settingsField.debug-backend-api-address-override",
        descriptionKey: "settingsField.debug-backend-api-address-overrideDescription",
        defaultValue: "",
        placeholderText: "endfield-api.amiyabot.com",
      },
      {
        id: "debug-show-fps",
        kind: "switch",
        labelKey: "settingsField.debug-show-fps",
        descriptionKey: "settingsField.debug-show-fpsDescription",
        defaultValue: false,
      },
      {
        id: "debug-show-gesture-diagnostics-window",
        kind: "switch",
        labelKey: "settingsField.debug-show-gesture-diagnostics-window",
        descriptionKey: "settingsField.debug-show-gesture-diagnostics-windowDescription",
        defaultValue: false,
      },
    ],
  },
] as const satisfies readonly [
  WorkbenchSettingsGroupDefinition,
  ...WorkbenchSettingsGroupDefinition[],
];

const DEFAULT_SETTINGS_GROUP = WORKBENCH_SETTINGS_GROUPS[0]!;

const SETTING_DEFINITION_BY_ID = new Map<string, WorkbenchSettingDefinition>(
  WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
    group.items.map((setting): [string, WorkbenchSettingDefinition] => [setting.id, setting])
  ),
);

/** 所有 keybinding 类型的 setting 定义 */
export const ALL_KEYBINDING_SETTINGS: readonly WorkbenchKeybindingSettingDefinition[] =
  WORKBENCH_SETTINGS_GROUPS.flatMap((group) =>
    group.items.filter((setting) => setting.kind === "keybinding"),
  ) as WorkbenchKeybindingSettingDefinition[];

/** 从 shortcut setting id 推导 i18n label key。前缀 `settingsField.` + setting id */
function shortcutKeybindingLabelKey(id: string): UiKey {
  return `settingsField.${id}` as UiKey;
}

/** 从 shortcut setting id 推导 i18n description key。前缀 `settingsField.` + setting id + `Description` */
function shortcutKeybindingDescriptionKey(id: string): UiKey {
  return `settingsField.${id}Description` as UiKey;
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

  // Hardcoded：重置「操作」和「快捷键」时需要恢复为默认值的 setting id。
  private static readonly RESET_OPERATION_AND_SHORTCUT_KEYS: readonly string[] = [
    // 操作
    "game-quick-place",
    "game-arknights-immediate-move",
    "game-arknights-copy-while-moving",
    "game-arknights-immediate-marquee",
    "game-arknights-allow-empty-logistics-endpoints",
    "game-arknights-auto-create-splitters-and-convergers",
    // 快捷键
    "shortcut-quick-place",
    "shortcut-place-conveyor",
    "shortcut-place-pipe",
    "shortcut-resources-power",
    "shortcut-warehouse",
    "shortcut-basic-production",
    "shortcut-synthesis",
    "shortcut-save-blueprint",
    "shortcut-return-select",
    "shortcut-rotate",
    "shortcut-switch-device-mode",
    "shortcut-rotate-viewport",
    "shortcut-delete-device",
    "shortcut-move-selection",
    "shortcut-copy-selection",
    "shortcut-paste-selection",
    "shortcut-undo",
    "shortcut-redo",
    "shortcut-toggle-placement-panel",
    "shortcut-toggle-blueprint-panel",
    "shortcut-toggle-history-panel",
    "shortcut-toggle-base-panel",
  ];

  private readonly externalBindings: ReadonlyMap<string, WorkbenchSettingExternalBinding>;
  private readonly externalBindingIds: ReadonlySet<string>;
  private readonly shortcutResetAll?: () => void;

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

    this.shortcutResetAll = options.shortcutResetAll;
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
    const externalBinding = this.externalBindings.get(settingId);
    if (!externalBinding) {
      return this.values[settingId];
    }

    const localValue = this.values[settingId];
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);

    if (setting?.kind === "text" && localValue !== undefined) {
      return localValue;
    }

    return externalBinding.readValue();
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

  public updateTextValue(settingId: string, value: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "text" || !this.isSettingEditable(settingId)) {
      return;
    }

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue(value);
      this.values[settingId] = value;

      return;
    }

    this.values[settingId] = value;
    this.persist();
  }

  /**
   * 查找与给定值冲突的快捷键设置。
   * 返回冲突的 settingId，若没有冲突返回 null。
   * 排除 currentSettingId 自身。
   */
  public findKeybindingConflict(currentSettingId: string, value: string): string | null {
    const normalizedValue = normalizeKeybindingValue(value);
    if (normalizedValue === null) {
      return null;
    }

    for (const setting of ALL_KEYBINDING_SETTINGS) {
      if (setting.id === currentSettingId) continue;

      const existingValue = this.getValue(setting.id);
      if (typeof existingValue === "string" && normalizeKeybindingValue(existingValue) === normalizedValue) {
        return setting.id;
      }
    }

    return null;
  }

  /** 清空指定快捷键设置的值（设为空字符串）。 */
  public clearKeybinding(settingId: string): void {
    const setting = SETTING_DEFINITION_BY_ID.get(settingId);
    if (setting?.kind !== "keybinding") return;

    const externalBinding = this.externalBindings.get(settingId);
    if (externalBinding) {
      externalBinding.writeValue("");
    } else {
      this.values[settingId] = "";
    }

    this.persist();
  }

  /**
   * 将鹰角操作模式相关开关和所有快捷键恢复为默认值。
   * 快捷键通过 shortcutResetAll 直接批量重置。
   */
  public resetArknightsOperationAndShortcuts(): void {
    // 先批量重置快捷键默认值
    this.shortcutResetAll?.();

    for (const settingId of WorkbenchSettingsDialogController.RESET_OPERATION_AND_SHORTCUT_KEYS) {
      const setting = SETTING_DEFINITION_BY_ID.get(settingId);
      if (!setting) continue;

      const externalBinding = this.externalBindings.get(settingId);
      if (externalBinding) {
        externalBinding.writeValue(setting.defaultValue);
      } else {
        this.values[settingId] = setting.defaultValue;
      }
    }

    this.normalizeLocalValues();
    this.persist();
  }

  /** 重置所有设置为默认值，包括快捷键、外部绑定和本地值。 */
  public resetAllSettings(): void {
    // 先批量重置快捷键默认值
    this.shortcutResetAll?.();

    for (const setting of SETTING_DEFINITION_BY_ID.values()) {
      const externalBinding = this.externalBindings.get(setting.id);
      if (externalBinding) {
        externalBinding.writeValue(setting.defaultValue);
        if (setting.kind === "text") {
          this.values[setting.id] = setting.defaultValue;
        }
      } else {
        this.values[setting.id] = setting.defaultValue;
      }
    }

    this.normalizeLocalValues();
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

        continue;
      }

      if (setting.kind === "text" && typeof rawValue === "string") {
        nextValues[settingId] = rawValue;
      }
    }

    this.values = nextValues;
    this.normalizeLocalValues();
  }

  private persist(): PersistedUserSettingsDialogState {
    const values = Object.fromEntries(
      Object.entries(this.values).filter(([settingId]) => !this.externalBindingIds.has(settingId)),
    );

    return saveToLocalStorage(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY, {
      selectedGroupId: this.selectedGroupId,
      values,
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
