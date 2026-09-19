import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/contracts/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   createWarehouseSlotLink,
//   findSlot,
//   getDevice,
// } from "./blueprint-test-helpers";
import { findSlot, getDevice } from "./blueprint-test-helpers";

describe("dark pipe warehouse ingress", () => {
  it("submits fluid from an unlinked single-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("single-dark-pipe-inlet-warehouse", [
    //         createEntity("source", "udpipe_unloader_1", 0, 0, 180, {
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
    //           "storageSlotGroups[0].slots[0].initialCount": 1,
    //         }),
    //         createEntity("pipe", "pipe_straight_1x1", 3, 1),
    //         createEntity("inlet", "udpipe_loader_1", 4, 0, 180),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-01-single-dark-pipe-inlet-warehouse-e12525bf.schema6.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("submits fluid from an unlinked multi-port dark pipe inlet to the single-base warehouse", async () => {
    const finalTick = STANDARD_TICK_RATE_PER_SECOND;
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("multi-dark-pipe-inlet-warehouse", [
    //         createEntity("source", "udpipe_unloader_1", 0, 0, 180, {
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
    //           "storageSlotGroups[0].slots[0].initialCount": 1,
    //         }),
    //         createEntity("pipe", "pipe_straight_1x1", 3, 1),
    //         createEntity("inlet", "udpipe_loader_2", 4, 0, 180),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-02-multi-dark-pipe-inlet-warehouse-60217eb6.schema6.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, finalTick, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1")).toMatchObject({
      itemType: null,
      count: 0,
    });
    expect(listWarehouseIngressTransfers(report)).toEqual([
      expect.objectContaining({ itemType: "item_liquid_water", amount: 1 }),
    ]);
  });

  it("keeps dark pipe outlets empty by default when no warehouse item is selected", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("dark-pipe-outlet-default-empty", [
    //         createEntity("single-outlet", "udpipe_unloader_1", 0, 0, 180),
    //         createEntity("multi-outlet", "udpipe_unloader_2", 4, 0),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-03-dark-pipe-outlet-default-empty-faa7ebc1.schema6.json"),
      maxTickNumber: STANDARD_TICK_RATE_PER_SECOND,
      registry: createRegistryContract(),
    });

    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "single-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
    expect(findSlot(report, STANDARD_TICK_RATE_PER_SECOND, "multi-outlet", "unloader_buffer", "slot_1"))
      .toMatchObject({ itemType: null, count: 0 });
  });

  it("moves linked inlet fluid into the outlet through the transport channels", async () => {
    const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint(
    //         "linked-dark-pipe-inlet-manual-void",
    //         [
    //           createEntity("inlet", "udpipe_loader_1", 0, 0, 180, {
    //             "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
    //             "storageSlotGroups[0].slots[0].initialCount": 4,
    //           }),
    //           createEntity("outlet", "udpipe_unloader_1", 6, 0, 180),
    //         ],
    //         [
    //           createDarkPipeSlotLink({
    //             inletEntityId: "inlet",
    //             outletEntityId: "outlet",
    //           }),
    //         ],
    //       )
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-04-linked-dark-pipe-inlet-manual-void-cc6d9123.schema6.json"),
      maxTickNumber: finalTick,
      registry: createRegistryContract(),
    });

    expect(getDevice(report, 1, "inlet").channelRecipes).toEqual({});
    expect(findSlot(report, finalTick, "inlet", "loader_buffer", "slot_1").count).toBe(0);
    expect(findSlot(report, finalTick, "outlet", "unloader_buffer", "slot_1").count).toBe(4);
    expect(listWarehouseIngressTransfers(report)).toEqual([]);
  });

  it.each(SIMULATION_ENGINE_MATRIX)(
    "outputs liquid through a linked outlet when the inlet is chained to warehouse stock [%s]",
    async (engineKind) => {
      const finalTick = (3 * STANDARD_TICK_RATE_PER_SECOND) + 5;
      // AI-REMOVED 2026-09-14:
      // Reason: 场景构造已批量固化为带版本的蓝图文件。
      // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
      // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
      // Replacement: src/tests/fixtures/blueprints/simulation/dark-pipe-void/index.json
      // Risk: Low；断言与被测动作不变。
      // Human Review: Required
      // Original code:
      // createBlueprint(
      //           "linked-dark-pipe-inlet-warehouse-source",
      //           [
      //             createEntity("inlet", "udpipe_loader_1", -6, 0, 180, {
      //               "storageSlotGroups[0].slots[0].lock": "item_liquid_sewage",
      //               "storageSlotGroups[0].slots[0].ignoreStock": true,
      //             }),
      //             createEntity("outlet", "udpipe_unloader_1", 0, 0, 180),
      //             createEntity("pipe", "pipe_straight_1x1", 3, 1),
      //             createEntity("sink", "udpipe_loader_1", 4, 0, 180),
      //           ],
      //           [
      //             createWarehouseSlotLink("inlet", "item_liquid_sewage", "loader_buffer", "slot_1"),
      //             createDarkPipeSlotLink({
      //               inletEntityId: "inlet",
      //               outletEntityId: "outlet",
      //             }),
      //           ],
      //         )
      const report = await runBlueprintSimulation({
        blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dark-pipe-void/scene-05-linked-dark-pipe-inlet-warehouse-source-853d73d7.schema6.json"),
        maxTickNumber: finalTick,
        engineKind,
        registry: createRegistryContract(),
      });

      expect(findSlot(report, finalTick, "sink", "loader_buffer", "slot_1")).toMatchObject({
        itemType: null,
        count: 0,
      });
      expect(listWarehouseIngressTransfers(report).some((transfer) =>
        transfer.itemType === "item_liquid_sewage",
      )).toBe(true);
    },
  );
});

function listWarehouseIngressTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
) {
  return report.ticks.flatMap((tick) => tick.transfers).filter((transfer) =>
    transfer.targetSlotId.includes("/node:warehouse/slot:"),
  );
}
