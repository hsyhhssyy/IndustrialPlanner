import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "@/simulation/regional/warehouse-arbiter";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseAuthorityState,
  RegionWarehouseDemandBatch,
} from "@/simulation/regional";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  createBlueprint,
  // AI-REMOVED 2026-08-19:
  // Reason: createDarkPipeSlotLink 由 shared/dark-pipe-link 导出，不属于 blueprint-test-helpers。
  // Trigger: 新增区域暗管直连回归测试时发现导入来源错误。
  // Evidence: blueprint-test-helpers.ts 未导出该函数。
  // Replacement: 文件顶部 @/shared/dark-pipe-link 导入。
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // createDarkPipeSlotLink,
  createEntity,
  createWarehouseSlotLink,
} from "./blueprint-test-helpers";

describe("区域基地 Runtime 门禁", () => {
  it.each(["udpipe_loader_1", "udpipe_loader_2"] as const)(
    "区域模式下未链接的 %s 将流体写入区域仓库 journal",
    (inletDefinitionId) => {
      const registry = createRegistryContract();
      const document = createWorldDocumentFromBlueprint(createBlueprint(
        `regional-unlinked-${inletDefinitionId}`,
        [
          createEntity("source", "udpipe_unloader_1", 0, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
            "storageSlotGroups[0].slots[0].initialCount": 1,
          }),
          createEntity("pipe", "pipe_straight_1x1", 3, 1),
          createEntity("inlet", inletDefinitionId, 4, 0),
        ],
      ));
      const topology = compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
      });
      const singleBaseTopology = compileSimulationTopology({
        document,
        registry,
        simulationMode: "single-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
      });
      const inletDevice = topology.devices["device:inlet"];
      expect(topology.topologyId).not.toBe(singleBaseTopology.topologyId);
      expect(singleBaseTopology.devices["device:inlet"]?.simulationBehaviors).toEqual([
        expect.objectContaining({
          strategy: "warehouse-sink-when-unlinked",
          storageSlotGroupIds: ["loader_buffer"],
        }),
      ]);
      expect(inletDevice?.simulationBehaviors).toEqual([
        expect.objectContaining({
          strategy: "warehouse-sink-when-unlinked",
          storageSlotGroupIds: ["loader_buffer"],
        }),
      ]);

      const admission = buildRegionalWarehouseOutletTable({
        registry,
        topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
      });
      expect(admission.ok).toBe(true);
      const runtime = new SimulationWorkerRuntime(registry);
      expect(runtime.loadRegionalTopology({
        topology,
        baseId: document.baseId,
        table: admission.table!,
        initialWarehouseCounts: {},
        fixedDynamicTickRate: 2,
        advanceMode: "coarse",
      }).status).toBe("started");

      runtime.prepareRegionalEpochDemand(0);
      expect(runtime.applyRegionalEpochGrant({
        epochNumber: 0,
        grantedOutletIds: [],
      }).deposits).toEqual([]);
      runtime.finalizeRegionalEpoch({
        epochNumber: 0,
        nextWarehouseCounts: {},
        includeSnapshot: false,
      });

      runtime.prepareRegionalEpochDemand(1);
      expect(runtime.applyRegionalEpochGrant({
        epochNumber: 1,
        grantedOutletIds: [],
      }).deposits).toEqual([{ itemId: "item_liquid_water", amount: 1 }]);
    },
  );

  it("区域模式下已直连的暗管入口保持本地 share-all，不重复写入仓库", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint(
      "regional-linked-dark-pipe",
      [
        createEntity("source", "udpipe_unloader_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        }),
        createEntity("pipe", "pipe_straight_1x1", 3, 1),
        createEntity("inlet", "udpipe_loader_1", 4, 0),
        createEntity("linked-outlet", "udpipe_unloader_1", 10, 0),
      ],
      [createDarkPipeSlotLink({
        inletEntityId: "inlet",
        outletEntityId: "linked-outlet",
      })],
    ));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);
    const runtime = new SimulationWorkerRuntime(registry);
    expect(runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table: admission.table!,
      initialWarehouseCounts: {},
      fixedDynamicTickRate: 2,
      advanceMode: "coarse",
    }).status).toBe("started");

    runtime.prepareRegionalEpochDemand(0);
    expect(runtime.applyRegionalEpochGrant({
      epochNumber: 0,
      grantedOutletIds: [],
    }).deposits).toEqual([]);
    runtime.finalizeRegionalEpoch({
      epochNumber: 0,
      nextWarehouseCounts: {},
      includeSnapshot: false,
    });

    runtime.prepareRegionalEpochDemand(1);
    expect(runtime.applyRegionalEpochGrant({
      epochNumber: 1,
      grantedOutletIds: [],
    }).deposits).toEqual([]);
  });

  it("Epoch 0 在 tick1 提货，管道/传送带相位错误时不产生 demand", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint("regional-runtime-belt", [
      createEntity("unloader", "unloader_1", 51, 34, 270),
      createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
    ], [
      createWarehouseSlotLink("unloader", "item_copper_ore"),
    ]));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });
    expect(admission.ok).toBe(true);
    const table = admission.table!;

    const runtime = new SimulationWorkerRuntime(registry);
    const start = runtime.loadRegionalTopology({
      topology,
      baseId: document.baseId,
      table,
      initialWarehouseCounts: { item_copper_ore: 1 },
      fixedDynamicTickRate: 2,
      advanceMode: "coarse",
    });
    expect(start.status).toBe("started");

    const epoch0 = runtime.prepareRegionalEpochDemand(0);
    expect(epoch0.tickNumber).toBe(1);
    expect(epoch0.demandedOutletIds).toHaveLength(1);

    const state0: RegionWarehouseAuthorityState = {
      warehouseVersion: 0,
      warehouseCounts: { item_copper_ore: 1 },
      cursorByItemId: { item_copper_ore: 0 },
    };
    const demand0: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 0,
      warehouseVersion: 0,
      baseId: document.baseId,
      demandedOutletIds: [...epoch0.demandedOutletIds],
    };
    const arbitration0 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 0,
      table,
      state: state0,
      demands: [demand0],
    });
    const grant0 = arbitration0.grantsByBaseId[document.baseId]!;
    const applied0 = runtime.applyRegionalEpochGrant({
      epochNumber: 0,
      grantedOutletIds: [...grant0.grantedOutletIds],
    });
    expect(applied0.deposits).toEqual([]);
    const finalized0 = runtime.finalizeRegionalEpoch({
      epochNumber: 0,
      nextWarehouseCounts: arbitration0.provisionalCounts,
      includeSnapshot: true,
    });
    expect(finalized0.snapshot!.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "item_copper_ore", amount: 1 }),
    ]));

    const epoch1 = runtime.prepareRegionalEpochDemand(1);
    expect(epoch1.tickNumber).toBe(11);
    // BeltFamily 相位为 20 tick，tick11 不产生 demand；首段已占用也不会产生 demand。
    expect(epoch1.demandedOutletIds).toEqual([]);
    const state1: RegionWarehouseAuthorityState = {
      warehouseVersion: 1,
      warehouseCounts: arbitration0.provisionalCounts,
      cursorByItemId: arbitration0.provisionalCursorByItemId,
    };
    const demand1: RegionWarehouseDemandBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      demandedOutletIds: [],
    };
    const arbitration1 = arbitrateRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      demands: [demand1],
    });
    const ack1: RegionWarehouseAckBatch = {
      sessionId: "s",
      epochNumber: 1,
      warehouseVersion: 1,
      baseId: document.baseId,
      grantId: arbitration1.grantsByBaseId[document.baseId]!.grantId,
      appliedOutletIds: [],
      deposits: [],
    };
    const proposal1 = commitRegionalWarehouseEpoch({
      sessionId: "s",
      epochNumber: 1,
      table,
      state: state1,
      expectedBaseIds: [document.baseId],
      arbitration: arbitration1,
      acks: [ack1],
    });
    const applied1 = runtime.applyRegionalEpochGrant({
      epochNumber: 1,
      grantedOutletIds: [],
    });
    expect(applied1.deposits).toEqual([]);
    const finalized1 = runtime.finalizeRegionalEpoch({
      epochNumber: 1,
      nextWarehouseCounts: proposal1.warehouseCounts,
      includeSnapshot: true,
    });
    expect(finalized1.snapshot!.tickNumber).toBe(11);
  });
});
