import { readFromLocalStorage } from "@/shared/storage";
import { APP_SETTINGS_LOCAL_STORAGE_KEY } from "@/app/state";

import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "./settings-dialog-state";

// AI-REMOVED 2026-09-26:
// Reason: 求解器回退开关改由调试分组控制，旧 key 的 true 不能反向解释为启用 Legacy。
// Trigger: 默认使用 Dense，只有调试模式与旧版开关同时开启才使用 Legacy。
// Evidence: 旧 key 表示启用 Dense；沿用会让已有持久化 true 意外切换至 Legacy。
// Replacement: LEGACY_SIMULATION_ENGINE_SETTING_ID 与 DEBUG_MODE_SETTING_ID。
// AI-CORRECTION 2026-09-26: DEBUG_MODE_SETTING_ID 已证实属于 App 设置外部绑定；实际替代读取下方 APP_SETTINGS_LOCAL_STORAGE_KEY 的 debugMode。
// Risk: 已保存的旧求解器偏好不再生效；需人工复核迁移预期。
// Human Review: Required
//
// Original code:
// export const DENSE_SIMULATION_ENGINE_SETTING_ID = "experimental-dense-simulation-engine";
// export const EXPERIMENTAL_FEATURES_SETTING_ID = "other-experimental-features";
export const LEGACY_SIMULATION_ENGINE_SETTING_ID = "debug-legacy-simulation-engine";
// AI-REMOVED 2026-09-26:
// Reason: 调试模式是 App 设置的外部绑定，设置面板 localStorage 不保存此 key。
// Trigger: 修正调试开启后 Legacy 仍无法生效的持久化边界错误。
// Evidence: workbench-app.tsx 的 other-debug-mode 读取 AppHost，storage-hook.ts 保存 v3-app-settings。
// Replacement: APP_SETTINGS_LOCAL_STORAGE_KEY 中的 debugMode。
// Risk: Low。
// Human Review: Required
// Original code:
// export const DEBUG_MODE_SETTING_ID = "other-debug-mode";

export interface SimulationEngineLaunchPreference {
  readonly activeDenseEnabled: boolean;
  readonly desiredDenseEnabled: boolean;
  readonly needsRestart: boolean;
}

export function captureSimulationEngineLaunchPreference(): SimulationEngineLaunchPreference {
  const activeDenseEnabled = readDesiredDenseSimulationEngineSetting();
  return {
    activeDenseEnabled,
    get desiredDenseEnabled() {
      return readDesiredDenseSimulationEngineSetting();
    },
    get needsRestart() {
      return readDesiredDenseSimulationEngineSetting() !== activeDenseEnabled;
    },
  };
}

export function readDesiredDenseSimulationEngineSetting(): boolean {
  return resolveDesiredDenseSimulationEngineSetting(
    readFromLocalStorage<unknown>(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY),
    readFromLocalStorage<unknown>(APP_SETTINGS_LOCAL_STORAGE_KEY),
  );
}

export function resolveDesiredDenseSimulationEngineSetting(
  persistedDialogState: unknown,
  persistedAppSettings: unknown,
): boolean {
  if (!isRecord(persistedDialogState) || !isRecord(persistedDialogState.values)) {
    return true;
  }

  return !isRecord(persistedAppSettings)
    || persistedAppSettings.debugMode !== true
    || persistedDialogState.values[LEGACY_SIMULATION_ENGINE_SETTING_ID] !== true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
