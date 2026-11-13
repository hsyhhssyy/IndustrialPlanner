import { describe, expect, it, vi } from "vitest";
import { createDemandFrameDriver } from "@/shared/timing/demand-frame-driver";
import { createPlaybackOwner } from "@/shared/timing/playback-owner";

describe("explicit frame ownership", () => {
  it("sleeps without demand, coalesces wakes, and cancels only its own pending frame", () => {
    const callbacks = new Map<number, (time: number) => void>();
    let nextId = 0;
    let dirty = false;
    let time = 0;
    const driver = createDemandFrameDriver({
      request: callback => { callbacks.set(++nextId, callback); return nextId; },
      cancel: handle => { callbacks.delete(handle); },
      needsFrame: () => dirty,
      onFrame: value => { dirty = false; time = value; driver.wake(); },
    });
    try {
      driver.wake();
      expect(callbacks.size).toBe(0);
      dirty = true;
      driver.wake(); driver.wake();
      expect(callbacks.size).toBe(1);
      const [handle, callback] = [...callbacks][0]!;
      callbacks.delete(handle); callback(42);
      expect(time).toBe(42);
      expect(callbacks.size).toBe(0);
      dirty = true; driver.wake();
      driver.dispose(); driver.dispose(); driver.wake();
      expect(callbacks.size).toBe(0);
    } finally { driver.dispose(); }
  });

  it("keeps new demand raised during a frame and stops on failure", () => {
    let callback: ((time: number) => void) | null = null;
    let remaining = 2;
    const failure = new Error("render failed");
    const errors: unknown[] = [];
    const driver = createDemandFrameDriver({
      request: next => { callback = next; return 1; }, cancel: () => { callback = null; },
      needsFrame: () => remaining > 0,
      onFrame: () => { if (--remaining === 0) throw failure; driver.wake(); },
      onError: error => { errors.push(error); },
    });
    try {
      driver.wake();
      const run = (time: number) => { const next = callback; callback = null; next?.(time); };
      run(0);
      expect(callback).not.toBeNull();
      run(16);
      expect(errors).toEqual([failure]);
      remaining = 1; driver.wake();
      expect(callback).toBeNull();
    } finally { driver.dispose(); }
  });

  it("deduplicates one simulation's samples without suppressing another owner and caps long deltas", () => {
    const first: number[] = [];
    const second: number[] = [];
    let playing = true;
    const left = createPlaybackOwner({ clockId: "clock", isPlaying: () => playing, advance: delta => { first.push(delta); } });
    const right = createPlaybackOwner({ clockId: "clock", isPlaying: () => true, advance: delta => { second.push(delta); } });
    const sample = (timeMs: number) => ({ clockId: "clock", timeMs });
    try {
      for (const owner of [left, right]) { owner.update(sample(100)); owner.update(sample(125)); }
      left.update(sample(125)); left.update(sample(120));
      expect(first).toEqual([25]); expect(second).toEqual([25]);
      left.update(sample(300));
      expect(first).toEqual([25, 100]);
      playing = false; left.update(sample(400));
      playing = true; left.update(sample(10000)); left.update(sample(10016));
      expect(first).toEqual([25, 100, 16]);
      left.resetBaseline(); left.update(sample(20000));
      left.dispose(); left.update(sample(20100));
      expect(first).toEqual([25, 100, 16]);
    } finally { left.dispose(); right.dispose(); }
  });

  it("reports async playback failures but ignores late failures after disposal", async () => {
    let reject: ((error: Error) => void) | undefined;
    const errors = vi.fn();
    const owner = createPlaybackOwner({ clockId: "clock", isPlaying: () => true,
      advance: () => new Promise((_resolve, fail) => { reject = fail; }), onError: errors });
    owner.update({ clockId: "clock", timeMs: 0 }); owner.update({ clockId: "clock", timeMs: 10 });
    const error = new Error("worker failed");
    reject?.(error); await Promise.resolve();
    expect(errors).toHaveBeenCalledExactlyOnceWith(error);
    owner.update({ clockId: "clock", timeMs: 20 }); owner.dispose();
    reject?.(error); await Promise.resolve();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
