type DebugModeListener = (enabled: boolean) => void;

/**
 * 临时数据抢救入口。保持实现可复用，但默认不向 App 开放且不允许持久化值生效。
 * AI-CORRECTION 2026-09-12: 远端仍有后台基地保留未来 schema，临时重新向 App 开放以完成全量抢救。
 * AI-CORRECTION 2026-09-12: 全部后台基地已通过严格同步复核，重新关闭入口并强制归零。
 * AI-CORRECTION 2026-09-12: 订正上一行：复核发生在抢救开关开启期间；本次关闭用于恢复严格版本校验。
 */
export const FORCE_FLATTEN_BLUEPRINT_VERSION_DEBUG_OPTION_ENABLED: boolean = false;

const listeners = new Set<DebugModeListener>();
let debugModeEnabled = false;
let forceFlattenBlueprintVersionEnabled = false;

/**
 * 主设置在各执行上下文中的只读运行态镜像，不是独立产品开关。
 */
export function readDebugModeEnabled(): boolean {
  return debugModeEnabled;
}

export function publishDebugModeEnabled(enabled: boolean): void {
  if (debugModeEnabled === enabled) {
    return;
  }

  debugModeEnabled = enabled;
  for (const listener of listeners) {
    listener(enabled);
  }
}

/**
 * “强制拉平蓝图版本”调试选项的运行态镜像。
 * 调用方只应发布已经与 debugMode 合并后的有效值。
 */
export function readForceFlattenBlueprintVersionEnabled(): boolean {
  return forceFlattenBlueprintVersionEnabled;
}

export function publishForceFlattenBlueprintVersionEnabled(enabled: boolean): void {
  forceFlattenBlueprintVersionEnabled = enabled;
}

export function subscribeDebugModeEnabled(listener: DebugModeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
