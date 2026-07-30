import { describe, expect, it } from "vitest";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";

import { advanceDevices } from "@/simulation/runtime/stage-1-advance-devices";
import { settleRecipes } from "@/simulation/runtime/stage-5-settle-recipes";
import {
  createRecipeStatsState,
  createSimulationMutableRuntimeState,
  cloneSimulationMutableRuntimeState,
  rollRecipeStatsWindow,
  type RuntimeDeviceRecipeState,
} from "@/simulation/runtime/runtime-state";
import {
  adjustReservedAmounts,
  getReservedAmount,
  resolveDeviceRecipePlans,
} from "@/simulation/runtime/runtime-slot-access";
import { canDeviceTransferAtCurrentPhase } from "@/simulation/runtime/phase-gating";
import {
  isDynamicTickRateCompatibleWithTransferUnits,
} from "@/simulation/tick-rate";
import type {
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
} from "@/simulation/types";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";

describe("REQ-080: dynamic simulation tick rate", () => {
  it("keeps only phase-safe dynamic tick rates for the current belt and pipe transfer units", () => {
    // AI-CORRECTION 2026-07-30: 回滚 — 管道恢复 10 tick 周期，当前 belt 为 20 tick、pipe 为 10 tick。
    // 最严格约束是 pipe 的 10 tick，因此测试使用 [10]。
    const transferUnitTicks = [10];

    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 20, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 10, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 4, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 2, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 5, transferUnitTicks })).toBe(false);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 8, transferUnitTicks })).toBe(false);
  });

  it("gates pipe-family anchors at integer-second phases", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    const pipeAnchor = {
      ...topology.devices["device:maker"]!,
      logisticsKind: LOGISTICS_KIND.pipe,
      transportClass: "anchor" as const,
    };

    state.tickNumber = 1;
    expect(canDeviceTransferAtCurrentPhase(topology, state, pipeAnchor)).toBe(true);
    state.tickNumber = 2;
    expect(canDeviceTransferAtCurrentPhase(topology, state, pipeAnchor)).toBe(false);
    // AI-CORRECTION 2026-07-30: 回滚 — 0.5s 门禁，tick 11 也是合法相位。
    state.tickNumber = 11;
    expect(canDeviceTransferAtCurrentPhase(topology, state, pipeAnchor)).toBe(true);
    state.tickNumber = 21;
    expect(canDeviceTransferAtCurrentPhase(topology, state, pipeAnchor)).toBe(true);
  });

  it("adapts worker dynamic tick rate only through legal switch points", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 4,
    });

    expect(runtime.getStatus().dynamicTickRate).toBe(10);

    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 2,
      tickNumber: 20,
      simulationSpeed: 4,
    });
    runtime.advanceToTick(20);

    expect(runtime.getStatus().dynamicTickRate).toBe(4);

    runtime.handleRequest({
      type: "set-simulation-speed",
      requestId: 3,
      simulationSpeed: 1,
    });
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 4,
      tickNumber: 40,
      simulationSpeed: 1,
    });
    runtime.advanceToTick(40);

    expect(runtime.getStatus().dynamicTickRate).toBe(20);
  });

  it("keeps normal-speed runtime exact when the buffer is exhausted", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 1,
    });

    expect(runtime.getStatus().dynamicTickRate).toBe(20);

    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 2,
      tickNumber: 20,
      simulationSpeed: 1,
    });
    runtime.advanceToTick(20);

    expect(runtime.getStatus().dynamicTickRate).toBe(20);
  });

  it("exposes the current dynamic tick rate through runtime status", () => {
    const runtime = new SimulationWorkerRuntime();
    expect(runtime.getStatus().dynamicTickRate).toBeNull();

    const loaded = runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 4,
    });

    expect(loaded.status.dynamicTickRate).toBe(10);
  });

  it("keeps perf reporting enabled without constructing debugData until detailed reporting is enabled", () => {
    const normalRuntime = new SimulationWorkerRuntime();
    normalRuntime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      perfEnabled: false,
    });
    const normalTick = normalRuntime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 2,
      tickNumber: 0,
    });

    expect(normalTick.type).toBe("tick-snapshot-result");
    if (normalTick.type !== "tick-snapshot-result") {
      throw new Error("Expected a normal tick snapshot response.");
    }
    expect(normalTick.result.currentTick?.debugData).toBeUndefined();

    const debugRuntime = new SimulationWorkerRuntime();
    debugRuntime.handleRequest({
      type: "load-topology",
      requestId: 3,
      topology: createEmptyTopology(),
      perfEnabled: true,
      debugDataEnabled: false,
    });
    debugRuntime.advanceToTick(1);
    const perfReport = debugRuntime.handleRequest({
      type: "get-perf-report",
      requestId: 4,
    });
    expect(perfReport.type).toBe("perf-report");
    if (perfReport.type !== "perf-report") {
      throw new Error("Expected a perf report response.");
    }
    expect(perfReport.report).not.toBeNull();

    const perfOnlyTick = debugRuntime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 5,
      tickNumber: 0,
    });
    expect(perfOnlyTick.type).toBe("tick-snapshot-result");
    if (perfOnlyTick.type !== "tick-snapshot-result") {
      throw new Error("Expected a perf-only tick snapshot response.");
    }
    expect(perfOnlyTick.result.currentTick?.debugData).toBeUndefined();

    const detailedReportEnabled = debugRuntime.handleRequest({
      type: "set-debug-data-enabled",
      requestId: 6,
      debugDataEnabled: true,
    });
    expect(detailedReportEnabled.type).toBe("debug-data-enabled-set");

    const debugTick = debugRuntime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 7,
      tickNumber: 0,
    });

    expect(debugTick.type).toBe("tick-snapshot-result");
    if (debugTick.type !== "tick-snapshot-result") {
      throw new Error("Expected a debug tick snapshot response.");
    }
    const debugData = debugTick.result.currentTick?.debugData;
    expect(typeof debugData).toBe("string");
    expect(JSON.parse(debugData ?? "null")).toMatchObject({
      topology: {
        topologyId: "topology:empty",
        documentHash: "hash:test",
      },
      runtimeState: {
        tickNumber: 0,
        transient: {
          blockedInputNodeIds: [],
          edges: {},
          nodes: {},
          transfers: [],
        },
      },
      snapshot: {
        topologyId: "topology:empty",
        documentHash: "hash:test",
        tickNumber: 0,
      },
      workerRuntime: {
        mode: "running",
        simulationSpeed: 1,
        dynamicTickRate: 20,
        standardStepTicks: 1,
        fixedDynamicTickRate: null,
        powerMode: "infinite",
        perfEnabled: true,
        debugDataEnabled: true,
        maxRetainedTicks: 180,
        cachedTickSnapshotNumbers: [0, 1],
        cachedRuntimeStateTickNumbers: [0, 1],
      },
    });

    debugRuntime.handleRequest({
      type: "set-debug-data-enabled",
      requestId: 8,
      debugDataEnabled: false,
    });
    const debugDisabledTick = debugRuntime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 9,
      tickNumber: 0,
    });
    expect(debugDisabledTick.type).toBe("tick-snapshot-result");
    if (debugDisabledTick.type !== "tick-snapshot-result") {
      throw new Error("Expected a debug-disabled tick snapshot response.");
    }
    expect(debugDisabledTick.result.currentTick).not.toHaveProperty("debugData");
  });

  it("keeps cached runtime checkpoints independent while sharing immutable recipe plans", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.slots["slot:out"] = { itemType: "item_test", count: 3 };
    const recipe = createRunningRecipe(2);
    recipe.reservations = [{
      slotId: "slot:out",
      itemType: "item_test",
      amount: 1,
      ignoreStock: false,
    }];
    recipe.inputItems = [{ itemType: "item_input", amount: 1 }];
    state.persistent.devices["device:maker"]!.channelRecipes.main = recipe;
    state.transient.nodes["node:temporary"] = {
      nodeId: "node:temporary",
      result: "solved-run",
      resolveState: "visited",
      excludedItemTypes: [],
      acceptedInputEdgeIds: [],
      acceptedOutputEdgeIds: [],
    };

    const checkpoint = cloneSimulationMutableRuntimeState(state, false);
    state.persistent.slots["slot:out"]!.count = 9;
    recipe.progressTicks = 4;
    recipe.reservations[0]!.amount = 2;
    recipe.inputItems[0]!.amount = 2;

    const checkpointRecipe = checkpoint.persistent.devices["device:maker"]!
      .channelRecipes.main;

    expect(checkpoint.persistent.slots["slot:out"]?.count).toBe(3);
    expect(checkpointRecipe?.plan).toBe(recipe.plan);
    expect(checkpointRecipe?.progressTicks).toBe(2);
    expect(checkpointRecipe?.reservations).not.toBe(recipe.reservations);
    expect(checkpointRecipe?.reservations[0]?.amount).toBe(1);
    expect(checkpointRecipe?.inputItems).not.toBe(recipe.inputItems);
    expect(checkpointRecipe?.inputItems[0]?.amount).toBe(1);
    expect(checkpoint.transient.nodes).toEqual({});
    expect(checkpoint.transient.edges).toEqual({});
  });

  it("reuses recipe plans within one topology without crossing topology boundaries", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    const device = topology.devices["device:maker"]!;
    const channel = device.recipeChannels[0]!;

    const firstPlan = resolveDeviceRecipePlans({ topology, state, device, channel })[0];
    const secondPlan = resolveDeviceRecipePlans({ topology, state, device, channel })[0];

    const otherTopology = createProductionOverflowTopology(10);
    const otherDevice = otherTopology.devices["device:maker"]!;
    const otherPlan = resolveDeviceRecipePlans({
      topology: otherTopology,
      state: createSimulationMutableRuntimeState(otherTopology),
      device: otherDevice,
      channel: otherDevice.recipeChannels[0]!,
    })[0];

    expect(firstPlan).toBeDefined();
    expect(secondPlan).toBe(firstPlan);
    expect(otherPlan).not.toBe(firstPlan);
  });

  it("orders automatic recipes by output total, input total, then recipe id", () => {
    const topology = createRecipePriorityTopology();
    const state = createSimulationMutableRuntimeState(topology);
    const device = topology.devices["device:maker"]!;
    const channel = device.recipeChannels[0]!;

    expect(resolveDeviceRecipePlans({ topology, state, device, channel })
      .map((plan) => plan.recipeId)).toEqual([
      "recipe:a-input-1",
      "recipe:z-input-1",
      "recipe:input-3",
      "recipe:output-1",
    ]);
  });

  it("normalizes recipe stats by covered simulation ticks when dynamic runtime steps are coarser", () => {
    const stats = createRecipeStatsState(20);

    for (let tickNumber = 2; tickNumber <= 2400; tickNumber += 2) {
      rollRecipeStatsWindow(
        stats,
        {
          produced: tickNumber % 20 === 0 ? { item_test: 1 } : {},
          consumed: tickNumber % 20 === 0 ? { item_input: 1 } : {},
        },
        tickNumber,
        2,
        20,
      );
    }

    expect(stats.coveredStandardTicks).toBe(1200);
    expect(stats.aggregated.item_test?.producedPerMinute).toBe(60);
    expect(stats.aggregated.item_input?.consumedPerMinute).toBe(60);
  });

  it("keeps warehouse production stats stable after worker dynamic tick rate changes", () => {
    const normal = readProductionStatsAtSpeed(1);
    const dynamic = readProductionStatsAtSpeed(4);

    expect(normal.producedPerMinute).toBe(240);
    expect(dynamic.initialDynamicTickRate).toBeLessThan(20);
    expect(dynamic.producedPerMinute).toBe(240);
  });

  it("carries production overflow across successful output writes", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = createRunningRecipe(3);

    const stage1AdvanceResult = advanceDevices(topology, state, 7);
    expect(stage1AdvanceResult.overflowTicksByDeviceChannel["device:maker"]?.main).toBe(5);

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 1,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toBeNull();

    settleRecipes(
      topology,
      state,
      "infinite",
      Infinity,
      topology.totalPowerDemand,
      stage1AdvanceResult,
    );

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 2,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toMatchObject({
      recipeId: "recipe:test",
      progressTicks: 0,
      state: "running",
    });
  });

  it("pins production progress at 100 percent and discards overflow when output is blocked", () => {
    const topology = createProductionOverflowTopology(1);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = createRunningRecipe(3);

    const stage1AdvanceResult = advanceDevices(topology, state, 9);

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 1,
    });
    expect(stage1AdvanceResult.overflowTicksByDeviceChannel["device:maker"]?.main)
      .toBe(7);
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toBeNull();

    settleRecipes(
      topology,
      state,
      "infinite",
      Infinity,
      topology.totalPowerDemand,
      stage1AdvanceResult,
    );

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 1,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toMatchObject({
      recipeId: "recipe:test",
      progressTicks: 5,
      state: "waiting-output",
    });
  });

  // AI-REMOVED 2026-07-23:
  // Reason: Stage1 已成功完成旧配方时必须保存 overflow=7；输出阻塞发生在 Stage5 尝试完成下一配方时。
  // Trigger: 手动全量测试发现该用例错误地把 Stage5 的“阻塞后丢弃溢出”提前断言在 Stage1。
  // Evidence: Stage1 完成后输出槽由 0 变为 1 且 channel=null，说明旧配方成功，overflow 必须交接给 Stage5。
  // Replacement: 先断言 overflow=7 与 channel=null，再调用 settleRecipes 验证下一配方停在 waiting-output。
  // Risk: None
  // Human Review: Required
  //
  // Original code:
  // expect(stage1AdvanceResult.overflowTicksByDeviceChannel["device:maker"]?.main)
  //   .toBeUndefined();
  // expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toMatchObject({
  //   recipeId: "recipe:test",
  //   progressTicks: 5,
  //   state: "waiting-output",
  // });

  it("does not commit partial recipe outputs when local transaction preflight fails", () => {
    const topology = createProductionOverflowTopology(1);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] =
      createRunningRecipe(5, 2);

    advanceDevices(topology, state, 1);

    expect(state.persistent.slots["slot:out"]).toEqual({
      itemType: null,
      count: 0,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"])
      .toMatchObject({
        progressTicks: 5,
        state: "waiting-output",
      });
  });

  it("builds the reservation aggregate once and maintains it incrementally", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    const recipe = createRunningRecipe(0);
    recipe.reservations = [{
      slotId: "slot:out",
      itemType: "item_test",
      amount: 2,
      ignoreStock: false,
    }];
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = recipe;

    expect(getReservedAmount(state, "slot:out")).toBe(2);
    expect(getReservedAmount(state, "slot:out")).toBe(2);
    adjustReservedAmounts(state, recipe.reservations, -1);
    expect(getReservedAmount(state, "slot:out")).toBe(0);
    adjustReservedAmounts(state, recipe.reservations, 1);
    expect(getReservedAmount(state, "slot:out")).toBe(2);
  });

  it("reports indexed hot-path and local recipe transaction timings", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createProductionOverflowTopology(10),
      perfEnabled: true,
      simulationSpeed: 1,
    });

    for (let tickNumber = 1; tickNumber <= 7; tickNumber += 1) {
      runtime.advanceToTick(tickNumber);
    }

    const response = runtime.handleRequest({
      type: "get-perf-report",
      requestId: 2,
    });
    expect(response.type).toBe("perf-report");
    if (response.type !== "perf-report") {
      return;
    }

    const hotPaths = response.report?.entries.flatMap((entry) =>
      entry.hotPath === undefined ? [] : [entry.hotPath],
    ) ?? [];
    expect(hotPaths.length).toBeGreaterThan(0);
    expect(hotPaths.reduce((sum, details) => sum + details.recipeFinishCalls, 0))
      .toBeGreaterThan(0);
    expect(hotPaths.reduce((sum, details) => sum + details.recipeFinishChangedSlots, 0))
      .toBeGreaterThan(0);
    expect(hotPaths.every((details) => details.edgeIndexFallbackScans === 0)).toBe(true);

  });
});

// AI-REMOVED 2026-07-23:
// Reason: 旧动态步长测试仍假设管道相位单位为 10 tick，旧溢出测试也假设 Stage1 会直接链式启动下一配方。
// Trigger: 管道改为 1 秒周期，且所有新配方统一延后到 Stage5 启动。
// Evidence: 新测试先断言 Stage1 返回 overflow=5 且 channel=null，再调用 Stage5 验证第二轮完成。
// Replacement: transferUnitTicks=[20] 与 carries production overflow 测试中的 Stage1/Stage5 分段断言。
// Risk: Low
// Human Review: Required
//
// Original code:
// const transferUnitTicks = [20, 10];
// advanceDevices(topology, state, 7);
// expect(state.persistent.slots["slot:out"]).toMatchObject({
//   itemType: "item_test",
//   count: 2,
// });

function readProductionStatsAtSpeed(
  simulationSpeed: number,
): { readonly initialDynamicTickRate: number; readonly producedPerMinute: number } {
  const runtime = new SimulationWorkerRuntime();
  const loaded = runtime.handleRequest({
    type: "load-topology",
    requestId: 1,
    topology: createProductionOverflowTopology(10000),
    simulationSpeed,
  });
  runtime.advanceToTick(2400);

  const response = runtime.handleRequest({
    type: "get-tick-snapshot",
    requestId: 2,
    tickNumber: 2400,
    simulationSpeed,
  });
  if (response.type !== "tick-snapshot-result" || response.result.status.status !== "ready" || response.result.currentTick === null) {
    throw new Error("Expected production stats tick to be ready.");
  }

  return {
    initialDynamicTickRate: loaded.status.dynamicTickRate ?? 0,
    producedPerMinute: response.result.currentTick.warehouseStats?.items.item_test?.producedPerMinute ?? 0,
  };
}

function createEmptyTopology(): CompiledSimulationTopology {
  return {
    schemaVersion: 4,
    topologyId: "topology:empty",
    documentKey: "document:test",
    documentHash: "hash:test",
    registryHash: "registry:test",
    standardTickRate: 20,
    totalPowerDemand: 0,
    itemCatalog: {},
    recipeCatalog: {},
    devices: {},
    nodes: {},
    slots: {},
    ports: {},
    links: {},
    physicalConnections: {},
    transferEdges: {},
    ordering: {
      deviceOrder: [],
      nodeOrder: [],
      slotOrder: [],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder: [],
    },
    transportComponents: {},
    diagnostics: [],
  };
}

function createProductionOverflowTopology(
  outputCapacity: number,
): CompiledSimulationTopology {
  return {
    ...createEmptyTopology(),
    topologyId: `topology:production-overflow:${outputCapacity}`,
    itemCatalog: {
      item_test: {
        id: "item_test",
        domain: ItemDomainFlag.Solid,
        tags: [],
      },
    },
    recipeCatalog: {
      "recipe:test": {
        id: "recipe:test",
        nameKey: "recipe.test",
        durationTicks: 5,
        inputs: [],
        outputs: [{ itemId: "item_test", amount: 1 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
        tags: [],
      },
    },
    devices: {
      "device:maker": {
        id: "device:maker",
        sourceEntityId: "maker",
        definitionId: "test_machine",
        position: null,
        rotation: null,
        footprint: null,
        tags: [],
        powerStatus: "in-power-range",
        powerDemand: 1,
      requiresPower: true,
      logisticsKind: null,
        transportClass: "anchor",
        transportComponentId: null,
        nodeIds: ["node:out"],
        recipeChannels: [{
          id: "main",
          type: "normal-channel",
          ingredientNodeIds: [],
          productNodeIds: ["node:out"],
          manualRecipeOnly: false,
          defaultRecipeId: null,
        }],
        portIds: [],
        routing: {},
        configHash: "config:test",        isProducer: true,      },
    },
    nodes: {
      "node:out": {
        id: "node:out",
        deviceId: "device:maker",
        sourceStorageSlotGroupId: "output",
        viewRole: "input-view",
        slotIds: ["slot:out"],
        inputPortIds: [],
        outputPortIds: [],
        groupOrder: 0,
      },
    },
    slots: {
      "slot:out": {
        id: "slot:out",
        nodeId: "node:out",
        sourceStorageSlotGroupId: "output",
        sourceSlotId: "slot_1",
        capacity: outputCapacity,
        domain: ItemDomainFlag.Solid,
        lock: null,
        initialItemType: null,
        initialCount: 0,
        ignoreStock: false,
      },
    },
    ordering: {
      deviceOrder: ["device:maker"],
      nodeOrder: ["node:out"],
      slotOrder: ["slot:out"],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder: [],
    },
  };
}

function createRecipePriorityTopology(): CompiledSimulationTopology {
  const topology = createProductionOverflowTopology(10);
  const maker = topology.devices["device:maker"]!;
  const outputNode = topology.nodes["node:out"]!;
  const outputSlot = topology.slots["slot:out"]!;

  return {
    ...topology,
    topologyId: "topology:recipe-priority",
    itemCatalog: {
      ...topology.itemCatalog,
      item_input: {
        id: "item_input",
        domain: ItemDomainFlag.Solid,
        tags: [],
      },
    },
    recipeCatalog: {
      "recipe:a-input-1": {
        id: "recipe:a-input-1",
        nameKey: "recipe.a-input-1",
        durationTicks: 5,
        inputs: [{ itemId: "item_input", amount: 1 }],
        outputs: [{ itemId: "item_test", amount: 2 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
        tags: [],
      },
      "recipe:z-input-1": {
        id: "recipe:z-input-1",
        nameKey: "recipe.z-input-1",
        durationTicks: 5,
        inputs: [{ itemId: "item_input", amount: 1 }],
        outputs: [{ itemId: "item_test", amount: 2 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
        tags: [],
      },
      "recipe:input-3": {
        id: "recipe:input-3",
        nameKey: "recipe.input-3",
        durationTicks: 5,
        inputs: [{ itemId: "item_input", amount: 3 }],
        outputs: [{ itemId: "item_test", amount: 2 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
        tags: [],
      },
      "recipe:output-1": {
        id: "recipe:output-1",
        nameKey: "recipe.output-1",
        durationTicks: 5,
        inputs: [],
        outputs: [{ itemId: "item_test", amount: 1 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
        tags: [],
      },
    },
    devices: {
      "device:maker": {
        ...maker,
        nodeIds: ["node:in", "node:out"],
        recipeChannels: [{
          ...maker.recipeChannels[0]!,
          ingredientNodeIds: ["node:in"],
          productNodeIds: ["node:out"],
        }],
      },
    },
    nodes: {
      "node:in": {
        id: "node:in",
        deviceId: "device:maker",
        sourceStorageSlotGroupId: "input",
        viewRole: "input-view",
        slotIds: ["slot:in"],
        inputPortIds: [],
        outputPortIds: [],
        groupOrder: 0,
      },
      "node:out": {
        ...outputNode,
        groupOrder: 1,
      },
    },
    slots: {
      "slot:in": {
        id: "slot:in",
        nodeId: "node:in",
        sourceStorageSlotGroupId: "input",
        sourceSlotId: "slot_1",
        capacity: 10,
        domain: ItemDomainFlag.Solid,
        lock: null,
        initialItemType: "item_input",
        initialCount: 10,
        ignoreStock: false,
      },
      "slot:out": outputSlot,
    },
    ordering: {
      ...topology.ordering,
      nodeOrder: ["node:in", "node:out"],
      slotOrder: ["slot:in", "slot:out"],
    },
  };
}

function createRunningRecipe(
  progressTicks: number,
  outputAmount = 1,
): RuntimeDeviceRecipeState {
  const plan: CompiledSimulationRecipePlan = {
    recipeId: "recipe:test",
    recipeType: "immediate-consume",
    durationTicks: 5,
    inputs: [],
    outputs: [{ itemId: "item_test", amount: outputAmount }],
    ingredientNodeIds: [],
    productNodeIds: ["node:out"],
    requiredGasDiffusion: null,
    gasDiffusionOutput: null,
  };

  return {
    runId: "recipe-run:seed",
    recipeId: "recipe:test",
    recipeType: "immediate-consume" as const,
    progressTicks,
    durationTicks: 5,
    state: "running" as const,
    plan,
    reservations: [],
    inputItems: [],
  };
}
