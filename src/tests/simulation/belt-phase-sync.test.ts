import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
} from "./blueprint-test-helpers";

/**
 * 分组测试的六条传送带（不含取货口到设备的 belt:3:0）。
 *
 * 布局（rotation 均为 270，朝上）：
 *   Group A (y=19):  belt:18:1(51,19) — belt:24:0(52,19) — belt:29:1(53,19)
 *   Group B (y=20):  belt:17:0(51,20) — belt:22:0:1(52,20) — belt:28:0(53,20)
 *
 * 取货口→粉碎机的 belt:3:0(52,24) 不参与分组验证，但参与相位一致性验证。
 */
const BELT_IDS = [
  "logistics-draft:belt:17:0",
  "logistics-draft:belt:18:1",
  "logistics-draft:belt:22:0:1",
  "logistics-draft:belt:24:0",
  "logistics-draft:belt:28:0",
  "logistics-draft:belt:29:1",
];

/** 起点传送带（取货口→设备），不参与分组，仅参与相位一致性检查 */
const START_BELT_ID = "logistics-draft:belt:3:0";

/** 上排横向三连（y=19）：同组内要么同时有货、要么同时无货 */
const GROUP_A = [
  "logistics-draft:belt:18:1",
  "logistics-draft:belt:24:0",
  "logistics-draft:belt:29:1",
];

/** 下排横向三连（y=20）：同组内要么同时有货、要么同时无货 */
const GROUP_B = [
  "logistics-draft:belt:17:0",
  "logistics-draft:belt:22:0:1",
  "logistics-draft:belt:28:0",
];

/** 所有参与相位一致性检查的传送带（分组六条 + 起点一条） */
const ALL_BELT_IDS_FOR_PHASE = [...BELT_IDS, START_BELT_ID];

/** 传送带在蓝图中的坐标（y 从北向南递增） */
const BELT_POSITIONS: Record<string, { x: number; y: number }> = {
  "logistics-draft:belt:3:0": { x: 52, y: 24 },
  "logistics-draft:belt:17:0": { x: 51, y: 20 },
  "logistics-draft:belt:18:1": { x: 51, y: 19 },
  "logistics-draft:belt:22:0:1": { x: 52, y: 20 },
  "logistics-draft:belt:24:0": { x: 52, y: 19 },
  "logistics-draft:belt:28:0": { x: 53, y: 20 },
  "logistics-draft:belt:29:1": { x: 53, y: 19 },
};

describe("传送带同步相位", () => {
  it("分组内传送带状态一致，所有有货传送带相位一致（含起点 belt:3:0）", async () => {
    const blueprint = createBlueprint("belt-phase-sync", [
      // 取货口 — 作为物品源（warehouse link 在 headless 模式无效，改由 initialItem + ignoreStock 驱动）
      createEntity("item_port_unloader_1:5", "item_port_unloader_1", 51, 25, 180, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_plant_moss_3",
        "storageSlotGroups[0].slots[0].initialCount": 100,
        "storageSlotGroups[0].slots[0].ignoreStock": true,
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "item_port_unloader_1:5",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_plant_moss_3",
      }),
      // 存取线源桩（空壳，仅保持拓扑完整）
      createEntity("item_port_log_hongs_bus_source:2", "item_port_log_hongs_bus_source", 51, 26, 0),
      // 粉碎机
      createEntity("item_port_grinder_1:6", "item_port_grinder_1", 51, 21, 0),
      // 仓储（末端接收）
      createEntity("item_port_storager_1:7", "item_port_storager_1", 51, 16, 0),
      // 供电扩散器
      createEntity("item_port_power_diffuser_1:8", "item_port_power_diffuser_1", 54, 23, 0),
      // 分组测试的六条传送带
      ...BELT_IDS.map((id) => {
        const pos = BELT_POSITIONS[id]!;
        return createEntity(id, "belt_straight_1x1", pos.x, pos.y, 270);
      }),
      // 起点传送带（取货口→设备），不参与分组，仅参与相位校验
      createEntity(START_BELT_ID, "belt_straight_1x1", BELT_POSITIONS[START_BELT_ID]!.x, BELT_POSITIONS[START_BELT_ID]!.y, 270),
    ]);

    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: 400,
    });

    // 确认拓扑编译成功
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // 逐个 tick 验证传送带同步性
    for (const tick of report.ticks) {
      const beltStatuses = BELT_IDS
        .map((id) => tick.devices[id])
        .filter((s): s is NonNullable<typeof s> => s != null);

      // 所有传送带都应该在设备列表中
      if (beltStatuses.length !== BELT_IDS.length) {
        continue;
      }

      // 判断每条传送带是否有物品（任一 slot count > 0）
      const hasItemsMap = new Map(
        beltStatuses.map((s, i) => {
          const beltId = BELT_IDS[i]!;
          return [beltId, s.slotItems.some((slot) => slot.count > 0)] as const;
        }),
      );

      // 规则1：同组内三条横向相连的传送带要么同时有货，要么同时无货
      const groupAHasItems = GROUP_A.map((id) => hasItemsMap.get(id)!);
      const groupASame = groupAHasItems.every((h) => h === groupAHasItems[0]);
      expect(
        groupASame,
        `Tick ${tick.tickNumber}: Group A 物品状态不一致 ${JSON.stringify(groupAHasItems)}`,
      ).toBe(true);

      const groupBHasItems = GROUP_B.map((id) => hasItemsMap.get(id)!);
      const groupBSame = groupBHasItems.every((h) => h === groupBHasItems[0]);
      expect(
        groupBSame,
        `Tick ${tick.tickNumber}: Group B 物品状态不一致 ${JSON.stringify(groupBHasItems)}`,
      ).toBe(true);

      // 规则2：所有有货的传送带（含起点 belt:3:0）必须处于相同相位
      const allPhaseStatuses = ALL_BELT_IDS_FOR_PHASE
        .map((id) => tick.devices[id])
        .filter((s): s is NonNullable<typeof s> => s != null);

      if (allPhaseStatuses.length === ALL_BELT_IDS_FOR_PHASE.length) {
        const beltsWithItems = allPhaseStatuses.filter((s) =>
          s.slotItems.some((slot) => slot.count > 0),
        );

        if (beltsWithItems.length >= 2) {
          const phases = beltsWithItems.map((s) => s.progressSeconds);
          const allSamePhase = phases.every((p) => p === phases[0]);
          expect(
            allSamePhase,
            `Tick ${tick.tickNumber}: 有货传送带相位不一致 ${JSON.stringify(phases)}`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * 部分下游死路场景：粉碎机 3 个输出中只有 1 个连接到了仓储，
   * 另外 2 个是断头传送带。验证 blocked-resolved 不会死锁粉碎机，
   * 且仓储能按粉碎机节拍稳定收货。
   *
   * 布局（rotation 均为 270，朝上）：
   *   取货口(51,25) → belt:3:0(52,24) → 粉碎机(51,21)
   *   粉碎机 → belt:17:0(51,20) → storager(49,17) [通路]
   *   粉碎机 → belt:22:0:1(52,20) → 断头 [死路]
   *   粉碎机 → belt:28:0(53,20) → 断头 [死路]
   */
  it("粉碎机部分下游断头时仍能向存活下游稳定出货", async () => {
    const blueprint = createBlueprint("belt-partial-dead-end", [
      createEntity("item_port_unloader_1:5", "item_port_unloader_1", 51, 25, 180, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_plant_moss_3",
        "storageSlotGroups[0].slots[0].initialCount": 100,
        "storageSlotGroups[0].slots[0].ignoreStock": true,
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "item_port_unloader_1:5",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_plant_moss_3",
      }),
      createEntity("item_port_log_hongs_bus_source:2", "item_port_log_hongs_bus_source", 51, 26, 0),
      createEntity("item_port_grinder_1:6", "item_port_grinder_1", 51, 21, 0),
      // 仓储偏移到左侧，只有 belt:17:0(51,20) 的出口能对其南侧输入端口 x=51
      createEntity("item_port_storager_1:7", "item_port_storager_1", 49, 17, 0),
      createEntity("item_port_power_diffuser_1:8", "item_port_power_diffuser_1", 55, 22, 0),
      // 起点传送带
      createEntity("logistics-draft:belt:3:0", "belt_straight_1x1", 52, 24, 270),
      // 三条平行传送带（y=20）：只有 belt:17:0 连接 storager
      createEntity("logistics-draft:belt:17:0", "belt_straight_1x1", 51, 20, 270),
      createEntity("logistics-draft:belt:22:0:1", "belt_straight_1x1", 52, 20, 270),
      createEntity("logistics-draft:belt:28:0", "belt_straight_1x1", 53, 20, 270),
    ]);

    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: 400,
    });

    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // 收集仓储在各 tick 的物品总量
    const storagerSlotItemCounts: Array<{ tick: number; count: number }> = [];
    for (const tick of report.ticks) {
      const storager = tick.devices["item_port_storager_1:7"];
      if (storager === undefined) continue;
      const totalCount = storager.slotItems.reduce((sum, s) => sum + s.count, 0);
      storagerSlotItemCounts.push({ tick: tick.tickNumber, count: totalCount });
    }

    // 首个物品最迟在 200 tick 到达
    const firstReceiptTick = storagerSlotItemCounts.find((e) => e.count >= 1)?.tick ?? null;
    expect(firstReceiptTick, "仓储应在 200 tick 内收到首个物品").not.toBeNull();
    expect(firstReceiptTick!, "首个物品到达不应晚于 200 tick").toBeLessThanOrEqual(200);

    // 从首个物品到达后，每隔 ~40 tick 收到一个新物品
    // 到 400 tick 时至少应收到 floor((400 - first) / 40) + 1 件
    const finalCount = storagerSlotItemCounts[storagerSlotItemCounts.length - 1]?.count ?? 0;
    const expectedMinCount = Math.floor((400 - firstReceiptTick!) / 40) + 1;
    expect(
      finalCount,
      `从 tick ${firstReceiptTick} 开始应每 40 tick 收到一个物品，400 tick 时至少应有 ${expectedMinCount} 件`,
    ).toBeGreaterThanOrEqual(expectedMinCount);

    // 进一步验证：检查收货间隔是否稳定（第一个物品后每 40 tick 一件）
    const receiptTicks: number[] = [];
    let prevCount = 0;
    for (const entry of storagerSlotItemCounts) {
      if (entry.count > prevCount) {
        receiptTicks.push(entry.tick);
        prevCount = entry.count;
      }
    }

    // 从第二次收货开始，相邻两次收货间隔应为 40 tick（允许 ±2 tick 误差）
    for (let i = 2; i < receiptTicks.length; i++) {
      const interval = receiptTicks[i]! - receiptTicks[i - 1]!;
      expect(
        interval,
        `收货间隔 ${interval} 应接近 40 tick（第 ${i} 次收货 @ tick ${receiptTicks[i]})`,
      ).toBeGreaterThanOrEqual(38);
      expect(interval).toBeLessThanOrEqual(42);
    }
  });
});
