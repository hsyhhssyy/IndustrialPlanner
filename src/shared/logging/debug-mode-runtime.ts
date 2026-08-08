type DebugModeListener = (enabled: boolean) => void;

const listeners = new Set<DebugModeListener>();
let debugModeEnabled = false;

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

export function subscribeDebugModeEnabled(listener: DebugModeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
