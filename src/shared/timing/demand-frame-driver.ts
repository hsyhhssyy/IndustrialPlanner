export interface DemandFrameDriverOptions {
  readonly request: (callback: (timeMs: number) => void) => number;
  readonly cancel: (handle: number) => void;
  readonly needsFrame: () => boolean;
  readonly onFrame: (timeMs: number) => void;
  readonly onError?: (error: unknown) => void;
}

/** 调用方唤醒，需求消失即休眠；不持有任一模块或隐式全局时间源。 */
export function createDemandFrameDriver(options: DemandFrameDriverOptions) {
  let requested: number | null = null;
  let disposed = false;
  let executing = false;
  const wake = (): void => {
    if (disposed || executing || requested !== null || !options.needsFrame()) return;
    requested = options.request((timeMs) => {
      requested = null;
      if (disposed) return;
      executing = true;
      try { if (options.needsFrame()) options.onFrame(timeMs); }
      catch (error) {
        disposed = true;
        if (options.onError !== undefined) options.onError(error);
        else console.error("Frame driver failed", error);
      } finally { executing = false; }
      wake();
    });
  };
  return {
    wake,
    dispose(): void {
      if (disposed && requested === null) return;
      disposed = true;
      if (requested !== null) options.cancel(requested);
      requested = null;
    },
  };
}
