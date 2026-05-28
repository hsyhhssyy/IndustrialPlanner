import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getTick,
} from "./blueprint-test-helpers";

describe("REQ-076: config overrides", () => {
  it("runs a self-contained blueprint and applies slot plus port config overrides", async () => {
    // 新规则：设备间不可直接相连，必须通过通用物流设备（如 belt）中转。
    // 布局：source (0,1) → belt (0,0) rot270 → sink (0,-3)
    const blueprint = createBlueprint("config-overrides", [
      createEntity("source-storage", "item_port_storager_1", 0, 1, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
        "storageSlotGroups[0].slots[0].initialCount": 7,
        "storageSlotGroups[0].slots[0].ignoreStock": true,
        "portGroups[1].ports[0].count": 3,
      }),
      createEntity("belt", "belt_straight_1x1", 0, 0, 270),
      createEntity("sink-storage", "item_port_storager_1", 0, -3),
    ]);

    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxTickNumber: 60,
    });

    expect(report.blueprint).toMatchObject({
      name: "config-overrides",
      baseId: "wuling_protocol_core",
      entityCount: 3,
      slotLinkCount: 0,
    });
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // Tick 0: source 持有 7 个铁矿石
    expect(findSlot(report, 0, "source-storage", "storage_slot_1", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 7,
      });

    // Tick 1: 物品从 source 传输到 belt（belt buffer 容量为 1，仅接纳 1 个）
    // AI-CORRECTION 2026-05-18: dedicated belt 相位按标准 tick 对齐，首次接收发生在 tick 20。
    const tick1 = getTick(report, 1);
    expect(tick1.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-storage")
      && t.targetSlotId.includes("device:belt"),
    )).toBe(false);
    const tick20 = getTick(report, 20);
    expect(tick20.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-storage")
      && t.targetSlotId.includes("device:belt"),
    )).toBe(true);

    // Tick 41: belt 配方完成，物品进入 sink
    // AI-CORRECTION 2026-05-18: dedicated belt 输出也按标准 tick 相位对齐，首件在 tick 60 进入 sink。
    const tick60 = getTick(report, 60);
    expect(tick60.transfers.some((t) =>
      t.sourceSlotId.includes("device:belt")
      && t.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);

    // 验证 port count 覆盖生效：source 的 portGroups[1].ports[0].count 被设为 3
    expect(findSlot(report, 60, "sink-storage", "storage_slot_1", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
