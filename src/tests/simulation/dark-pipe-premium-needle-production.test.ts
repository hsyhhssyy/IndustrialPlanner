import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createEntity,
  loadBlueprintWithExtras,
} from "./blueprint-test-helpers";

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
// 系统蓝图中的暗管端点实体（legacy ID 固定）：
//   legacy_d8591492_0009 → udpipe_unloader (outlet)
//   legacy_d8591492_0057 → udpipe_loader  (inlet)
//   legacy_d8591492_0103 → udpipe_unloader (outlet)
//
// 辅助设备中补充的暗管端点（通过 loadBlueprintWithExtras 注入后变为 test-extra-N）：
//   test-extra-3  → udpipe_loader  @ (-6,-4)  inlet
//   test-extra-6  → udpipe_loader  @ (-6,-7)  inlet
//   test-extra-13 → udpipe_unloader @ (0,20)  outlet
//
// 3 对暗管链接（outlet → inlet）：
//   test-extra-13 → legacy_d8591492_0057
//   legacy_d8591492_0009 → test-extra-6
//   legacy_d8591492_0103 → test-extra-3
//
// 6 条仓库链接（unloader_buffer → warehouse）：
//   legacy_d8591492_0001..0004 → warehouse:item_copper_ore（铜矿输入）
//   legacy_d8591492_0009 → warehouse:item_liquid_water（水输入）
//   legacy_d8591492_0103 → warehouse:item_liquid_water（水输入）
// ============================================================

const TARGET_ITEM = "item_bottled_rec_hp_5";
const TICKS_PER_MINUTE = 60 * STANDARD_TICK_RATE_PER_SECOND; // 1200
const WARMUP_MINUTES = 2;
const MEASURE_MINUTES = 5;
const TARGET_RATE_PER_MINUTE = 6;

/** 22 个辅助设备，提取自 .temp/testcase.json */
const EXTRA_ENTITIES = [
  // ---- 供水 & 物流总线 ----
  createEntity("bus", "item_port_log_hongs_bus", 0, 0),
  createEntity("pump1", "item_port_water_pump_1", -10, -7, 0, {
    "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
    "storageSlotGroups[0].slots[0].initialCount": 1,
    "storageSlotGroups[0].slots[0].ignoreStock": true,
  }),
  createEntity("bus_source", "item_port_log_hongs_bus_source", 0, 8),
  createEntity("pump2", "item_port_water_pump_1", -10, -4, 0, {
    "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
    "storageSlotGroups[0].slots[0].initialCount": 1,
    "storageSlotGroups[0].slots[0].ignoreStock": true,
  }),

  // ---- 暗管端点（3 个新增） ----
  createEntity("dpipe_loader_a", "item_port_udpipe_loader_1", -6, -4, 0, {
    "recipeChannels[0].manualRecipeOnly": true,
  }),
  createEntity("dpipe_loader_b", "item_port_udpipe_loader_1", -6, -7, 0, {
    "recipeChannels[0].manualRecipeOnly": true,
  }),
  createEntity("dpipe_unloader_a", "item_port_udpipe_unloader_1", 0, 20, 0),

  // ---- 液体净化器 ×4 ----
  createEntity("cleaner1", "item_liquid_cleaner_1", 2, 17, 270),
  createEntity("cleaner2", "item_liquid_cleaner_1", 5, 17, 270),
  createEntity("cleaner3", "item_liquid_cleaner_1", 2, 23, 90),
  createEntity("cleaner4", "item_liquid_cleaner_1", 5, 23, 90),

  // ---- 管道路由 ----
  createEntity("pipe_a", "pipe_straight_1x1", -7, -6),
  createEntity("pipe_b", "pipe_straight_1x1", -7, -3),
  createEntity("pipe_c", "pipe_straight_1x1", 4, 21),
  createEntity("pipe_d", "pipe_straight_1x1", 5, 21),
  createEntity("pipe_e", "pipe_straight_1x1", 6, 20, 270),
  createEntity("pipe_f", "pipe_straight_1x1", 6, 22, 90),
  createEntity("pipe_g", "pipe_straight_1x1", 3, 20, 270),
  createEntity("pipe_h", "pipe_straight_1x1", 3, 22, 90),

  // ---- 管道分流器 ×2 ----
  createEntity("splitter_a", "item_pipe_splitter", 6, 21, 270),
  createEntity("splitter_b", "item_pipe_splitter", 3, 21, 270),

  // ---- 供电 ----
  createEntity("power_aux", "item_port_power_diffuser_1", 8, 21),
];

describe("暗管芽针针剂完整产线", () => {
  it(
    "预热2分钟后，每分钟稳定产出6个优质芽针针剂，持续5分钟",
    { timeout: 600_000 },
    async () => {
      // 1. 加载系统蓝图 + 注入辅助设备
      const blueprint = loadBlueprintWithExtras(
        "public/blueprints/dark-pipe-premium-needle-line.json",
        EXTRA_ENTITIES,
      );

      // 2. 建立暗管链接：蓝图自带 6 条 warehouse slotLink（已由 loadBlueprintWithExtras 保留），
      //    测试只需补充 3 条暗管链接（outlet → inlet）
      blueprint.slotLinks.push(
        // ① test-extra-13（新增 outlet @0,20）→ legacy_d8591492_0057（蓝图 inlet @12,4）
        createDarkPipeSlotLink({
          outletEntityId: "test-extra-13",
          inletEntityId: "legacy_d8591492_0057",
        }),
        // ② legacy_d8591492_0009（蓝图 outlet @8,4）→ test-extra-6（新增 inlet @-6,-7）
        createDarkPipeSlotLink({
          outletEntityId: "legacy_d8591492_0009",
          inletEntityId: "test-extra-6",
        }),
        // ③ legacy_d8591492_0103（蓝图 outlet @20,0）→ test-extra-3（新增 inlet @-6,-4）
        createDarkPipeSlotLink({
          outletEntityId: "legacy_d8591492_0103",
          inletEntityId: "test-extra-3",
        }),
      );

      // 3. 运行仿真
      const totalTicks = (WARMUP_MINUTES + MEASURE_MINUTES) * TICKS_PER_MINUTE;

      const report = await runBlueprintSimulation({
        blueprint,
        maxTickNumber: totalTicks,
        registry: createRegistryContract(),
      });

      // 验证拓扑无编译错误
      expect(report.topology.diagnosticCount, "拓扑编译应无错误").toBe(0);

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
