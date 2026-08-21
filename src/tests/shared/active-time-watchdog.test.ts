import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveTimeWatchdog } from "@/shared/worker/active-time-watchdog";

describe("ActiveTimeWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("在前台活跃时间达到阈值时依次报告慢请求与超时", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onSlow = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = new ActiveTimeWatchdog({
      slowWarningMs: 5_000,
      timeoutMs: 30_000,
      initiallyActive: true,
      onSlow,
      onTimeout,
    });

    vi.advanceTimersByTime(4_999);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledOnce();
    expect(onSlow).toHaveBeenCalledWith(5_000);

    vi.advanceTimersByTime(24_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith(30_000);
    watchdog.complete();
  });

  it("暂停期间不累计后台时间，恢复后从剩余时间继续", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onSlow = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = new ActiveTimeWatchdog({
      slowWarningMs: 5_000,
      timeoutMs: 30_000,
      initiallyActive: true,
      onSlow,
      onTimeout,
    });

    vi.advanceTimersByTime(4_000);
    watchdog.setActive(false);
    vi.advanceTimersByTime(60_000);
    expect(onSlow).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();

    watchdog.setActive(true);
    vi.advanceTimersByTime(1_000);
    expect(onSlow).toHaveBeenCalledWith(5_000);
    vi.advanceTimersByTime(25_000);
    expect(onTimeout).toHaveBeenCalledWith(30_000);
  });

  it("请求完成后取消所有后续报告", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onSlow = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = new ActiveTimeWatchdog({
      slowWarningMs: 5_000,
      timeoutMs: 30_000,
      initiallyActive: true,
      onSlow,
      onTimeout,
    });

    vi.advanceTimersByTime(1_000);
    watchdog.complete();
    vi.advanceTimersByTime(60_000);
    expect(onSlow).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
