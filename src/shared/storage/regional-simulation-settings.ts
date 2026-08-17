const REGIONAL_MULTI_BASE_EXPERIMENTAL_KEY = "v3-experimental-regional-multi-base";

export function readRegionalMultiBaseExperimentalEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(REGIONAL_MULTI_BASE_EXPERIMENTAL_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeRegionalMultiBaseExperimentalEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      globalThis.localStorage?.setItem(REGIONAL_MULTI_BASE_EXPERIMENTAL_KEY, "true");
    } else {
      globalThis.localStorage?.removeItem(REGIONAL_MULTI_BASE_EXPERIMENTAL_KEY);
    }
  } catch {
    // 隐私模式或存储不可用时保持会话内存值。
  }
}
