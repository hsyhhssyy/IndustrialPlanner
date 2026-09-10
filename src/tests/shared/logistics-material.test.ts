import { describe, expect, it } from "vitest";
import {
  logisticsStaticFrameKey, resolveLogisticsFluidColor, resolveLogisticsMaterialPlacements,
  resolveLogisticsMaterialSpec, type LogisticsMaterialPathEntry,
} from "@/shared/logistics-material";

function pipeRoute(length: number, corners: readonly number[] = [], connected = false): LogisticsMaterialPathEntry[] {
  return Array.from({ length }, (_, index) => ({
    id: `pipe-${index}`, kind: "pipe", shape: corners.includes(index) ? "left" : "straight", rotation: 0,
    input: String(index), output: String(index + 1),
    inputConnectedToDevice: connected && index === 0,
    outputConnectedToDevice: connected && index === length - 1,
  }));
}

function supportPositions(entries: readonly LogisticsMaterialPathEntry[]): number[] {
  return [...resolveLogisticsMaterialPlacements(entries).values()].filter((entry) => entry.support).map((entry) => entry.start);
}

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
    expect([...placements.values()].map((value) => value.support)).toEqual([true, false, true, false, false, false, false, true]);
    expect([...placements.values()].map((value) => value.marker)).toEqual([false, false, false, true, false, false, false, false]);
  });

  it.each([
    [1, []], [29, []], [30, []], [46, []], [47, [30]], [61, [30]], [77, [30, 60]],
  ] as const)("两端连接设备的 %i 节直管按 30 格计数，并避让末端 15 格", (length, expected) => {
    expect(supportPositions(pipeRoute(length, [], true))).toEqual(expected);
  });

  it("悬空首尾强制保留，距离不足 15 格也不互相删除", () => {
    expect(supportPositions(pipeRoute(1))).toEqual([0]);
    expect(supportPositions(pipeRoute(10, [2]))).toEqual([0, 2, 9]);
    expect(supportPositions(pipeRoute(70))).toEqual([0, 30, 69]);
  });

  it("转角重置计数，取消靠近转角的旧候选，设备附近仍保留必设转角", () => {
    expect(supportPositions(pipeRoute(100, [40]))).toEqual([0, 40, 70, 99]);
    expect(supportPositions(pipeRoute(75, [10, 20], true))).toEqual([10, 20, 50]);
    expect(supportPositions(pipeRoute(80, [45], true))).toEqual([45]);
    expect(supportPositions(pipeRoute(80, [46], true))).toEqual([30, 46]);
  });

  it("双箭头只按每六节排布，连续转角不会逐节产生箭头", () => {
    const entries = pipeRoute(18, [0, 1, 2, 4, 5, 6, 10, 11]);
    expect([...resolveLogisticsMaterialPlacements(entries).values()].filter((entry) => entry.marker).map((entry) => entry.start))
      .toEqual([3, 9, 15]);
  });

  it("闭环按沿线距离避让跨越相位切口的转角，不虚构悬空端点", () => {
    const entries = pipeRoute(90, [5, 50]);
    entries[89] = { ...entries[89]!, output: "0" };
    expect(supportPositions(entries)).toEqual([5, 50]);
    expect(supportPositions(entries.toReversed())).toEqual([5, 50]);
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
