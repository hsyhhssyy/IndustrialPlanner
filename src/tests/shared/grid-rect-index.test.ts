import { describe, expect, it } from "vitest";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";

describe("GridRectIndex", () => {
  const entries = Array.from({ length: 180 }, (_, id) => ({
    id, x: (id * 37 % 93) - 46, y: (id * 23 % 81) - 40,
    width: id % 11 + 1, height: id % 17 + 1,
  }));

  it("负坐标、跨桶和边界点查询与逐项判定一致，重叠项保留输入顺序", () => {
    const index = new GridRectIndex(entries, (entry) => entry);
    for (let y = -48; y <= 48; y += 4) {
      for (let x = -48; x <= 48; x += 4) {
        expect(index.at({ x, y })).toEqual(entries.filter((r) =>
          x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height));
      }
    }
  });

  it("范围查询与完整矩形求交一致，跨桶结果不重复，相切不算重叠", () => {
    const index = new GridRectIndex(entries, (entry) => entry);
    for (const area of [...entries, { id: -1, x: -60, y: -60, width: 120, height: 120 }]) {
      expect(index.intersecting(area)).toEqual(entries.filter((r) =>
        r.x < area.x + area.width && r.x + r.width > area.x
        && r.y < area.y + area.height && r.y + r.height > area.y));
    }
    expect(index.intersecting({ x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });

  it("移动对象后重建索引，不残留旧位置的占用", () => {
    const before = new GridRectIndex([{ x: 0, y: 0, width: 2, height: 2 }], (entry) => entry);
    const after = new GridRectIndex([{ x: 16, y: -16, width: 2, height: 2 }], (entry) => entry);
    expect(before.at({ x: 0, y: 0 })).toHaveLength(1);
    expect(after.at({ x: 0, y: 0 })).toEqual([]);
    expect(after.at({ x: 16, y: -16 })).toHaveLength(1);
  });
});
