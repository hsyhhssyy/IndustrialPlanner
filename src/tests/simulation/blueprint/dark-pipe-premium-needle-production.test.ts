import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { runBlueprintSimulation } from "../blueprint-runner";
import {
  createEntity,
  loadBlueprintWithExtras,
} from "../blueprint-test-helpers";

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
const STORAGER_ID = "legacy_d8591492_0104";
const WARMUP_TICKS = 2400; // 2 分钟预热
const WINDOW_SIZE = 1200; // 1 分钟窗口（20 tick/s × 60s）
const OBSERVATION_TICKS = 2400; // 预热后观察 2 分钟
const WINDOW_STEP = 100;   // 窗口滑动步长
const TARGET_PER_WINDOW = 6;

// AI-REMOVED 2026-08-19:
// Reason: 当前 schema 的抽水泵不能再通过输出槽初始物品和 ignoreStock 伪造无限清水。
// Trigger: 抽水泵改为手选配方真实生产。
// Evidence: water_pump_1.default 选择 r_pump_water_basic 后会按每秒 1 个清水运行。
// Replacement: WATER_PUMP_RECIPE_CONFIG。
// Risk: 产线供水现在受真实配方周期约束，属于本次需求指定行为。
// Human Review: Required
//
// Original code:
// {
//   "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
//   "storageSlotGroups[0].slots[0].initialCount": 1,
//   "storageSlotGroups[0].slots[0].ignoreStock": true,
// }
const WATER_PUMP_RECIPE_CONFIG = {
  channelRecipes: { default: "r_pump_water_basic" },
};

/** 22 个辅助设备，提取自 .temp/testcase.json */
const EXTRA_ENTITIES = [
  // ---- 供水 & 物流总线 ----
  createEntity("bus", "log_hongs_bus", 0, 0),
  createEntity("pump1", "water_pump_1", -10, -7, 0, WATER_PUMP_RECIPE_CONFIG),
  createEntity("bus_source", "log_hongs_bus_source", 0, 8),
  createEntity("pump2", "water_pump_1", -10, -4, 0, WATER_PUMP_RECIPE_CONFIG),

  // ---- 暗管端点（3 个新增） ----
  createEntity("dpipe_loader_a", "udpipe_loader_1", -6, -4),
  createEntity("dpipe_loader_b", "udpipe_loader_1", -6, -7),
  createEntity("dpipe_unloader_a", "udpipe_unloader_1", 0, 20, 0),

  // ---- 液体净化器 ×4 ----
  createEntity("cleaner1", "liquid_cleaner_1", 2, 17, 270),
  createEntity("cleaner2", "liquid_cleaner_1", 5, 17, 270),
  createEntity("cleaner3", "liquid_cleaner_1", 2, 23, 90),
  createEntity("cleaner4", "liquid_cleaner_1", 5, 23, 90),

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
  createEntity("splitter_a", "pipe_splitter", 6, 21, 270),
  createEntity("splitter_b", "pipe_splitter", 3, 21, 270),

  // ---- 供电 ----
  createEntity("power_aux", "power_diffuser_1", 8, 21),
];

describe("暗管芽针针剂完整产线", () => {
  it(
    "预热2分钟后，1分钟滑动窗口产出 >= 6个优质芽针针剂，持续2分钟",
    { timeout: 600_000 },
    async () => {
      // 1. 加载系统蓝图 + 注入辅助设备
      const blueprint = loadBlueprintWithExtras(
        "public/blueprints/dark-pipe-premium-needle-line.json",
        EXTRA_ENTITIES,
      );

      // 2. 建立暗管链接
      blueprint.slotLinks.push(
        createDarkPipeSlotLink({ outletEntityId: "test-extra-13", inletEntityId: "legacy_d8591492_0057" }),
        createDarkPipeSlotLink({ outletEntityId: "legacy_d8591492_0009", inletEntityId: "test-extra-6" }),
        createDarkPipeSlotLink({ outletEntityId: "legacy_d8591492_0103", inletEntityId: "test-extra-3" }),
      );

      // 3. 运行仿真
      const maxTick = WARMUP_TICKS + OBSERVATION_TICKS;
      const report = await runBlueprintSimulation({
        blueprint,
        maxTickNumber: maxTick,
        registry: createRegistryContract(),
      });

      // 4. 累计最终产物交到目标存储箱的数量
      const delivered: number[] = new Array(maxTick + 1).fill(0);
      for (const tick of report.ticks) {
        const t = tick.tickNumber;
        if (t > 0) delivered[t] = delivered[t - 1]!;
        for (const transfer of tick.transfers) {
          if (transfer.itemType === TARGET_ITEM && transfer.targetSlotId.includes(`device:${STORAGER_ID}/`)) {
            delivered[t] = delivered[t]! + transfer.amount;
          }
        }
      }
      for (let i = 1; i <= maxTick; i++) {
        if (delivered[i]! === 0 && delivered[i - 1]! > 0) delivered[i] = delivered[i - 1]!;
      }

      // 5. 滑动窗口验证
      const slidingWindowStartMin = WARMUP_TICKS;
      const slidingWindowStartMax = maxTick - WINDOW_SIZE + 1;
      const results: { windowStart: number; produced: number }[] = [];

      for (let windowStart = slidingWindowStartMin; windowStart <= slidingWindowStartMax; windowStart += WINDOW_STEP) {
        const windowEnd = windowStart + WINDOW_SIZE - 1;
        const beforeWindow = windowStart - 1;
        const produced = delivered[windowEnd]! - delivered[beforeWindow]!;

        results.push({ windowStart, produced });

        expect(
          produced,
          `滑动窗口 [${windowStart}, ${windowEnd}] 产出 ${produced} < ${TARGET_PER_WINDOW}`,
        ).toBeGreaterThanOrEqual(TARGET_PER_WINDOW);
      }

      const totalProduced = delivered[maxTick]! - delivered[WARMUP_TICKS - 1]!;
      const expectedMinTotal = (OBSERVATION_TICKS / WINDOW_SIZE) * TARGET_PER_WINDOW;
      expect(totalProduced).toBeGreaterThanOrEqual(expectedMinTotal);

      console.log(
        `[暗管芽针针剂] ${results.length} 个滑动窗口全部通过，` +
        `总产出 ${totalProduced}，` +
        `窗口产出范围 [${Math.min(...results.map(r => r.produced))}, ${Math.max(...results.map(r => r.produced))}]`,
      );
    },
  );
});
