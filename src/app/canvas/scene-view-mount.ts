import type { RenderContract, RenderViewHandle } from "@/domain/renderer";
import type { SceneViewInput } from "@/domain/document/scene-view-input";
import type { SceneTimePolicy } from "@/domain/shared/scene-time";
import { createDemandFrameDriver } from "@/shared/timing/demand-frame-driver";

/** App 显式拥有此 View 的帧驱动；固定采样只在失效时请求补画。 */
export async function mountCanvasSceneView(options: {
  readonly renderer: RenderContract;
  readonly input: SceneViewInput;
  readonly time: SceneTimePolicy;
  readonly signal?: AbortSignal;
}) {
  const { renderer } = options;
  const abort = new AbortController();
  const onAbort = (): void => abort.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let handle: RenderViewHandle;
  try { handle = await renderer.actions.mountView({ input: options.input, time: options.time, signal: abort.signal }); }
  catch (error) { options.signal?.removeEventListener("abort", onAbort); throw error; }
  let disposed = false;
  const frameListeners = new Set<() => void>();
  const driver = createDemandFrameDriver({
    request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id),
    needsFrame: () => {
      const status = renderer.queries.getViewStatus(handle);
      return !disposed && status?.phase === "ready" && (status.dirty || status.needsContinuousFrame);
    },
    onFrame: (timeMs) => {
      renderer.actions.updateViews([{ handle, sample: options.time.kind === "advancing"
        ? { clockId: options.time.clockId, timeMs } : undefined }]);
      for (const listener of [...frameListeners]) listener();
    },
  });
  const stopDemand = renderer.queries.subscribeFrameDemand(driver.wake);
  driver.wake();
  return {
    handle,
    get container() { return renderer.queries.getViewContainer(handle); },
    get canvas() { return renderer.queries.getViewCanvas(handle); },
    suspend(): () => void { return renderer.actions.suspendView(handle); },
    subscribeFrames(listener: () => void): () => void { frameListeners.add(listener); return () => { frameListeners.delete(listener); }; },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      driver.dispose(); stopDemand(); frameListeners.clear();
      options.signal?.removeEventListener("abort", onAbort);
      abort.abort();
      renderer.actions.disposeView(handle);
    },
  };
}
