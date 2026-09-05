import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  BLUEPRINT_SIMULATION_ENGINE_KINDS,
  runBlueprintSimulation,
} from "../blueprint-runner";
import { loadBlueprintFromFile } from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/utimate-xiranite.json";

// 息壤粉 item 标识
const XIRANITE_POWDER_ITEM = "item_xiranite_powder";

const WARMUP_SECONDS = 120; // 2 分钟预热
const WINDOW_SECONDS = 60; // 1 分钟窗口（20 tick/s × 60s）
const OBSERVATION_SECONDS = 120; // 预热后观察 2 分钟
const WINDOW_STEP_SECONDS = 5;   // 窗口滑动步长
// AI-CORRECTION 2026-09-04: 上述窗口统一改用秒，运行后按 topology.standardTickRate 换算，不再固定假设 20 TPS。
const EXPECTED_XIRANITE_PER_MINUTE = 210;

describe.each(BLUEPRINT_SIMULATION_ENGINE_KINDS)(
  "天王坪7核息壤产线 - 息壤粉稳态产量验证 [%s]",
  (engineKind) => {
  it("2 分钟预热后，1 分钟滑动窗口产出 >= 210 个息壤粉，持续 2 分钟", { timeout: 720_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);

    // 收集蓝图中所有息壤烘炉实体 ID
    const ovenIds = Object.values(blueprint.entities)
      .filter((e) => e.definitionId === "xiranite_oven_1")
      .map((e) => e.id);

    if (ovenIds.length === 0) {
      throw new Error("蓝图中未找到息壤烘炉 (item_port_xiranite_oven_1)");
    }

    console.log(
      `[utimate-xiranite] 找到 ${ovenIds.length} 台息壤烘炉: [${ovenIds.join(", ")}]`,
    );

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

    // 累计息壤粉产出（从烘炉产出的传输量）
    const cumulative = new Array<number>(maxTick + 1).fill(0);
    for (const tick of report.ticks) {
      const t = tick.tickNumber;
      if (t > 0) cumulative[t] = cumulative[t - 1]!;
      for (const transfer of tick.transfers) {
        if (transfer.itemType !== XIRANITE_POWDER_ITEM) continue;
        for (const ovenId of ovenIds) {
          if (transfer.sourceSlotId!.includes(`device:${ovenId}`)) {
            cumulative[t] = cumulative[t]! + transfer.amount;
            break;
          }
        }
      }
    }
    for (let i = 1; i <= maxTick; i++) {
      if (cumulative[i]! === 0 && cumulative[i - 1]! > 0) cumulative[i] = cumulative[i - 1]!;
    }

    // 滑动窗口验证：步长 WINDOW_STEP=100 tick
    // AI-CORRECTION 2026-09-04: 当前步长为 WINDOW_STEP_SECONDS，并按本次引擎返回的 standardTickRate 换算。
    const slidingWindowStartMin = warmupTicks;
    const slidingWindowStartMax = maxTick - windowSize + 1;
    const results: { windowStart: number; produced: number }[] = [];

    for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart += windowStep) {
      const windowEnd = windowStart + windowSize - 1;
      const beforeWindow = windowStart - 1;
      const produced = cumulative[windowEnd]! - cumulative[beforeWindow]!;

      results.push({ windowStart, produced });

      expect(
        produced,
        `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${EXPECTED_XIRANITE_PER_MINUTE}`,
      ).toBeGreaterThanOrEqual(EXPECTED_XIRANITE_PER_MINUTE);
    }

    const totalProduced = cumulative[maxTick]! - cumulative[warmupTicks - 1]!;
    const expectedMinTotal = (observationTicks / windowSize) * EXPECTED_XIRANITE_PER_MINUTE;
    expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

    console.log(
      `[utimate-xiranite] ${results.length} 个滑动窗口全部通过，` +
      `总产出 ${totalProduced}，` +
      `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
    );
  });
  },
);
