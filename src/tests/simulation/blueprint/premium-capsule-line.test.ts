import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "../blueprint-runner";
import {
  loadBlueprintFromFile,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/premium-capsule-line.json";
const STORAGER_ID = "legacy_429609a4_0158";
const WARMUP_TICKS = 2400; // 2 分钟预热
const WINDOW_SIZE = 1200; // 1 分钟窗口（20 tick/s × 60s）
const OBSERVATION_TICKS = 2400; // 预热后观察 2 分钟
const WINDOW_STEP = 100;   // 窗口滑动步长（tick），减少后处理计算量
const TARGET_OUTPUT_PER_WINDOW = 6;
const TARGET_ITEM_ID = "item_bottled_rec_hp_3";

// 该测试需从磁盘读取大型蓝图文件并运行仿真，耗时较长。
// 由 vitest blueprint project 承载，独立串行执行，不再依赖 HEAVY 环境变量。
// AI-CORRECTION 2026-05-18: 移除 HEAVY=1 / describe.skipIf，改为 vitest projects 区分。
describe("REQ-076: premium capsule line production", () => {
  it("2 分钟预热后，1 分钟滑动窗口产出 >= 6 个精选胶囊，持续 2 分钟", { timeout: 360_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const maxTick = WARMUP_TICKS + OBSERVATION_TICKS; // 4800

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

    // 滑动窗口验证：步长 WINDOW_STEP=100 tick，大幅减少后处理循环次数
    const slidingWindowStartMin = WARMUP_TICKS;
    const slidingWindowStartMax = maxTick - WINDOW_SIZE + 1;
    const results: { windowStart: number; produced: number }[] = [];

    for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart += WINDOW_STEP) {
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
      `[premium-capsule-line] ${results.length} 个滑动窗口全部通过，` +
      `总产出 ${totalProduced}，` +
      `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
    );
  });
});
