import { describe, expect, it } from "vitest";
import {
  logisticsStaticFrameKey, resolveLogisticsFluidColor, resolveLogisticsMaterialPlacements,
  resolveLogisticsMaterialSpec, type LogisticsMaterialPathEntry,
} from "@/shared/logistics-material";

describe("物流材质协议", () => {
  it("将素材上进方向映射到六种既有 sprite 朝向", () => {
    for (const kind of ["belt", "pipe"]) {
      expect(resolveLogisticsMaterialSpec(`${kind}_straight_1x1`)).toEqual({ kind, shape: "straight", rotation: 270 });
      expect(resolveLogisticsMaterialSpec(`${kind}_turn_cw_1x1`)).toEqual({ kind, shape: "left", rotation: 90 });
      expect(resolveLogisticsMaterialSpec(`${kind}_turn_ccw_1x1`)).toEqual({ kind, shape: "right", rotation: 0 });
    }
    expect(resolveLogisticsMaterialSpec("pipe_admission_1x1")).toBeNull();
  });

  it("转角和直道都累计一个材质单位，输入顺序不影响相位及支架间隔", () => {
    const entries: LogisticsMaterialPathEntry[] = Array.from({ length: 8 }, (_, index) => ({
      id: `segment-${index}`, kind: "pipe", shape: index === 2 ? "left" : "straight", rotation: 0,
      input: String(index), output: String(index + 1),
    }));
    const placements = resolveLogisticsMaterialPlacements(entries.toReversed());
    expect([...placements.values()].map((value) => value.start)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...placements.values()].map((value) => value.support)).toEqual([true, false, true, true, false, false, true, false]);
    expect([...placements.values()].map((value) => value.marker)).toEqual([false, false, true, true, false, false, false, false]);
  });

  it("闭环稳定切开，交叉位置的两类物流不共享拓扑", () => {
    const entries: LogisticsMaterialPathEntry[] = [
      { id: "b", kind: "belt", shape: "left", rotation: 0, input: "1", output: "0" },
      { id: "a", kind: "belt", shape: "right", rotation: 0, input: "0", output: "1" },
      { id: "pipe", kind: "pipe", shape: "straight", rotation: 0, input: "0", output: "1" },
    ];
    const placements = resolveLogisticsMaterialPlacements(entries);
    expect(placements.get("a")?.start).toBe(0);
    expect(placements.get("b")?.start).toBe(1);
    expect(placements.get("pipe")?.start).toBe(0);
    expect([...resolveLogisticsMaterialPlacements(entries.toReversed())]).toEqual([...placements]);
  });

  it("颜色标签正规化，未知颜色回落白色，空管与有色管使用独立完整帧", () => {
    expect(resolveLogisticsFluidColor(["gas_color: #82D6FF"])).toBe("82d6ff");
    expect(resolveLogisticsFluidColor(["liquid_color:invalid"])).toBe("ffffff");
    expect(resolveLogisticsFluidColor([])).toBe("ffffff");
    expect(logisticsStaticFrameKey({ kind: "pipe", shape: "straight", color: "empty", support: true, marker: false, start: 0, rotation: 270 }))
      .toBe("pipe/empty/straight/10");
  });
});
