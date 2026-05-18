import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlotWithItem,
  getTick,
} from "../blueprint-test-helpers";

describe("REQ-076: fanout routing", () => {
  it("routes around blocked fan-out inputs instead of starving open downstream capacity", async () => {
    // 新规则：设备间不可直接相连，通过通用物流设备（belt + splitter）中转。
    // 布局：
    //   source (0,1) → belt (0,0) rot270 → splitter (0,-1) rot90
    //     ├─ out_w(N→rot) → belt (0,-2) rot270 → blocked-storage (0,-5)
    //     └─ out_n(E→rot) → belt (1,-1) rot0   → open-storage (2,-1) rot90
    // 时序：每段 belt/splitter 各 40 tick，共 3 段 = 120 tick。
    // AI-CORRECTION 2026-05-18: 分流器端口默认方向变更 (input E→N)，rot 90→180。
    // 端口排列 E/W/S 使 belt-open 的 W 端口(index=1)优先于 belt-blocked 的 S 端口(index=2)。
    const blockedConfig = Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((index) => [
      [`storageSlotGroups[${index}].slots[0].initialItemType`, "item_copper_ore"],
      [`storageSlotGroups[${index}].slots[0].initialCount`, 50],
    ]));
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("blocked-fanout", [
        createEntity("source-storage", "item_port_storager_1", 0, 1, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("belt-source", "belt_straight_1x1", 0, 0, 270),
        createEntity("splitter", "item_log_splitter", 0, -1, 180),
        createEntity("belt-blocked", "belt_straight_1x1", 0, -2, 270),
        createEntity("blocked-storage", "item_port_storager_1", 0, -5, 0, blockedConfig),
        createEntity("belt-open", "belt_straight_1x1", 1, -1, 0),
        createEntity("open-storage", "item_port_storager_1", 2, -1, 90),
      ]),
      maxTickNumber: 150,
    });

    // 验证 topology 编译成功
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // 物品经过 3 段物流 (belt→splitter→belt-open) 各 40 tick，在 tick 121 到达 open-storage。
    // open-storage 在 (0,-4), belt-open 在 (0,-2)，belt-open→open-storage 还需经过 (0,-3) 的空隙。
    // AI-CORRECTION 2026-05-18: 新端口排列下 belt-open 通过 S 端口优先连接，时序不变。
    // AI-CORRECTION 2026-05-18: dedicated belt 接收/输出改为 20 tick 相位门控，终点到达为 tick 140。
    // 验证 blocked-storage 全程未收到物品。
    const allTransfers = report.ticks.flatMap((tick) => tick.transfers);
    const hasBlockedTransfer = allTransfers.some((transfer) =>
      transfer.targetSlotId.includes("device:blocked-storage"),
    );
    expect(hasBlockedTransfer).toBe(false);

    // 物品应最终在 open-storage 中（splitter→belt-open 在 tick 100，belt-open→open-storage 在 tick 140）
    const tick140 = getTick(report, 140);
    expect(tick140.transfers.some((transfer) =>
      transfer.targetSlotId.includes("device:open-storage"),
    )).toBe(true);

    expect(findSlotWithItem(report, 140, "open-storage", "item_iron_ore"))
      .toMatchObject({
        storageGroupId: "item_storage",
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
