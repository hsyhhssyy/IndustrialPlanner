import type { CanvasInteractionController } from "../canvas";
import { createGestureAdapter } from "./gesture/adapter";
import { AppGestureModuleRegistrar, createGestureActionRouter, type ShortcutInputLayer } from "./gesture/actions";
import { createGestureDiagnosticsStore } from "./gesture/diagnostics";

/** 复用工作台的输入模块；上下文始终绑定调用方的真实画布。 */
export function attachCanvasInput(canvas: CanvasInteractionController, inputLayer?: () => ShortcutInputLayer): () => void {
  const diagnostics = createGestureDiagnosticsStore();
  const adapter = createGestureAdapter(canvas, { onFrameDemand: () => canvas.wakeInput(), onCancel: () => canvas.cancelInput(),
    onAcquireInput: () => canvas.acquireInput() });
  canvas.attachGestureAdapter(adapter);
  const router = createGestureActionRouter({ gestureAdapter: adapter, workspace: canvas.workbench.workspace,
    getAppHost: () => canvas.workbench, getCanvas: () => canvas,
    getShortcutBinding: id => canvas.workbench.internalActions.getKeyboardShortcutFor(id),
    getShortcutInputLayer: () => inputLayer?.() ?? (canvas.overlapEntityMenu.visible ? "overlap-entity-menu" : "canvas"),
    getActiveTool: () => canvas.state.activeTool,
  });
  canvas.attachGestureRouter(router);
  adapter["adapterOptions"].queryLongPressAcceptance = hasEntity => router.queryLongPressAcceptance(hasEntity);
  const registrar = new AppGestureModuleRegistrar({ canvas, router, gestureDiagnostics: diagnostics });
  const stop = adapter.subscribeKeyboardSnapshot(snapshot => diagnostics.setKeyboardSnapshot(snapshot));
  return () => { registrar.dispose(); stop(); canvas.dispose(); };
}
