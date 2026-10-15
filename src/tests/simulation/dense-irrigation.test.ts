import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

function createScenario(rate: 2 | 4, order: string) {
  const registry = createRegistryContract();
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/dense-irrigation/${order}.schema7.json`));
  const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: rate, poweredEntityIds: new Set(document.entityOrder) });
  expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
  const layout = compileDenseTopologyLayout(topology, registry);
  const kernel = new DenseSimulationKernel(topology, layout, registry);
  const sprinkler = layout.dictionary.deviceIds.findIndex(id => topology.devices[id]!.sourceEntityId === "sprinkler");
  const plot = layout.dictionary.deviceIds.findIndex(id => topology.devices[id]!.sourceEntityId === "plot");
  const slot = layout.dictionary.slotIds.findIndex(id => topology.nodes[topology.slots[id]!.nodeId]!.deviceId === layout.dictionary.deviceIds[sprinkler]);
  const storage = layout.slotStorageIndexes[slot]!;
  return { registry, topology, layout, kernel, sprinkler, plot, storage };
}

/** 只装配观察起点；正式状态时长仍为 1800 秒，最后 3 秒必须由引擎推进。 */
function prepareThreeSecondsBeforeWatering(scene: ReturnType<typeof createScenario>, rate: 2 | 4) {
  const { kernel, registry } = scene;
  const checkpoint = kernel.createCheckpoint();
  const machine = registry.queries.findEntityDefinition("soil_grass_1")!.stateMachine!;
  checkpoint.deviceStates.indexes[0] = machine.states.findIndex(state => state.id === "growing-1");
  checkpoint.deviceStates.enteredSeconds[0] = 3;
  checkpoint.deviceStates.timerStartedSeconds[0] = 3;
  checkpoint.deviceStates.deadlineSeconds[0] = 1803;
  const tick = 1800 * rate + 1;
  kernel.restoreCheckpoint({ ...checkpoint, tickNumber: tick });
  expect(kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "growing-1", enteredAtSeconds: 3, endsAtSeconds: 1803 });
  expect(kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth ?? null).toBeNull();
  return tick;
}

describe("Dense 田块状态转换与洒水耗水边界", () => {
  it.each([2, 4] as const)("%i TPS：还剩 3 秒需水，浇完后再推进 3 秒，恰好耗 30 滴且无第 31 次启动", rate => {
    for (const order of ["sprinkler-first", "plot-first"] as const) {
      const scene = createScenario(rate, order);
      const { kernel, plot, sprinkler, storage } = scene;
      const start = prepareThreeSecondsBeforeWatering(scene, rate);
      const at = (seconds: number) => kernel.advanceToTick(start + seconds * rate);
      at(2);
      expect(kernel.createDeviceSnapshot(plot).deviceState?.stateId).toBe("growing-1");
      expect(kernel.state.slotCounts[storage]).toBe(50);
      expect(kernel.state.slotReserved[storage]).toBe(0);
      at(3);
      expect(kernel.createDeviceSnapshot(plot).deviceState?.stateId).toBe("watering-2");
      expect(kernel.createDeviceSnapshot(plot).channelRecipes.growth?.progressTicks).toBe(0);
      expect(kernel.state.slotCounts[storage]).toBe(49);
      const runs = new Set<string>();
      const first = kernel.createDeviceSnapshot(sprinkler).channelRecipes.irrigation;
      expect(first).not.toBeNull();
      runs.add(first!.runId);
      for (let tick = start + 3 * rate + 1; tick <= start + 36 * rate; tick++) {
        kernel.advanceToTick(tick);
        const recipe = kernel.createDeviceSnapshot(sprinkler).channelRecipes.irrigation;
        if (recipe) runs.add(recipe.runId);
        if (tick === start + 32 * rate) {
          expect(kernel.createDeviceSnapshot(plot).channelRecipes.growth?.progressTicks).toBe(29 * rate);
          expect(kernel.state.slotCounts[storage]).toBe(20);
        }
        if (tick === start + 33 * rate) {
          expect(kernel.createDeviceSnapshot(plot).deviceState).toMatchObject({ stateId: "growing-2", enteredAtSeconds: 1833, visualKey: "mature-irrigated" });
          expect(recipe).toBeNull();
        }
      }
      expect(kernel.state.slotCounts[storage]).toBe(20);
      expect(kernel.state.slotReserved[storage]).toBe(0);
      expect(runs.size).toBe(30);
      expect(kernel.createCheckpoint().warehouseConsumedTotals[scene.layout.dictionary.itemIds.indexOf("item_liquid_water")]).toBe(30);
      expect(kernel.createDeviceSnapshot(sprinkler).channelRecipes.irrigation).toBeNull();
      expect(kernel.createDeviceSnapshot(plot).deviceState).toMatchObject({ stateId: "growing-2", enteredAtSeconds: 1833, endsAtSeconds: 3633 });
    }
  });
});

describe("Dense 灌溉恢复和环境组合", () => {
  it("断水后保持 10 秒进度，补水后只继续剩余 20 秒", () => {
    const scene = createScenario(4, "sprinkler-first");
    const refill = (count: number) => scene.kernel.patchRuntimeSlot({ entityId: "sprinkler", storageGroupId: "liquid", slotId: "liquid", itemType: "item_liquid_water", count, ignoreStock: false });
    refill(10);
    scene.kernel.advanceToTick(12 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth?.progressTicks).toBe(10 * 4);
    scene.kernel.advanceToTick(20 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth?.progressTicks).toBe(10 * 4);
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(0);
    refill(20);
    scene.kernel.advanceToTick(45 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState?.stateId).toBe("growing-1");
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(0);
    expect(scene.kernel.state.slotReserved[scene.storage]).toBe(0);
    expect(scene.kernel.createDeviceSnapshot(scene.sprinkler).channelRecipes.irrigation).toBeNull();
  });

  it("扩散机五个消耗频道只投影一份相同环境范围", () => {
    const scene = createScenario(4, "steam-and-water");
    scene.kernel.advanceToTick(3 * 4 + 1);
    expect(scene.kernel.environments.filter(range => range.itemId === "item_gas_water")).toHaveLength(1);
    expect(scene.kernel.environments.filter(range => range.itemId === "item_liquid_water")).toHaveLength(1);
  });

  it.each(["wrong-liquid", "outside", "no-plot"])("%s：无匹配需求不消耗液体", fixture => {
    const { kernel, storage, sprinkler } = createScenario(4, fixture);
    kernel.advanceToTick(40 * 4 + 1);
    expect(kernel.state.slotCounts[storage]).toBe(50);
    expect(kernel.state.slotReserved[storage]).toBe(0);
    if (fixture === "no-plot") {
      expect(kernel.createCheckpoint().deviceStates.indexes.length).toBe(0);
      expect(kernel.createDeviceSnapshot(sprinkler).block).toBe(false);
    }
  });

  it("一台洒水机同时浇两块田，仍只消耗 30 滴", () => {
    const scene = createScenario(4, "two-plots");
    scene.kernel.advanceToTick(35 * 4 + 1);
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(20);
    for (let index = 0; index < scene.layout.dictionary.deviceIds.length; index++) {
      if (scene.topology.devices[scene.layout.dictionary.deviceIds[index]!]!.definitionId === "soil_grass_1") {
        expect(scene.kernel.createDeviceSnapshot(index).deviceState).toMatchObject({ stateId: "growing-1", enteredAtSeconds: 32 });
      }
    }
  });

  it.each(["two-sprinklers", "steam-and-water"])("%s：多来源不加速，洒水机各自运行 30 秒", fixture => {
    const scene = createScenario(4, fixture);
    scene.kernel.advanceToTick(31 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth?.progressTicks).toBe(29 * 4);
    scene.kernel.advanceToTick(35 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "growing-1", enteredAtSeconds: 32 });
    for (let index = 0; index < scene.layout.dictionary.slotIds.length; index++) {
      const node = scene.topology.nodes[scene.topology.slots[scene.layout.dictionary.slotIds[index]!]!.nodeId]!;
      if (scene.topology.devices[node.deviceId]!.definitionId === "squirter_1") expect(scene.kernel.state.slotCounts[scene.layout.slotStorageIndexes[index]!]).toBe(20);
    }
  });

  it("水蒸气独立完成浇水，田块进入生长后气体仍继续消耗", () => {
    const scene = createScenario(4, "steam-only");
    scene.kernel.advanceToTick(32 * 4 + 1);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "growing-1", enteredAtSeconds: 32 });
    // AI-REMOVED 2026-10-14:
    // Reason: 原夹具仅有 5 单位气体，不足以支持 5 个消耗频道连续运行 30 秒。
    // Trigger: 用户确认改为持续供气，并保留现有气体消耗机制。
    // Evidence: 5 个频道各预占 1 单位，每 10 秒结算一轮；有限库存在第一轮耗尽。
    // Replacement: steam-only fixture-v2 与下方实际消耗统计断言。
    // Risk: Low - 每个频道的耗料规则不变。
    // Human Review: Required
    // Original code:
    // const gasSlot = scene.layout.dictionary.slotIds.findIndex(id => scene.topology.slots[id]!.initialItemType === "item_gas_water");
    // const storage = scene.layout.slotStorageIndexes[gasSlot]!;
    // expect(scene.kernel.state.slotCounts[storage]).toBe(2);
    // scene.kernel.advanceToTick(43 * 4 + 1);
    // expect(scene.kernel.state.slotCounts[storage]).toBe(1);
    // expect(scene.kernel.state.slotReserved[storage]).toBe(1);
    const gasItemIndex = scene.layout.dictionary.itemIds.indexOf("item_gas_water");
    expect(scene.kernel.createCheckpoint().warehouseConsumedTotals[gasItemIndex]).toBe(15);
    scene.kernel.advanceToTick(43 * 4 + 1);
    expect(scene.kernel.createCheckpoint().warehouseConsumedTotals[gasItemIndex]).toBe(20);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "growing-1", enteredAtSeconds: 32 });
    expect(scene.kernel.environments.filter(range => range.itemId === "item_gas_water")).toHaveLength(1);
  });

  it("断电 5 秒后恢复，保留浇水进度和已付费的供水配方", () => {
    const scene = createScenario(4, "sprinkler-first");
    const start = prepareThreeSecondsBeforeWatering(scene, 4);
    scene.kernel.advanceToTick(start + 10 * 4);
    const progress = scene.kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth!.progressTicks;
    const water = scene.kernel.state.slotCounts[scene.storage];
    scene.kernel.setPowerConsumptionOverride(1e12);
    scene.kernel.setPowerMode("real");
    scene.kernel.advanceToTick(start + 15 * 4);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).channelRecipes.growth!.progressTicks).toBe(progress);
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(water);
    scene.kernel.setPowerMode("infinite");
    scene.kernel.advanceToTick(start + 41 * 4);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "growing-2", enteredAtSeconds: 1838 });
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(20);
  });

  it("检查点恢复并从 4 TPS 切到 2 TPS 后，耗水和状态到期时间保持一致", () => {
    const scene = createScenario(4, "sprinkler-first");
    const start = prepareThreeSecondsBeforeWatering(scene, 4);
    scene.kernel.advanceToTick(start + 13 * 4);
    const restored = new DenseSimulationKernel(scene.topology, scene.layout, scene.registry);
    restored.restoreCheckpoint(scene.kernel.createCheckpoint());
    restored.switchStandardTickRate(2);
    restored.advanceToTick(1836 * 2 + 1);
    scene.kernel.advanceToTick(1836 * 4 + 1);
    expect(restored.createDeviceSnapshot(scene.plot).deviceState).toEqual(scene.kernel.createDeviceSnapshot(scene.plot).deviceState);
    expect(restored.state.slotCounts[scene.storage]).toBe(20);
    expect(restored.state.slotReserved[scene.storage]).toBe(0);
  });

  it("育苗 2 秒、浇水 30 秒、生长 300 秒、收获 2 秒后入仓并自动育苗", () => {
    const scene = createScenario(2, "harvest");
    const at = (second: number) => scene.kernel.advanceToTick(second * 2 + 1);
    at(0);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState?.stateId).toBe("seedling");
    at(2);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState?.stateId).toBe("watering-1");
    at(32);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState?.visualKey).toBe("irrigated");
    at(332);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState?.stateId).toBe("harvest");
    expect(scene.kernel.state.slotCounts[scene.storage]).toBe(20);
    at(334);
    expect(scene.kernel.createDeviceSnapshot(scene.plot).deviceState).toMatchObject({ stateId: "seedling", enteredAtSeconds: 334 });
    const warehouseSlot = scene.layout.dictionary.slotIds.findIndex(id => {
      const slot = scene.topology.slots[id]!;
      return slot.lock === "item_plant_moss_3" && scene.topology.devices[scene.topology.nodes[slot.nodeId]!.deviceId]!.definitionId === "warehouse";
    });
    expect(warehouseSlot).toBeGreaterThanOrEqual(0);
    expect(scene.kernel.state.slotCounts[scene.layout.slotStorageIndexes[warehouseSlot]!]).toBe(10);
  });
});
