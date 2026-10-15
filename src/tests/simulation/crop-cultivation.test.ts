import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { compileDeviceStates, DeviceStateRuntime } from "@/simulation/device-state";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { runBlueprintSimulation } from "./blueprint-runner";

function scenario(rate: 2 | 4 = 2, order = "neighbors") {
  const registry = createRegistryContract();
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/crop-cultivation/${order}.schema7.json`));
  const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: rate, poweredEntityIds: new Set(document.entityOrder) });
  expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
  const layout = compileDenseTopologyLayout(topology, registry);
  const kernel = new DenseSimulationKernel(topology, layout, registry);
  const programs = compileDeviceStates(topology, registry);
  const index = (id: string) => layout.dictionary.deviceIds.findIndex(device => topology.devices[device]!.sourceEntityId === id);
  const snapshot = (id: string) => kernel.createDeviceSnapshot(index(id));
  const at = (seconds: number) => kernel.advanceToTick(seconds * rate + 1);
  // 准备生长观察起点；育种 30 秒、相接 30 秒及收获全过程都由真实 kernel 推进。
  const prepare = (deadline: number) => {
    const checkpoint = kernel.createCheckpoint();
    programs.forEach((program, machine) => {
      checkpoint.deviceStates.indexes[machine] = program.states.findIndex(state => state.id === "growing-1");
      checkpoint.deviceStates.enteredSeconds[machine] = 0;
      checkpoint.deviceStates.timerStartedSeconds[machine] = 0;
      checkpoint.deviceStates.deadlineSeconds[machine] = deadline;
    });
    kernel.restoreCheckpoint({ ...checkpoint, tickNumber: 1 });
    at(0.5);
  };
  const gas = (count: number, ignoreStock: boolean) => {
    const definition = registry.queries.findEntityDefinition("vaporizer_1")!;
    const group = definition.storageSlotGroups[0]!;
    kernel.patchRuntimeSlot({ entityId: "gas", storageGroupId: group.id, slotId: group.slots[0]!.id, itemType: "item_gas_xiranite", count, ignoreStock });
  };
  const warehouse = (itemId: string) => {
    const slot = layout.dictionary.slotIds.findIndex(id => topology.slots[id]!.lock === itemId
      && topology.devices[topology.nodes[topology.slots[id]!.nodeId]!.deviceId]!.definitionId === "warehouse");
    return kernel.state.slotCounts[layout.slotStorageIndexes[slot]!]!;
  };
  return { registry, topology, layout, kernel, programs, index, snapshot, at, prepare, gas, warehouse };
}

describe("分支状态机与真实田块育种", () => {
  it.each([2, 4] as const)("%i TPS：同 tick 育种完成优先，经过零剩余成长立即进入优质成熟", rate => {
    const scene = scenario(rate);
    scene.prepare(30.5);
    scene.at(30.5);
    expect(scene.snapshot("A").deviceState).toMatchObject({ stateId: "harvest-refined", enteredAtSeconds: 30.5 });
    expect(scene.snapshot("A").channelRecipes.growth).toMatchObject({ recipeId: "r_soil_corp_cabbage_1_harvest_refined", progressTicks: 0 });
    expect(scene.snapshot("B").deviceState?.stateId).toBe("harvest");
    scene.at(32.5);
    expect(scene.snapshot("A").deviceState?.stateId).toBe("seedling");
    expect(scene.snapshot("A").cultivation?.neighborProgressSeconds).toBe(0);
  });

  it("同 tick 的迁移轨迹包含育种后成长，事件只能消费一次", () => {
    const scene = scenario();
    const states = new DeviceStateRuntime(scene.programs);
    const checkpoint = states.checkpoint();
    const machine = 0;
    const program = states.programs[machine]!;
    checkpoint.indexes[machine] = program.states.findIndex(state => state.id === "growing-1");
    checkpoint.timerStartedSeconds[machine] = 10;
    checkpoint.enteredSeconds[machine] = 10;
    checkpoint.deadlineSeconds[machine] = 40;
    states.restore(checkpoint);
    const growing = program.states[checkpoint.indexes[machine]!]!;
    states.completed(machine, growing.enterRecipeId!);
    const trace: string[] = [];
    states.process(40, (index, _previous, next) => { if (index === machine) trace.push(program.states[next]!.id); });
    expect(trace).toEqual(["growing-refined", "harvest-refined"]);
    states.process(40, () => { throw new Error("重复迁移"); });
  });

  it("计时已到期的循环迁移明确失败，避免卡死同一 tick", () => {
    const scene = scenario();
    const states = new DeviceStateRuntime([{ ...scene.programs[0]!, initialIndex: 0, states: [{
      id: "cycle", enterRecipeId: null, visualKey: null, durationSeconds: 1,
      transitions: [{ completionRecipeId: null, nextIndex: 0, inheritTimer: true }],
    }] }]);
    states.process(0, () => {});
    expect(() => states.process(1, () => {})).toThrow("Instant state transition cycle");
  });

  it("无气仍按时普通成熟，取消未完成配方后收获不受阻", () => {
    const scene = scenario();
    scene.gas(0, false);
    scene.prepare(10);
    scene.at(10);
    expect(scene.snapshot("A").deviceState?.stateId).toBe("harvest");
    expect(scene.snapshot("A").channelRecipes.growth?.recipeId).toBe("r_soil_corp_cabbage_1_harvest");
    scene.at(12);
    expect(scene.warehouse("item_corp_cabbage_1")).toBe(120);
    expect(scene.warehouse("item_corp_cabbage_2")).toBe(0);
  });

  it("生长先到期时取消正在育种的配方，不留下延迟完成事件", () => {
    const scene = scenario();
    scene.prepare(10);
    scene.at(5);
    expect(scene.snapshot("A").channelRecipes.growth?.recipeId).toBe("r_soil_corp_cabbage_1_refinement");
    scene.at(10);
    expect(scene.snapshot("A").channelRecipes.growth).toMatchObject({ recipeId: "r_soil_corp_cabbage_1_harvest", progressTicks: 0 });
    scene.at(12);
    expect(scene.warehouse("item_corp_cabbage_2")).toBe(0);
    scene.at(31);
    expect(scene.snapshot("A").deviceState?.stateId).toBe("watering-1");
    expect(scene.warehouse("item_corp_cabbage_2")).toBe(0);
  });

  it("断气保留育种进度，恢复后继承计时，完成后断气不退化", () => {
    const scene = scenario();
    scene.gas(5, false);
    scene.prepare(100);
    scene.at(20);
    const before = scene.snapshot("A").channelRecipes.growth!.progressTicks;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(60);
    scene.at(25);
    expect(scene.snapshot("A").channelRecipes.growth!.progressTicks).toBe(before);
    scene.gas(5, true);
    scene.at(55);
    expect(scene.snapshot("A").deviceState).toMatchObject({ stateId: "growing-refined", timerStartedAtSeconds: 0, endsAtSeconds: 100 });
    scene.gas(0, false);
    scene.at(75);
    expect(scene.snapshot("A").deviceState?.stateId).toBe("growing-refined");
    expect(scene.snapshot("A").channelRecipes.growth ?? null).toBeNull();
  });

  it.each(["neighbors", "reversed"])("%s：气外普通邻田增产，角接、异种和普通田传递不计；同时成熟产量一致", order => {
    const scene = scenario(2, order);
    scene.prepare(100);
    scene.at(61);
    expect(scene.snapshot("A").cultivation).toMatchObject({ adjacentPlotCount: 1, effectiveNeighborCount: 1, neighborProgressSeconds: 30, yieldBonusRatio: 0.2 });
    expect(scene.snapshot("B").cultivation).toMatchObject({ adjacentPlotCount: 2, effectiveNeighborCount: 1, neighborProgressSeconds: 30, yieldBonusRatio: 0.2 });
    expect(scene.snapshot("B").deviceState?.stateId).toBe("growing-1");
    expect(scene.snapshot("C").cultivation?.yieldBonusRatio).toBe(0);
    expect(scene.snapshot("D").cultivation?.adjacentPlotCount).toBe(0);
    expect(scene.snapshot("M").cultivation?.adjacentPlotCount).toBe(0);
    scene.at(102);
    expect(scene.warehouse("item_corp_cabbage_1")).toBe(132);
    expect(scene.warehouse("item_corp_cabbage_2")).toBe(66);
    expect(scene.warehouse("item_corp_mushroom_1")).toBe(30);
    expect(scene.warehouse("item_corp_mushroom_2")).toBe(30);
    expect(scene.snapshot("B").cultivation?.yieldBonusRatio).toBe(0);
  });

  it("检查点恢复及 2→4 TPS 迁移保留计时和相接进度，收获只结算一次", () => {
    const scene = scenario();
    scene.prepare(100);
    scene.at(45);
    const checkpoint = scene.kernel.createCheckpoint();
    const before = scene.snapshot("A");
    scene.at(61);
    scene.kernel.restoreCheckpoint(checkpoint);
    expect(scene.snapshot("A").deviceState).toEqual(before.deviceState);
    expect(scene.snapshot("A").cultivation).toEqual(before.cultivation);
    const faster = scenario(4);
    faster.kernel.restoreMigratedRuntime(scene.kernel, []);
    expect(faster.snapshot("A").deviceState).toEqual(before.deviceState);
    expect(faster.snapshot("A").cultivation).toEqual(before.cultivation);
    faster.at(102);
    expect(faster.warehouse("item_corp_cabbage_2")).toBe(66);
    faster.at(103);
    expect(faster.warehouse("item_corp_cabbage_2")).toBe(66);
  });

  it("邻田提前成熟时暂停相接进度，邻田新一轮进入成长后继续累计", () => {
    const scene = scenario();
    scene.prepare(100);
    const checkpoint = scene.kernel.createCheckpoint();
    const neighbor = scene.programs.findIndex(program => scene.topology.devices[program.deviceId]!.sourceEntityId === "B");
    checkpoint.deviceStates.deadlineSeconds[neighbor] = 50;
    scene.kernel.restoreCheckpoint(checkpoint);
    scene.at(50);
    expect(scene.snapshot("B").deviceState?.stateId).toBe("harvest");
    const progress = scene.snapshot("A").cultivation!.neighborProgressSeconds;
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(30);
    scene.at(65);
    expect(scene.snapshot("A").cultivation).toMatchObject({ neighborProgressSeconds: progress, effectiveNeighborCount: 0, yieldBonusRatio: 0 });
    scene.at(85);
    expect(scene.snapshot("B").deviceState?.stateId).toBe("growing-1");
    expect(scene.snapshot("A").cultivation!.neighborProgressSeconds).toBeGreaterThan(progress);
    scene.at(95);
    expect(scene.snapshot("A").cultivation).toMatchObject({ neighborProgressSeconds: 30, effectiveNeighborCount: 1, yieldBonusRatio: 0.2 });
  });

  it("Legacy 真主机也能育种并为气外普通邻田积累增产", async () => {
    const report = await runBlueprintSimulation({ registry: createRegistryContract(), engineKind: "legacy", maxDurationSeconds: 95,
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/crop-cultivation/neighbors.schema7.json") });
    const last = report.ticks.at(-1)!;
    const devices = Object.values(last.devices);
    expect(devices.some(device => device.deviceState?.stateId === "growing-refined")).toBe(true);
    // 仓库前的运行快照检查由 Dense 用例覆盖；Legacy 此处验证真实主机状态迁移及环境暂停链路。
    // AI-CORRECTION 2026-10-15: 蓝图报告已传递 cultivation，追加真实主机增产断言。
    expect(devices.some(device => device.deviceState?.stateId === "growing-1")).toBe(true);
    expect(devices.some(device => device.deviceState?.stateId === "growing-1" && device.cultivation?.yieldBonusRatio === 0.2)).toBe(true);
  });
});
