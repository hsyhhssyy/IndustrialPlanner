import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  getDevice,
  loadBlueprintFromFile,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/premium-capsule-line.json";
const STORAGER_ID = "legacy_429609a4_0158";
const WARMUP_TICKS = 180;
const WINDOW_SIZE = 120;
const OBSERVATION_TICKS = 360; // 滑动窗口持续观察的 tick 数
const TARGET_OUTPUT_PER_WINDOW = 6;

// 该测试需从磁盘读取大型蓝图文件并运行 540 tick 仿真，耗时较长。
// 默认跳过，设置 HEAVY=1 环境变量后才会执行。
const runHeavy = process.env.HEAVY === "1";

describe.skipIf(!runHeavy)("REQ-076: premium capsule line production", () => {
  it("经过 180 tick 预热后，滑动 120-tick 窗口内平均产出 >= 6 个精选胶囊，持续 360 tick 无误", async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const maxTick = WARMUP_TICKS + OBSERVATION_TICKS; // 540

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: maxTick,
    });

    // 计算每个 tick 上 storager 中的物品总量
    const storagerItemCounts: number[] = [];
    for (let t = 0; t <= maxTick; t++) {
      const device = getDevice(report, t, STORAGER_ID);
      const totalItems = device.slotItems.reduce(
        (sum, slot) => sum + slot.count,
        0,
      );
      storagerItemCounts.push(totalItems);
    }

    // 滑动窗口验证：从 tick 180 开始，每个 120-tick 窗口产出 >= TARGET_OUTPUT_PER_WINDOW
    const slidingWindowStartMin = WARMUP_TICKS;
    const slidingWindowStartMax = maxTick - WINDOW_SIZE + 1; // 421
    const results: { windowStart: number; produced: number }[] = [];

    for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart++) {
      const windowEnd = windowStart + WINDOW_SIZE - 1; // 窗口最后一个 tick
      const beforeWindow = windowStart - 1;
      const produced = storagerItemCounts[windowEnd] - storagerItemCounts[beforeWindow];

      results.push({ windowStart, produced });

      expect(
        produced,
        `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${TARGET_OUTPUT_PER_WINDOW}`,
      ).toBeGreaterThanOrEqual(TARGET_OUTPUT_PER_WINDOW);
    }

    // 额外验证：总体产出趋势合理
    const totalProduced = storagerItemCounts[maxTick] - storagerItemCounts[WARMUP_TICKS - 1];
    const expectedMinTotal = (OBSERVATION_TICKS / WINDOW_SIZE) * TARGET_OUTPUT_PER_WINDOW;
    expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

    console.log(
      `[premium-capsule-line] ${results.length} 个滑动窗口全部通过，` +
      `总产出 ${totalProduced}，` +
      `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
    );
  });
});
