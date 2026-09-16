import { describe, expect, it } from "vitest";
import { retainRecentMapEntries, touchMapEntry } from "@/shared/retain-recent-map-entries";

describe("有预算的近期资源驻留", () => {
  it("预算内离屏不释放，重新访问后优先回收更旧的离屏资源", () => {
    const entries = new Map([["a", 4], ["b", 4], ["c", 4]]);
    const released: number[] = [];
    retainRecentMapEntries(entries, new Set(["c"]), 12, (size) => size, (size) => released.push(size));
    expect([...entries.keys()]).toEqual(["a", "b", "c"]);
    expect(released).toEqual([]);
    expect(touchMapEntry(entries, "a")).toBe(4);
    entries.set("d", 4);
    retainRecentMapEntries(entries, new Set(["d"]), 12, (size) => size, (size) => released.push(size));
    expect([...entries.keys()]).toEqual(["c", "a", "d"]);
    expect(released).toEqual([4]);
  });

  it("可见资源超预算也不销毁正在使用的纹理，离屏后按预算回收", () => {
    const entries = new Map([["visible", 20], ["old", 4]]);
    const released: number[] = [];
    retainRecentMapEntries(entries, new Set(["visible"]), 8, (size) => size, (size) => released.push(size));
    expect([...entries.keys()]).toEqual(["visible"]);
    expect(released).toEqual([4]);
    retainRecentMapEntries(entries, new Set(), 8, (size) => size, (size) => released.push(size));
    expect(entries.size).toBe(0);
    expect(released).toEqual([4, 20]);
    expect(touchMapEntry(entries, "missing")).toBeUndefined();
  });
});
