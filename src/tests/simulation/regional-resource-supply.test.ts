import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import type { RegionalResourceSupplySetting } from "@/simulation/types";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  createWarehouseSlotLink,
  createWorldDocumentFromBlueprint,
  getFirstTickAtSimulationMilliseconds,
  getTick,
} from "./blueprint-test-helpers";
import { runRegionalBlueprintSimulation } from "./regional-blueprint-runner";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// AI-REMOVED 2026-09-08:
// Reason: 多基地资源供给不再分别直连 Legacy/Dense 区域端口与 Session。
// Trigger: 用户确认该行为应从公共区域 Runner 外部观察并纳入矩阵。
// Evidence: 9500ms/10000ms 的仓库数量与统计足以验证提交边界，无需断言引擎 gateTickNumber。
// Replacement: runRegionalBlueprintSimulation + SIMULATION_ENGINE_MATRIX。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { DenseLocalRegionalBasePort } from "@/simulation/dense";
// import { aggregateRegionalWarehouseStats } from "@/simulation/regional";
// import {
//   LocalRegionalBasePort,
//   RegionalSimulationSession,
//   type RegionalBaseTopologyInput,
// } from "@/simulation/regional/session";
// import { DENSE_STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
// import type { RuntimeTickSnapshot } from "@/simulation/types";

const FINITE_SOURCE_ORE: readonly RegionalResourceSupplySetting[] = [{
  itemId: "item_originium_ore",
  mode: "rate",
  perMinute: 540,
}];

describe("地区资源供给", () => {
  describe.each(SIMULATION_ENGINE_MATRIX)("单基地运行行为 [%s]", (engineKind) => {
    it("每 10000ms 提交有限资源，并为固定及可配置无限资源投影独立状态", async () => {
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint("regional-resource-single", []),
        maxDurationSeconds: 10.5,
        registry: createRegistryContract(),
        engineKind,
        regionalResources: [
          ...FINITE_SOURCE_ORE,
          { itemId: "item_iron_ore", mode: "infinite", perMinute: 10 },
        ],
      });
      const beforeBoundary = getFirstTickAtSimulationMilliseconds(report, 9_500);
      const boundary = getFirstTickAtSimulationMilliseconds(report, 10_000);

      const initialStats = getTick(report, 0).warehouseStats;
      expect(initialStats?.items["item_iron_ore"]).toMatchObject({
        infinite: true,
        warehouseCount: 0,
        producedPerMinute: 0,
      });
      expect(initialStats?.items["item_liquid_water"]?.infinite).toBe(true);
      expect(initialStats?.items["item_liquid_acid"]?.infinite).toBe(true);
      expect(beforeBoundary.warehouseStats?.items["item_originium_ore"]).toBeUndefined();
      expect(boundary.warehouseStats?.items["item_originium_ore"]).toMatchObject({
        infinite: false,
        warehouseCount: 90,
      });

      // AI-REMOVED 2026-09-08:
      // Reason: 单基地资源提交边界绑定 Legacy tick 200/201。
      // Trigger: 地区资源供给接入求解器矩阵并统一使用毫秒语义。
      // Evidence: 两种引擎共同契约是 9500ms 尚未提交、10000ms 第一 tick 完成提交。
      // Replacement: beforeBoundary 与 boundary。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // maxTickNumber: 201,
      // expect(getTick(report, 200).warehouseStats?.items["item_originium_ore"]).toBeUndefined();
      // expect(getTick(report, 201).warehouseStats?.items["item_originium_ore"]).toMatchObject({
      //   infinite: false,
      //   warehouseCount: 90,
      // });
    });
  });

  it("有限地区 Profile 覆盖设备文档中的旧自然资源 ignoreStock", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint(
      "regional-resource-policy-precedence",
      [
        createEntity("unloader", "unloader_1", 51, 34, 270, {
          "storageSlotGroups[0].slots[0].ignoreStock": true,
        }),
        createEntity("belt", "belt_straight_1x1", 52, 35),
      ],
      [createWarehouseSlotLink("unloader", "item_originium_ore")],
    ));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "regional-multi-base",
      poweredEntityIds: new Set(),
      activeActivityIds: [],
      regionalResources: FINITE_SOURCE_ORE,
    });
    const admission = buildRegionalWarehouseOutletTable({
      registry,
      topologies: [{ baseId: document.baseId, regionBaseOrderIndex: 0, topology }],
    });

    expect(admission.ok).toBe(true);
    expect(Object.values(admission.table!.outletById)).toEqual([
      expect.objectContaining({ itemId: "item_originium_ore", ignoreStock: false }),
    ]);
  });

  describe.each(SIMULATION_ENGINE_MATRIX)("多基地运行行为 [%s]", (engineKind) => {
    it("9500ms 前不注入，并在 10000ms 边界注入有限资源", async () => {
      const report = await runRegionalBlueprintSimulation({
        registry: createRegistryContract(),
        engineKind,
        scenario: {
          name: "regional-resource-supply",
          regionTag: "武陵",
          currentBaseId: "wuling_protocol_core",
          untilSeconds: 10,
          timeoutMs: 30_000,
          captureMilliseconds: [9_500],
          regionalResources: [{
            itemId: "item_originium_ore",
            mode: "rate",
            perMinute: 60,
          }],
        },
      });
      const beforeBoundary = report.captures[0]!;
      const boundary = report.captures[1]!;

      expect(report.captures).toHaveLength(2);
      expect(report.baseIds.length).toBeGreaterThan(1);
      expect(beforeBoundary.warehouseCounts["item_originium_ore"]).toBeUndefined();
      expect(boundary.warehouseCounts["item_originium_ore"]).toBe(10);
      expect(boundary.warehouseStats?.items["item_originium_ore"]).toMatchObject({
        producedPerMinute: 60,
        warehouseCount: 10,
        infinite: false,
      });
      expect(boundary.warehouseStats?.items["item_liquid_water"]?.infinite).toBe(true);
    });
  });

  // AI-REMOVED 2026-09-08:
  // Reason: 旧用例分别直连 Legacy/Dense 区域端口和 Session，并断言内部 gate tick。
  // Trigger: 用户要求改为恢复到公共 Runner 可见的外部行为，并完整纳入求解器矩阵。
  // Evidence: 上方矩阵用例通过 9500ms/10000ms 的区域仓库数量与统计验证同一门禁契约。
  // Replacement: describe.each(SIMULATION_ENGINE_MATRIX) 下的“多基地运行行为”。
  // Risk: Low；不再单独覆盖各引擎端口的内部 tick 对齐字段。
  // Human Review: Required
  //
  // Original code:
  /*
  it("多基地在同一 10 秒区域提交边界注入有限资源", async () => {
    const registry = createRegistryContract();
    const documents = ["regional-a", "regional-b"].map((baseId) => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(baseId, []));
      document.baseId = baseId;
      return document;
    });
    const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
      baseId: document.baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
        regionalResources: [{
          itemId: "item_originium_ore",
          mode: "rate",
          perMinute: 10,
        }],
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const ports = topologies.map((input, index) => new LocalRegionalBasePort({
      registry,
      baseId: input.baseId,
      regionBaseOrderIndex: index,
      topology: input.topology,
      table: admission.table!,
      initialWarehouseCounts: {},
      isCurrentBase: index === 0,
      simulationSpeed: 1,
      fixedDynamicTickRate: index === 0 ? 20 : 2,
      advanceMode: index === 0 ? "per-tick" : "coarse",
    }));
    const session = new RegionalSimulationSession({
      sessionId: "regional-resource-supply",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: topologies[0]!.baseId,
      expectedBaseIds: topologies.map((input) => input.baseId),
      initialWarehouseCounts: {},
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, ports, null);

    try {
      let committed = await session.runEpoch(0);
      for (let epoch = 1; epoch <= 120; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(1201);
      expect(committed.warehouseCounts["item_originium_ore"]).toBe(10);
      const baseSnapshots = Object.values(committed.snapshotsByBaseId)
        .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
      const warehouseStats = aggregateRegionalWarehouseStats({
        baseSnapshots,
        authorityCounts: committed.warehouseCounts,
        supply: topologies[0]!.topology.regionalResourceSupply,
      });
      expect(warehouseStats.items["item_originium_ore"]).toMatchObject({
        producedPerMinute: 10,
        warehouseCount: 10,
        infinite: false,
      });
      expect(warehouseStats.items["item_liquid_water"]?.infinite).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it("Dense 按基地实际门禁 tick 提交进度与有限资源窗口", async () => {
    const registry = createRegistryContract();
    const documents = ["dense-regional-a", "dense-regional-b"].map((baseId) => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(baseId, []));
      document.baseId = baseId;
      return document;
    });
    const topologies: RegionalBaseTopologyInput[] = documents.map((document, index) => ({
      baseId: document.baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
        regionalResources: [{
          itemId: "item_originium_ore",
          mode: "rate",
          perMinute: 60,
        }],
        standardTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);
    const initialWarehouseCounts: Record<string, number> = {};
    const session = new RegionalSimulationSession({
      sessionId: "dense-regional-resource-supply",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: topologies[0]!.baseId,
      expectedBaseIds: topologies.map((input) => input.baseId),
      initialWarehouseCounts,
      simulationSpeed: 1,
      currentBaseDynamicTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
      backgroundDynamicTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
    }, topologies.map((input, index) => new DenseLocalRegionalBasePort({
      registry,
      baseId: input.baseId,
      topology: input.topology,
      table: admission.table!,
      initialWarehouseCounts,
      isCurrentBase: index === 0,
      advanceMode: "coarse",
    })), null);

    try {
      let committed = await session.runEpoch(0);
      expect(committed.gateTickNumber).toBe(1);
      for (let epoch = 1; epoch <= 2; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(3);
      expect(committed.warehouseCounts["item_originium_ore"]).toBeUndefined();

      for (let epoch = 3; epoch <= 20; epoch += 1) {
        committed = await session.runEpoch(epoch);
      }
      expect(committed.gateTickNumber).toBe(21);
      expect(committed.warehouseCounts["item_originium_ore"]).toBe(10);
      for (const snapshot of Object.values(committed.snapshotsByBaseId)) {
        expect(snapshot?.tickNumber).toBe(committed.gateTickNumber);
      }
    } finally {
      session.dispose();
    }
  });
  */
});
