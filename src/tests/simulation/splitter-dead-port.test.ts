import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createBlueprint, createEntity, createWarehouseSlotLink } from "./blueprint-test-helpers";

const MAX_TICK = 1800;

describe("分流器游标轮转 - 死端口不卡游标", () => {
  it("1800 tick 内两个已连接出口交替收到水（中间死端口不阻塞轮转）", { timeout: 60_000 }, async () => {
    // 简化的分流器测试蓝图：
    //   水源(8,2) → 管道(9,5)→(9,6) → 分流器(9,7) rot=270
    //     ├─ WEST  → 液体储存箱 A (6,6)            [roundRobinSeed=0，已连接]
    //     ├─ EAST  → [空地 — 死端口]               [roundRobinSeed=1，未连接]
    //     └─ SOUTH → 管道(9,8)→...→(9,12)→储存箱 B  [roundRobinSeed=2，已连接]
    // AI-CORRECTION 2026-05-18: 分流器端口默认方向变更 (input E→N)。
    // 由旧 rot=270 改为新 rot=0，等效朝向不变。
    const storagerA = "storager-a";
    const storagerB = "storager-b";
    const splitter = "splitter";

    const blueprint = createBlueprint(
      "splitter-dead-port-test",
      [
        // 水源 — 暗管出口 (8,2) rot=90 → 向东输出清水
        createEntity("water-source", "udpipe_unloader_1", 8, 2, 270, {
          "storageSlotGroups[0].slots[0].ignoreStock": true
        }),
        // 管道链: (9,5)→(9,6) → 分流器
        createEntity("pipe-1", "pipe_straight_1x1", 9, 5, 90),
        createEntity("pipe-2", "pipe_straight_1x1", 9, 6, 90),
        // 分流器 (9,7) rot=0（原 rot=270，2026-05-18 端口方向变更后等效旋转）
        createEntity(splitter, "pipe_splitter", 9, 7, 0),
        // 消费者 A — 液体储存箱 (6,6) rot=180
        createEntity(storagerA, "liquid_storager_1", 6, 6, 0),
        // 管道链: (9,8)→...→(9,12)
        createEntity("pipe-3", "pipe_straight_1x1", 9, 8, 90),
        createEntity("pipe-4", "pipe_straight_1x1", 9, 9, 90),
        createEntity("pipe-5", "pipe_straight_1x1", 9, 10, 90),
        createEntity("pipe-6", "pipe_straight_1x1", 9, 11, 90),
        createEntity("pipe-7", "pipe_straight_1x1", 9, 12, 90),
        // 消费者 B — 液体储存箱 (8,13) rot=90
        createEntity(storagerB, "liquid_storager_1", 8, 13, 270),
      ],
      [createWarehouseSlotLink("water-source", "item_liquid_water")],
    );

    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: MAX_TICK,
    });

    let waterToA = 0;
    let waterToB = 0;

    for (const tick of report.ticks) {
      for (const transfer of tick.transfers) {
        if (transfer.itemType !== "item_liquid_water") continue;

        if (transfer.targetSlotId.includes(`device:${storagerA}`)) {
          waterToA += transfer.amount;
        }
        if (transfer.targetSlotId.includes(`device:${storagerB}`)) {
          waterToB += transfer.amount;
        }
      }

      // 每 100 tick 检查两个储液罐的水量差
      if (tick.tickNumber > 0 && tick.tickNumber % 100 === 0) {
        const diff = Math.abs(waterToA - waterToB);
        expect(
          diff,
          `Tick ${tick.tickNumber}: 储液罐水量差 ${diff} 滴超过上限 5 滴 (A=${waterToA}, B=${waterToB})`,
        ).toBeLessThanOrEqual(5);
      }
    }

    // 两个已连接端口都应收到水
    expect(waterToA, "消费者 A 应收到水（WEST 出口下游）").toBeGreaterThan(0);
    expect(waterToB, "消费者 B 应收到水（SOUTH 出口下游）").toBeGreaterThan(0);

    const total = waterToA + waterToB;
    console.log(
      `[splitter-dead-port] A=${waterToA} B=${waterToB} 总量=${total} 最大差=${Math.abs(waterToA - waterToB)}滴 ✓`,
    );
  });
});
