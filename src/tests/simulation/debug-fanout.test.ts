import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/debug-fanout/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import { createBlueprint, createEntity } from "./blueprint-test-helpers";

// AI-REMOVED 2026-05-17:
// Reason: getTick 未在本测试文件使用，保留 import 会阻断全仓 lint。
// Trigger: REQ-078 验收运行 npm run lint 时暴露 no-unused-vars。
// Evidence: rg 仅命中 import 行，无有效引用。
// Replacement: 当前 import 仅保留 createBlueprint/createEntity。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { createBlueprint, createEntity, getTick } from "./blueprint-test-helpers";

describe("debug-fanout", () => {
  it("debug", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/debug-fanout/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const blockedConfig = Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((index) => [
    //       [`storageSlotGroups[0].slots[${index}].initialItemType`, "item_copper_ore"],
    //       [`storageSlotGroups[0].slots[${index}].initialCount`, 50],
    //     ]));
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/debug-fanout/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("blocked-fanout", [
    //         createEntity("source-storage", "storager_1", 0, 1, 0, {
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
    //           "storageSlotGroups[0].slots[0].initialCount": 1,
    //         }),
    //         createEntity("belt-source", "belt_straight_1x1", 0, 0, 270),
    //         // AI-CORRECTION 2026-05-18: 分流器端口默认方向变更，rot 90 → 180 保持等效朝向。
    //         createEntity("splitter", "log_splitter", 0, -1, 180),
    //         createEntity("belt-blocked", "belt_straight_1x1", 0, -2, 270),
    //         createEntity("blocked-storage", "storager_1", 0, -5, 0, blockedConfig),
    //         createEntity("belt-open", "belt_straight_1x1", 1, -1, 0),
    //         createEntity("open-storage", "storager_1", 2, -1, 90),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/debug-fanout/scene-01-blocked-fanout-64edc15f.schema6.json"),
      registry: createRegistryContract(),
      maxTickNumber: 150,
    });

    console.log("Diagnostics:", JSON.stringify(report.topology.diagnostics));
    console.log("Topology ID:", report.topology.topologyId);

    for (const tick of report.ticks) {
      if (tick.transfers.length > 0) {
        console.log(`Tick ${tick.tickNumber} transfers (${tick.transfers.length}):`);
        for (const t of tick.transfers) {
          console.log(`  ${t.sourceSlotId} -> ${t.targetSlotId} [${t.itemType}]`);
        }
      }
    }

    // Check device inventory changes
    console.log("\nDevice inventory changes:");
    for (const change of report.summary.deviceInventoryChanges) {
      console.log(`  ${change.deviceId}:`);
      for (const sc of change.slotChanges) {
        if (sc.initialItemType || sc.finalItemType) {
          console.log(`    ${sc.storageGroupId}/${sc.slotId}: ${sc.initialItemType}(${sc.initialCount}) -> ${sc.finalItemType}(${sc.finalCount})`);
        }
      }
    }
  });
});
