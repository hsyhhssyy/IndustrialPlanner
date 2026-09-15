import { loadBlueprintFromFile } from "../blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalBaseTopologyInput,
} from "@/simulation/legacy/regional-session";
import { createWorldDocumentFromBlueprint } from "../blueprint-test-helpers";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/regional-long-run/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   createWarehouseSlotLink,
// } from "./blueprint-test-helpers";

const TEN_MINUTE_EPOCHS = 1200;

describe("区域会话 10 分钟长跑", () => {
  it("连续 1200 个 Epoch 保持库存非负、版本连续、会话不失败", { timeout: 120_000 }, async () => {
    const registry = createRegistryContract();

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/regional-long-run/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("region-long-consumer", [
    //       createEntity("unloader", "unloader_1", 51, 34, 270),
    //       createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    //     ], [
    //       createWarehouseSlotLink("unloader", "item_copper_ore"),
    //     ])
    const consumerDoc = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-long-run/scene-01-region-long-consumer-2d13761d.schema6.json"));
    consumerDoc.baseId = "base-consumer";

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/regional-long-run/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("region-long-producer", [
    //       createEntity("unloader", "unloader_1", 51, 34, 270, {
    //         "storageSlotGroups[0].slots[0].ignoreStock": true,
    //       }),
    //       createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    //       createEntity("loader", "loader_1", 53, 34, 270),
    //     ], [
    //       createWarehouseSlotLink("unloader", "item_copper_ore"),
    //     ])
    const producerDoc = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/regional-long-run/scene-02-region-long-producer-9372c5d2.schema6.json"));
    producerDoc.baseId = "base-producer";

    const topologies: RegionalBaseTopologyInput[] = [
      {
        baseId: consumerDoc.baseId,
        regionBaseOrderIndex: 0,
        topology: compileSimulationTopology({
          document: consumerDoc, registry, simulationMode: "regional-multi-base", poweredEntityIds: new Set(), activeActivityIds: [],
        }),
      },
      {
        baseId: producerDoc.baseId,
        regionBaseOrderIndex: 1,
        topology: compileSimulationTopology({
          document: producerDoc, registry, simulationMode: "regional-multi-base", poweredEntityIds: new Set(), activeActivityIds: [],
        }),
      },
    ];
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);

    const session = new RegionalSimulationSession({
      sessionId: "long-run",
      registry,
      topologies,
      table: admission.table!,
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
        table: admission.table!,
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
        table: admission.table!,
        initialWarehouseCounts: {},
        isCurrentBase: false,
        simulationSpeed: 1,
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }),
    ], null);

    try {
      for (let epoch = 0; epoch < TEN_MINUTE_EPOCHS; epoch += 1) {
        const committed = await session.runEpoch(epoch);
        expect(committed.epochNumber).toBe(epoch);
        expect(committed.warehouseVersion).toBe(epoch + 1);
        for (const count of Object.values(committed.warehouseCounts)) {
          expect(count).toBeGreaterThanOrEqual(0);
        }
      }
      // AI-REMOVED 2026-08-21:
      // Reason: 区域会话不再保留完整 Epoch 快照历史。
      // Trigger: 真实四基地持续运行出现无界内存增长。
      // Evidence: 会话顺序现在由 nextEpochNumber 标量维护。
      // Replacement: 断言最终 nextEpochNumber。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // expect(session.committedEpochs).toHaveLength(TEN_MINUTE_EPOCHS);
      expect(session.nextEpochNumber).toBe(TEN_MINUTE_EPOCHS);
    } finally {
      session.dispose();
    }
  });
});
