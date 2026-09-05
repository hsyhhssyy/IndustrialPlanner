import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  BLUEPRINT_SIMULATION_ENGINE_KINDS,
  runBlueprintSimulation,
} from "../blueprint-runner";
import {
  loadBlueprintFromFile,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/wuling-battery-line.json";
const STORAGER_ID = "legacy_2dec8da2_0163";
const WARMUP_SECONDS = 180; // 3 分钟 = 180s × 20 tick/s
const WINDOW_SECONDS = 60; // 1 分钟窗口（20 tick/s × 60s）
const OBSERVATION_SECONDS = 120; // 预热后观察 2 分钟
const WINDOW_STEP_SECONDS = 5;   // 窗口滑动步长（tick），减少后处理计算量
// AI-CORRECTION 2026-09-04: 上述窗口统一改用秒，运行后按 topology.standardTickRate 换算，不再固定假设 20 TPS。
const TARGET_OUTPUT_PER_WINDOW = 6;
const TARGET_ITEM_ID = "item_proc_battery_5";

describe.each(BLUEPRINT_SIMULATION_ENGINE_KINDS)(
  "中容武陵电池产线 - 电池产量稳态验证 [%s]",
  (engineKind) => {
  it("3 分钟预热后，1 分钟滑动窗口产出 >= 6 个电池，持续 2 分钟", { timeout: 360_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);

    const report = await runBlueprintSimulation({
      blueprint,
      engineKind,
      maxDurationSeconds: WARMUP_SECONDS + OBSERVATION_SECONDS,
      registry: createRegistryContract(),
    });
    const standardTickRate = report.topology.standardTickRate;
    const warmupTicks = WARMUP_SECONDS * standardTickRate;
    const windowSize = WINDOW_SECONDS * standardTickRate;
    const observationTicks = OBSERVATION_SECONDS * standardTickRate;
    const windowStep = WINDOW_STEP_SECONDS * standardTickRate;
    const maxTick = report.execution.maxTickNumber;

    // 计算每个 tick 之前已交到目标存储箱的最终产物总量。
    const tickReportsByNumber = new Map(
      report.ticks.map((tick) => [tick.tickNumber, tick]),
    );
    const deliveredItemCounts: number[] = [];
    let delivered = 0;
    for (let t = 0; t <= maxTick; t++) {
      const tick = tickReportsByNumber.get(t);
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
    // AI-CORRECTION 2026-09-04: 当前步长为 WINDOW_STEP_SECONDS，并按本次引擎返回的 standardTickRate 换算。
    const slidingWindowStartMin = warmupTicks;
    const slidingWindowStartMax = maxTick - windowSize + 1;
    const results: { windowStart: number; produced: number }[] = [];

    for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart += windowStep) {
      const windowEnd = windowStart + windowSize - 1;
      const beforeWindow = windowStart - 1;
      const produced = deliveredItemCounts[windowEnd]! - deliveredItemCounts[beforeWindow]!;

      results.push({ windowStart, produced });

      expect(
        produced,
        `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${TARGET_OUTPUT_PER_WINDOW}`,
      ).toBeGreaterThanOrEqual(TARGET_OUTPUT_PER_WINDOW);
    }

    // 额外验证：总体产出趋势合理
    const totalProduced = deliveredItemCounts[maxTick]! - deliveredItemCounts[warmupTicks - 1]!;
    const expectedMinTotal = (observationTicks / windowSize) * TARGET_OUTPUT_PER_WINDOW;
    expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

    console.log(
      `[wuling-battery-line] ${results.length} 个滑动窗口全部通过，` +
      `总产出 ${totalProduced}，` +
      `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
    );
  });
  },
);

// AI-REMOVED 2026-07-23:
// Reason: 管道整秒门禁与双配方使该蓝图在 120～145 秒仍处于启动同步阶段，5 秒偏移窗口可能只有 5 件。
// Trigger: 用户要求将稳态蓝图测试预热时间提高到 180 秒。
// Evidence: 当前代码连续仿真到 3600 秒后，所有起点不早于 150 秒的一分钟滑动窗口均稳定为 6 件。
// Replacement: WARMUP_TICKS=3600，测试名称改为“3 分钟预热后”，总运行 tick 改为 6000。
// Risk: Low - 仅延后稳态断言起点，观察时长仍为 2 分钟。
// Human Review: Required
//
// Original code:
// const WARMUP_TICKS = 2400; // 2 分钟 = 120s × 20 tick/s
// it("2 分钟预热后，1 分钟滑动窗口产出 >= 6 个电池，持续 2 分钟", ...)
// const maxTick = WARMUP_TICKS + OBSERVATION_TICKS; // 4800
// AI-CORRECTION 2026-09-04: Active Code 现使用 WARMUP_SECONDS=180，运行后按 topology.standardTickRate 换算对应 tick。
