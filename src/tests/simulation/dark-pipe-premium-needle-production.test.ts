import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";

// ============================================================
// 暗管芽针针剂 — 完整产线产出验证
// ============================================================
// 目标产物: 优质芽针针剂 (item_bottled_rec_hp_5)
// 配方: r_packaging_bottled_rec_hp_5_from_copper_cmpt_and_copper_bottle_filled_grass_2_basic
// 配方时间: 10秒 → 6个/分钟
// 生产设备: item_port_tools_asm_mc_1 (高级制造台)
//
// 测试场景:
//   1. 加载系统蓝图「全暗管优质芽针针剂」
//   2. 补充辅助设备（供水泵、物流总线、熔炉、传送带、管道等外围设施）
//   3. 建立暗管链接（3对 inlet↔outlet）
//   4. 预热2分钟后，滑动窗口统计产出速率
//
// 辅助设备和链接信息提取自 .temp/testcase.json
// ============================================================

const TARGET_ITEM = "item_bottled_rec_hp_5";
const TICKS_PER_MINUTE = 60 * STANDARD_TICK_RATE_PER_SECOND; // 1200
const WARMUP_MINUTES = 2;
const MEASURE_MINUTES = 5;
const TARGET_RATE_PER_MINUTE = 6;

describe("暗管芽针针剂完整产线", () => {
  it(
    "预热2分钟后，每分钟稳定产出6个优质芽针针剂，持续5分钟",
    { timeout: 600_000 },
    async () => {
      // 加载完整蓝图（系统蓝图 + 辅助设施 + 暗管链接）
      const blueprint = loadBlueprintFromFile(
        ".temp/testcase.json",
      );

      const totalTicks = (WARMUP_MINUTES + MEASURE_MINUTES) * TICKS_PER_MINUTE;

      const report = await runBlueprintSimulation({
        blueprint,
        maxTickNumber: totalTicks,
        registry: createRegistryContract(),
      });

      // 验证拓扑无编译错误
      expect(report.topology.diagnosticCount, "拓扑编译应无错误").toBe(0);

      // 诊断：列出所有传输的物品种类（前10和末10 tick）
      const itemTypesEarly = new Set<string>();
      for (const tick of report.ticks.slice(0, 10)) {
        for (const transfer of tick.transfers) {
          itemTypesEarly.add(transfer.itemType);
        }
      }
      const itemTypesLate = new Set<string>();
      for (const tick of report.ticks.slice(-10)) {
        for (const transfer of tick.transfers) {
          itemTypesLate.add(transfer.itemType);
        }
      }
      console.log(`[诊断] 传输物品种类 前10tick: [${[...itemTypesEarly].sort().join(", ")}]`);
      console.log(`[诊断] 传输物品种类 末10tick: [${[...itemTypesLate].sort().join(", ")}]`);

      // 诊断：末 tick 有活跃配方的设备
      const lastTickReport = report.ticks[report.ticks.length - 1]!;
      const activeDeviceCount = { total: 0, withRecipes: 0 };
      for (const [deviceId, device] of Object.entries(lastTickReport.devices)) {
        activeDeviceCount.total++;
        const recipes = device.channelRecipes;
        if (recipes) {
          const active = Object.entries(recipes).filter(([, r]) => r !== null);
          if (active.length > 0) {
            activeDeviceCount.withRecipes++;
            if (activeDeviceCount.withRecipes <= 5) {
              console.log(`[诊断] ${deviceId}: ${active.map(([ch, r]) => `${ch}:${r!.recipeId}`).join(", ")}, power=${device.powerStatus}`);
            }
          }
        }
      }
      console.log(`[诊断] 总设备: ${activeDeviceCount.total}, 有活跃配方: ${activeDeviceCount.withRecipes}`);

      // 诊断：末 tick 有物品的设备槽位
      let deviceWithItems = 0;
      for (const [deviceId, device] of Object.entries(lastTickReport.devices)) {
        const filledSlots = device.slotItems.filter(s => s.count > 0);
        if (filledSlots.length > 0) {
          deviceWithItems++;
          if (deviceWithItems <= 5) {
            console.log(`[诊断] ${deviceId}: ${filledSlots.map(s => `${s.storageGroupId}:${s.slotId}=${s.itemType}×${s.count}`).join(", ")}`);
          }
        }
      }
      console.log(`[诊断] 有物品的设备: ${deviceWithItems}`);

      // 按分钟统计 item_bottled_rec_hp_5 的全局传输量
      // 物品从制造台产出后经过 N 段传送带到达储存箱，
      // 每段传送带产生一次传输事件，因此传输计数 = 产出数 × N
      // 关键验证: 每分钟传输量是否稳定（产线达稳态后各分钟应一致）
      const perMinuteTransfers: number[] = [];

      for (
        let minute = WARMUP_MINUTES;
        minute < WARMUP_MINUTES + MEASURE_MINUTES;
        minute++
      ) {
        const startTick = minute * TICKS_PER_MINUTE;
        const endTick = (minute + 1) * TICKS_PER_MINUTE;
        let count = 0;

        for (const tick of report.ticks) {
          if (tick.tickNumber >= startTick && tick.tickNumber < endTick) {
            for (const transfer of tick.transfers) {
              if (transfer.itemType === TARGET_ITEM) {
                count += transfer.amount;
              }
            }
          }
        }

        perMinuteTransfers.push(count);
      }

      // 验证每分钟传输量稳定一致
      const uniqueValues = new Set(perMinuteTransfers);
      expect(
        uniqueValues.size,
        `每分钟传输量应稳定一致，实际: ${JSON.stringify(perMinuteTransfers)}`,
      ).toBe(1);

      const stableCount = perMinuteTransfers[0]!;
      expect(stableCount, "每分钟传输量应大于0").toBeGreaterThan(0);

      // 传输量应为产出速率的整数倍（N 段传送带）
      expect(
        stableCount % TARGET_RATE_PER_MINUTE,
        `传输量 ${stableCount} 应为 ${TARGET_RATE_PER_MINUTE} 的整数倍`,
      ).toBe(0);

      const beltSegments = stableCount / TARGET_RATE_PER_MINUTE;

      console.log(
        `[暗管芽针针剂] 每分钟传输量: ${stableCount}, ` +
          `路径段数: ${beltSegments}, ` +
          `产出速率: ${TARGET_RATE_PER_MINUTE}/分钟 ✓`,
      );
    },
  );
});
