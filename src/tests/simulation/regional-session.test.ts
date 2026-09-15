import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import { LocalRegionalBasePort, RegionalSimulationSession } from "@/simulation/legacy/regional-session";
import type { RegionalBaseTopologyInput } from "@/simulation/legacy/regional-session";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/regional-session/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   createWarehouseSlotLink,
// } from "./blueprint-test-helpers";

describe("区域会话端到端", () => {
  it("后台基地 WarehouseSink 入仓后，下一 Epoch 可被另一基地取用", async () => {
    const registry = createRegistryContract();

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/regional-session/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("region-consumer", [
    //       createEntity("unloader", "unloader_1", 51, 34, 270),
    //       createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    //     ], [
    //       createWarehouseSlotLink("unloader", "item_copper_ore"),
    //     ])
    const consumerDoc = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-session/scene-01-region-consumer-f2aaaac3.schema6.json"));
    consumerDoc.baseId = "base-consumer";

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/regional-session/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("region-producer", [
    //       createEntity("unloader", "unloader_1", 51, 34, 270, {
    //         "storageSlotGroups[0].slots[0].ignoreStock": true,
    //       }),
    //       createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    //       createEntity("loader", "loader_1", 53, 34, 270),
    //     ], [
    //       createWarehouseSlotLink("unloader", "item_copper_ore"),
    //     ])
    const producerDoc = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-session/scene-02-region-producer-fa4031d0.schema6.json"));
    producerDoc.baseId = "base-producer";

    const topologies: RegionalBaseTopologyInput[] = [
      {
        baseId: consumerDoc.baseId,
        regionBaseOrderIndex: 0,
        topology: compileSimulationTopology({
          document: consumerDoc,
          registry,
          simulationMode: "regional-multi-base",
          poweredEntityIds: new Set(),
          activeActivityIds: [],
        }),
      },
      {
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: compileSimulationTopology({
          document: producerDoc,
          registry,
          simulationMode: "regional-multi-base",
          poweredEntityIds: new Set(),
          activeActivityIds: [],
        }),
      },
    ];
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const table = admission.table!;

    const session = new RegionalSimulationSession({
      sessionId: "test-session",
      registry,
      topologies,
      table,
      currentBaseId: consumerDoc.baseId,
      expectedBaseIds: ["base-consumer", "base-producer"],
      initialWarehouseCounts: {},
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, [
      new LocalRegionalBasePort({
        registry,
        baseId: consumerDoc.baseId,
        regionBaseOrderIndex: 0,
        topology: topologies[0]!.topology,
        table,
        initialWarehouseCounts: {},
        isCurrentBase: true,
        simulationSpeed: 1,
        fixedDynamicTickRate: 20,
        advanceMode: "per-tick",
      }),
      new LocalRegionalBasePort({
        registry,
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: topologies[1]!.topology,
        table,
        initialWarehouseCounts: {},
        isCurrentBase: false,
        simulationSpeed: 1,
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }),
    ], null);

    const epochs = [];
    for (let epoch = 0; epoch <= 12; epoch += 1) {
      epochs.push(await session.runEpoch(epoch));
    }
    const copperByEpoch = epochs.map((epoch) => epoch.warehouseCounts["item_copper_ore"] ?? 0);
    // tick 41 producer 入仓后从下一 Epoch 可见；tick 61 consumer 从区域仓库取走。
    expect(copperByEpoch[4]).toBe(1);
    expect(copperByEpoch[5]).toBe(1);
    expect(copperByEpoch[6]).toBe(0);
    expect(epochs[12]!.snapshotsByBaseId["base-consumer"]).not.toBeNull();

    session.dispose();
  });
});
