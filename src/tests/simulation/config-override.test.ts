import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/config-override/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   findSlot,
//   getTick,
// } from "./blueprint-test-helpers";
import { findSlot, getTick } from "./blueprint-test-helpers";

describe("REQ-076: config overrides", () => {
  it("runs a self-contained blueprint and applies slot plus port config overrides", async () => {
    // 新规则：设备间不可直接相连，必须通过通用物流设备（如 belt）中转。
    // 布局：source (0,1) → belt (0,0) rot270 → sink (0,-3)
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/config-override/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("config-overrides", [
    //       createEntity("source-storage", "storager_1", 0, 1, 0, {
    //         "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
    //         "storageSlotGroups[0].slots[0].initialCount": 7,
    //         "storageSlotGroups[0].slots[0].ignoreStock": true,
    //         // AI-REMOVED 2026-06-12:
    //         // Reason: port.count per-tick 覆盖属于已删除的错误设计。
    //         // Trigger: 用户确认 per tick count 应删除，准入口数量限制改为跨 tick admission counter。
    //         // Evidence: PortDefinition.count / CompiledSimulationTransferEdge.count 已注释化删除。
    //         // Replacement: src/tests/simulation/admission-rule.test.ts 覆盖 admissionRule.limit。
    //         // Risk: Low - 本测试仍覆盖 slot config override。
    //         // Human Review: Required
    //         //
    //         // Original code:
    //         // "portGroups[1].ports[0].count": 3,
    //       }),
    //       createEntity("belt", "belt_straight_1x1", 0, 0, 270),
    //       createEntity("sink-storage", "storager_1", 0, -3),
    //     ])
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/config-override/scene-01-config-overrides-a6643d0e.schema6.json");

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
    // AI-CORRECTION 2026-07-17: dedicated belt 的首次接收相位前移到 tick 1。
    const tick1 = getTick(report, 1);
    expect(tick1.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-storage")
      && t.targetSlotId.includes("device:belt"),
    )).toBe(true);

    // Tick 41: belt 配方完成，物品进入 sink
    const tick41 = getTick(report, 41);
    expect(tick41.transfers.some((t) =>
      t.sourceSlotId.includes("device:belt")
      && t.targetSlotId.includes("device:sink-storage"),
    )).toBe(true);

    // 验证 slot config 覆盖后的输送结果；port count 覆盖已移至 admission-rule 测试。
    expect(findSlot(report, 41, "sink-storage", "storage_slot_1", "slot_1"))
      .toMatchObject({
        itemType: "item_iron_ore",
        count: 1,
      });
  });
});
