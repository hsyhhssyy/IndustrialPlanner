import { describe, expect, it } from "vitest";
import { SceneClock } from "@/shared/timing/scene-clock";

describe("caller-owned scene time", () => {
  it("uses the first cumulative sample as baseline and accepts each interval only once", () => {
    const clock = new SceneClock({ kind: "advancing", clockId: "main", initialTimeMs: 50 });
    expect(clock.update({ clockId: "main", timeMs: 1000 })).toBe(0);
    expect(clock.sampleTimeMs).toBe(50);
    expect(clock.update({ clockId: "main", timeMs: 1025 })).toBe(25);
    expect(clock.update({ clockId: "main", timeMs: 1025 })).toBe(0);
    expect(clock.update({ clockId: "main", timeMs: 1001 })).toBe(0);
    expect(clock.update()).toBe(0);
    expect(clock.update({ clockId: "main", timeMs: 1030 })).toBe(5);
    expect(clock.sampleTimeMs).toBe(80);
  });

  it("keeps fixed previews frozen while independent active clocks advance", () => {
    const fixed = new SceneClock({ kind: "fixed", sampleTimeMs: 125 });
    const left = new SceneClock({ kind: "advancing", clockId: "left", initialTimeMs: 0 });
    const right = new SceneClock({ kind: "advancing", clockId: "right", initialTimeMs: 200 });
    left.update({ clockId: "left", timeMs: 0 });
    right.update({ clockId: "right", timeMs: 500 });
    for (let frame = 1; frame <= 10; frame += 1) {
      left.update({ clockId: "left", timeMs: frame * 16 });
      fixed.update({ clockId: "left", timeMs: frame * 16 });
    }
    right.update({ clockId: "right", timeMs: 505 });
    expect([fixed.sampleTimeMs, left.sampleTimeMs, right.sampleTimeMs]).toEqual([125, 160, 205]);
  });

  it("rebases after suspension without accumulating hidden time", () => {
    const clock = new SceneClock({ kind: "advancing", clockId: "view", initialTimeMs: 0 });
    clock.update({ clockId: "view", timeMs: 100 });
    clock.update({ clockId: "view", timeMs: 120 });
    clock.resetBaseline();
    expect(clock.update({ clockId: "view", timeMs: 10000 })).toBe(0);
    expect(clock.sampleTimeMs).toBe(20);
    expect(clock.update({ clockId: "view", timeMs: 10016 })).toBe(16);
    expect(clock.sampleTimeMs).toBe(36);
  });

  it("changes source only explicitly, and rejects invalid inputs atomically", () => {
    const clock = new SceneClock({ kind: "advancing", clockId: "a", initialTimeMs: 1 });
    clock.update({ clockId: "a", timeMs: 10 });
    expect(() => clock.update({ clockId: "b", timeMs: 20 })).toThrow();
    expect(() => clock.update({ clockId: "a", timeMs: Infinity })).toThrow();
    expect(() => clock.setPolicy({ kind: "fixed", sampleTimeMs: NaN })).toThrow();
    expect(clock.sampleTimeMs).toBe(1);
    expect(clock.update({ clockId: "a", timeMs: 15 })).toBe(5);
    clock.setPolicy({ kind: "fixed", sampleTimeMs: 40 });
    expect(clock.update({ clockId: "a", timeMs: 500 })).toBe(0);
    expect(clock.sampleTimeMs).toBe(40);
    clock.setPolicy({ kind: "advancing", clockId: "b", initialTimeMs: 70 });
    expect(clock.update({ clockId: "b", timeMs: 3 })).toBe(0);
    expect(clock.update({ clockId: "b", timeMs: 5 })).toBe(2);
    expect(clock.sampleTimeMs).toBe(72);
    expect(() => new SceneClock({ kind: "advancing", clockId: "", initialTimeMs: 0 })).toThrow();
    expect(() => new SceneClock({ kind: "fixed", sampleTimeMs: -1 })).toThrow();
  });
});
