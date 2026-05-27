import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  createEntity,
  loadBlueprintWithExtras,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/dual-oven-xiranite.json";

// 息壤粉 item 标识
const XIRANITE_POWDER_ITEM = "item_xiranite_powder";

// 总仿真 tick 数（10 分钟 = 12000 ticks：5 分钟达标 + 5 分钟稳态维持）
const MAX_TICK = 10 * 60 * STANDARD_TICK_RATE_PER_SECOND;
// 每分钟 tick 数
const TICKS_PER_MINUTE = 60 * STANDARD_TICK_RATE_PER_SECOND;
// 期望每分钟息壤粉产量
const EXPECTED_XIRANITE_PER_MINUTE = 60;
// 稳态达标时限：必须在第 5 分钟结束前达到 60/分钟
const STEADY_DEADLINE_MINUTE = 5;
// 稳态维持要求：达标后至少连续稳定 5 分钟
const MIN_STEADY_DURATION_MINUTES = 5;

// 该测试需从磁盘读取大型蓝图文件并运行 12000 tick 仿真。
// 由 vitest blueprint project 承载，独立串行执行，不再依赖 HEAVY 环境变量。
// AI-CORRECTION 2026-05-18: 移除 HEAVY=1 / describe.skipIf，改为 vitest projects 区分。
describe("双烘炉息壤产线 - 息壤粉稳态产量验证", () => {
  it("5 分钟内达到 60/分钟稳态，并持续稳定至少 5 分钟", { timeout: 600_000 }, async () => {
    const blueprint = loadBlueprintWithExtras(BLUEPRINT_PATH, [
      // 上方暗管出口 → 接入左侧水管网末端 pipe_straight_1x1 @ (9,0) rot=90
      // 出水口位于 (9,-1) 朝南，向 (9,0) 输出清水
      createEntity("extra-top", "item_port_udpipe_unloader_1", 8, -3, 90, {
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_liquid_water",
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      }),
      // 下方暗管出口 → 接入右侧水管网末端 pipe_straight_1x1 @ (20,24) rot=270
      // rot=270: 出水口位于 (x+1, y+0) = (20, 25) 朝北，向 (20, 24) 输出清水
      createEntity("extra-bottom", "item_port_udpipe_unloader_1", 19, 25, 270, {
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_liquid_water",
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      }),
    ]);

    // 收集蓝图中所有息壤烘炉实体 ID
    const ovenIds = Object.values(blueprint.entities)
      .filter((e) => e.definitionId === "item_port_xiranite_oven_1")
      .map((e) => e.id);

    if (ovenIds.length === 0) {
      throw new Error("蓝图中未找到息壤烘炉 (item_port_xiranite_oven_1)");
    }

    console.log(
      `[dual-oven-xiranite] 找到 ${ovenIds.length} 台息壤烘炉: [${ovenIds.join(", ")}]`,
    );

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: MAX_TICK,
    });

    // 按 tick 累计息壤粉产出量
    // cumulative[tick] = 从 tick 0 到 tick 的息壤粉累计产出
    const cumulative = new Array<number>(MAX_TICK + 1).fill(0);

    for (const tick of report.ticks) {
      const tickNum = tick.tickNumber;
      // 继承上一 tick 的累计值
      if (tickNum > 0) {
        cumulative[tickNum] = cumulative[tickNum - 1]!;
      }

      for (const transfer of tick.transfers) {
        if (transfer.itemType !== XIRANITE_POWDER_ITEM) continue;

        // 只统计从息壤烘炉产出的息壤粉
        for (const ovenId of ovenIds) {
          if (transfer.sourceSlotId!.includes(`device:${ovenId}`)) {
            cumulative[tickNum] = cumulative[tickNum]! + transfer.amount;
            break;
          }
        }
      }
    }

    // 填充未被 tick 覆盖的累计值（某些 tick 可能无 snapshot）
    for (let i = 1; i <= MAX_TICK; i++) {
        if (cumulative[i]! === 0 && cumulative[i - 1]! > 0) {
          cumulative[i] = cumulative[i - 1]!;
      }
    }

    const totalMinutes = MAX_TICK / TICKS_PER_MINUTE;

    // ═══════════════════════════════════════════════
    // 诊断输出：分析产量变化趋势，找到稳态起始点
    // ═══════════════════════════════════════════════

    console.log(`\n[dual-oven-xiranite] ═══ 息壤粉产量诊断（总仿真 ${totalMinutes} 分钟）═══`);
    console.log(`  总 tick: ${MAX_TICK}`);
    console.log(`  累计产出: ${cumulative[MAX_TICK]} (理论最大: ${totalMinutes * EXPECTED_XIRANITE_PER_MINUTE})`);

    // 1. 按分钟拆分，观察每分钟增量
    console.log(`\n  [按分钟拆分] 每分钟息壤粉产量:`);
    for (let minuteEnd = TICKS_PER_MINUTE; minuteEnd <= MAX_TICK; minuteEnd += TICKS_PER_MINUTE) {
      const minuteStart = minuteEnd - TICKS_PER_MINUTE;
        const prod = cumulative[minuteEnd]! - cumulative[minuteStart]!;
      const minuteIndex = minuteEnd / TICKS_PER_MINUTE;
      const marker = prod === EXPECTED_XIRANITE_PER_MINUTE ? "✓" : "✗";
      console.log(`    第 ${minuteIndex} 分钟 [${minuteStart}, ${minuteEnd}]: ${prod} ${marker}`);
    }

    // 2. 滑动窗口：每个完整 1200-tick 窗口的产量
    console.log(`\n  [滑动窗口] 所有 1 分钟窗口产量分布:`);
    const windowResults: Array<{ windowEnd: number; production: number }> = [];
    for (let windowEnd = TICKS_PER_MINUTE; windowEnd <= MAX_TICK; windowEnd++) {
        const production = cumulative[windowEnd]! - cumulative[windowEnd - TICKS_PER_MINUTE]!;
      windowResults.push({ windowEnd, production });
    }

    // 按产量值分组统计
    const productionDistribution = new Map<number, number>();
    for (const r of windowResults) {
      productionDistribution.set(r.production, (productionDistribution.get(r.production) ?? 0) + 1);
    }
    const sortedDist = [...productionDistribution.entries()].sort((a, b) => a[0] - b[0]);
    console.log(`    产量值 → 窗口数: ${sortedDist.map(([p, c]) => `${p}×${c}`).join(", ")}`);

    // 3. 找稳态起始点：从哪个 tick 开始连续稳定在 60/分钟
    let stableStartTick = -1;
    let stableStreak = 0;
    const MIN_STABLE_WINDOWS = 5; // 连续 5 个窗口稳定即视为稳态
    for (const r of windowResults) {
      if (r.production === EXPECTED_XIRANITE_PER_MINUTE) {
        stableStreak++;
        if (stableStreak >= MIN_STABLE_WINDOWS && stableStartTick === -1) {
          stableStartTick = r.windowEnd - TICKS_PER_MINUTE * stableStreak;
        }
      } else {
        stableStreak = 0;
        stableStartTick = -1;
      }
    }

    if (stableStartTick >= 0) {
      const stableStartSec = (stableStartTick / STANDARD_TICK_RATE_PER_SECOND).toFixed(1);
      console.log(`\n  [稳态分析] 从 tick ${stableStartTick} (${stableStartSec}s) 起进入稳态，产量稳定在 ${EXPECTED_XIRANITE_PER_MINUTE}/分钟`);
    } else {
      console.log(`\n  [稳态分析] 4 分钟内未达到稳定在 ${EXPECTED_XIRANITE_PER_MINUTE}/分钟的稳态`);
    }

    // 4. 产量变化时间线：按产量值分段输出区间
    console.log(`\n  [产量变化时间线]`);
      let rangeStartSec = (windowResults[0]!.windowEnd - TICKS_PER_MINUTE) / STANDARD_TICK_RATE_PER_SECOND;
      let rangeValue = windowResults[0]!.production;
    for (let i = 1; i < windowResults.length; i++) {
        if (windowResults[i]!.production !== rangeValue) {
          const rangeEndSec = windowResults[i - 1]!.windowEnd / STANDARD_TICK_RATE_PER_SECOND;
        console.log(`    ${rangeStartSec.toFixed(0)}s → ${rangeEndSec.toFixed(0)}s: ${rangeValue}/分钟`);
          rangeStartSec = (windowResults[i]!.windowEnd - TICKS_PER_MINUTE) / STANDARD_TICK_RATE_PER_SECOND;
          rangeValue = windowResults[i]!.production;
      }
    }
      const lastEndSec = windowResults[windowResults.length - 1]!.windowEnd / STANDARD_TICK_RATE_PER_SECOND;
    console.log(`    ${rangeStartSec.toFixed(0)}s → ${lastEndSec.toFixed(0)}s: ${rangeValue}/分钟`);

    // 5. 诊断停产原因：导出所有设备在仿真结束时的完整库存
    console.log(`\n  [停产诊断] 仿真结束时 (tick ${MAX_TICK}) 全部设备库存:`);
const lastTick = report.ticks[report.ticks.length - 1]!;

    // 定义设备类型到中文标签的映射
    const labelMap: Record<string, string> = {
      item_port_xiranite_oven_1: "息壤烘炉",
      item_port_furnance_1: "熔炉",
      item_port_grinder_1: "粉碎机",
      item_port_hydro_planter_1: "水培种植机",
      item_port_planter_1: "种植机",
      item_port_seedcol_1: "种子收集器",
      item_port_power_diffuser_1: "供电扩散器",
      item_port_liquid_furnance_1: "液体熔炉",
      item_port_udpipe_unloader_1: "暗管出口",
    };

    // 按实体 ID 排序以保证输出稳定
    const allEntityIds = Object.keys(blueprint.entities).sort();
    for (const entityId of allEntityIds) {
        const entity = blueprint.entities[entityId]!;
      const device = lastTick.devices[entityId];
      if (!device) continue;

      const label = labelMap[entity.definitionId] ?? entity.definitionId;
      const pos = `(${entity.position.x},${entity.position.y})`;

      // 显示所有 slot（包括空的）
      const slotDescs = device.slotItems.map((s) => {
        const itemStr = s.itemType ?? "(空)";
        return `${s.slotId}=${itemStr}×${s.count}`;
      });

      if (slotDescs.length > 0) {
        console.log(`    [${label}] ${entityId} @${pos}: ${slotDescs.join(", ")}`);
      } else {
        console.log(`    [${label}] ${entityId} @${pos}: (无槽位数据)`);
      }
    }

    // ═══════════════════════════════════════════════
    // 断言：稳态达标 & 维持
    // ═══════════════════════════════════════════════

    // 按非重叠分钟窗口提取产量
    const minuteProductions: number[] = [];
    for (let minuteEnd = TICKS_PER_MINUTE; minuteEnd <= MAX_TICK; minuteEnd += TICKS_PER_MINUTE) {
      const minuteStart = minuteEnd - TICKS_PER_MINUTE;
      minuteProductions.push(cumulative[minuteEnd]! - cumulative[minuteStart]!);
    }
    // minuteProductions[i] 对应第 i+1 分钟的产量

    // 找到首个达到稳态的分钟索引（从 1 开始计数：第 1,2,3... 分钟）
    let firstSteadyMinute = -1;
    for (let i = 0; i < minuteProductions.length; i++) {
      if (minuteProductions[i] === EXPECTED_XIRANITE_PER_MINUTE) {
        firstSteadyMinute = i + 1;
        break;
      }
    }

    expect(
      firstSteadyMinute,
      `未能在 ${STEADY_DEADLINE_MINUTE} 分钟内达到 ${EXPECTED_XIRANITE_PER_MINUTE}/分钟稳态`,
    ).toBeGreaterThan(0);
    expect(
      firstSteadyMinute,
      `稳态到达于第 ${firstSteadyMinute} 分钟，超过 ${STEADY_DEADLINE_MINUTE} 分钟时限`,
    ).toBeLessThanOrEqual(STEADY_DEADLINE_MINUTE);

    // 稳态后持续验证：从首个稳态分钟起，至少连续 MIN_STEADY_DURATION_MINUTES 分钟保持 60/分钟
    const steadyIndex = firstSteadyMinute - 1;
    const availableMinutes = minuteProductions.length - steadyIndex;
    const requiredMinutes = Math.min(MIN_STEADY_DURATION_MINUTES, availableMinutes);

    expect(
      availableMinutes,
      `稳态从第 ${firstSteadyMinute} 分钟开始，但剩余仅 ${availableMinutes} 分钟，不足 ${MIN_STEADY_DURATION_MINUTES} 分钟`,
    ).toBeGreaterThanOrEqual(MIN_STEADY_DURATION_MINUTES);

    for (let offset = 0; offset < requiredMinutes; offset++) {
      expect(
        minuteProductions[steadyIndex + offset],
        `稳态第 ${firstSteadyMinute + offset} 分钟产量 ${minuteProductions[steadyIndex + offset]} ≠ ${EXPECTED_XIRANITE_PER_MINUTE}，稳态中断`,
      ).toBe(EXPECTED_XIRANITE_PER_MINUTE);
    }

    console.log(
      `\n[dual-oven-xiranite] 断言通过：第 ${firstSteadyMinute} 分钟进入稳态，` +
      `持续 ${requiredMinutes} 分钟稳定在 ${EXPECTED_XIRANITE_PER_MINUTE}/分钟 ✓\n`,
    );
  });
});
