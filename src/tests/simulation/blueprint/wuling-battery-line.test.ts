import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "../blueprint-runner";
import {
  loadBlueprintFromFile,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/wuling-battery-line.json";
const STORAGER_ID = "legacy_2dec8da2_0163";
const WARMUP_TICKS = 2400; // 2 分钟 = 120s × 20 tick/s
const WINDOW_SIZE = 1200; // 1 分钟窗口，对应期望产出 6 个
const OBSERVATION_TICKS = 3600; // 滑动窗口持续观察 3 分钟
const TARGET_OUTPUT_PER_WINDOW = 6;
const TARGET_ITEM_ID = "item_proc_battery_5";

describe("中容武陵电池产线 - 电池产量稳态验证", () => {
  it("2 分钟预热后，每分钟产出 >= 6 个中容武陵电池，持续 3 分钟", { timeout: 360_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const maxTick = WARMUP_TICKS + OBSERVATION_TICKS; // 6000

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: maxTick,
      registry: createRegistryContract(),
    });

    // 计算每个 tick 之前已交到目标存储箱的最终产物总量。
    const deliveredItemCounts: number[] = [];
    let delivered = 0;
    for (let t = 0; t <= maxTick; t++) {
      const tick = report.ticks[t];
      if (tick !== undefined) {
        delivered += tick.transfers
          .filter((transfer) =>
            transfer.itemType === TARGET_ITEM_ID
            && transfer.targetSlotId.includes(`device:${STORAGER_ID}/`),
          )
          .reduce((sum, transfer) => sum + transfer.amount, 0);
      }
      deliveredItemCounts.push(delivered);
    }

    // 滑动窗口验证：从 tick 2400 开始，每个 1200-tick（1分钟）窗口产出 >= TARGET_OUTPUT_PER_WINDOW
    const slidingWindowStartMin = WARMUP_TICKS;
    const slidingWindowStartMax = maxTick - WINDOW_SIZE + 1;
    const results: { windowStart: number; produced: number }[] = [];

    for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart++) {
      const windowEnd = windowStart + WINDOW_SIZE - 1;
      const beforeWindow = windowStart - 1;
      const produced = deliveredItemCounts[windowEnd]! - deliveredItemCounts[beforeWindow]!;

      results.push({ windowStart, produced });

      expect(
        produced,
        `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${TARGET_OUTPUT_PER_WINDOW}`,
      ).toBeGreaterThanOrEqual(TARGET_OUTPUT_PER_WINDOW);
    }

    // 额外验证：总体产出趋势合理
    const totalProduced = deliveredItemCounts[maxTick]! - deliveredItemCounts[WARMUP_TICKS - 1]!;
    const expectedMinTotal = (OBSERVATION_TICKS / WINDOW_SIZE) * TARGET_OUTPUT_PER_WINDOW;
    expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

    console.log(
      `[wuling-battery-line] ${results.length} 个滑动窗口全部通过，` +
      `总产出 ${totalProduced}，` +
      `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
    );
  });
});
