import { afterEach, expect, it, vi } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";

afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

// 迁自三屏 E2E：计时只替换时钟，提示状态和销毁均执行真实 AppHost。
it.each(["canvas.toast.beltStart", "canvas.toast.pipeStart"] as const)("后续消息 %s 重新获得完整三秒，旧计时不提前清除", message => {
  vi.useFakeTimers();
  const { app } = createAppTestWorkspace();
  try {
    app.internalActions.setCanvasAlert("canvas.alert.beltStart");
    app.internalActions.showCanvasToast("canvas.toast.beltStart");
    vi.advanceTimersByTime(1200);
    app.internalActions.showCanvasToast(message);
    vi.advanceTimersByTime(2100);
    expect(app.internalState.runtime.canvasToastKey).toBe(message);
    vi.advanceTimersByTime(899);
    expect(app.internalState.runtime.canvasToastKey).toBe(message);
    vi.advanceTimersByTime(1);
    expect(app.internalState.runtime.canvasToastKey).toBeNull();
    expect(app.internalState.runtime.canvasAlertKey).toBe("canvas.alert.beltStart");
  } finally { app.dispose(); }
});

it("销毁清空提示和计时器，迟到的动作不能恢复已销毁主机", () => {
  vi.useFakeTimers();
  const { app } = createAppTestWorkspace();
  try {
    app.internalActions.showCanvasToast("canvas.toast.beltStart");
    app.internalActions.setCanvasAlert("canvas.alert.beltStart");
    app.dispose();
    app.internalActions.showCanvasToast("canvas.toast.pipeStart");
    app.internalActions.setCanvasAlert("canvas.alert.pipeStart");
    vi.advanceTimersByTime(3100);
    expect(app.internalState.runtime.canvasToastKey).toBeNull();
    expect(app.internalState.runtime.canvasAlertKey).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally { app.dispose(); }
});
