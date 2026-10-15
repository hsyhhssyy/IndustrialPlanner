import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { compileDeviceStates } from "@/simulation/device-state";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

describe("缘缘庄与旧田块的真实收获入仓", () => {
  it("2 TPS：从生长末尾推进，提交四种旧作物30产量、新副产物与优质双产物，并开始下一轮", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dense-irrigation/yuanyuan-harvest.schema7.json"));
    const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: 2, poweredEntityIds: new Set() });
    expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
    const layout = compileDenseTopologyLayout(topology, registry);
    const kernel = new DenseSimulationKernel(topology, layout, registry);
    const checkpoint = kernel.createCheckpoint();
    const statePrograms = compileDeviceStates(topology, registry);
    const plotIndexes: number[] = [];
    for (let index = 0; index < layout.dictionary.deviceIds.length; index++) {
      const device = topology.devices[layout.dictionary.deviceIds[index]!]!;
      const definition = registry.queries.findEntityDefinition(device.definitionId);
      if (definition?.stateMachine === undefined) continue;
      plotIndexes.push(index);
      // 只准备观察起点；原始生长时长由Registry测试核对，最后2秒及收获由真实引擎完成。
      const stateIndex = definition.stateMachine.states.findLastIndex(state => state.transition?.kind === "elapsed");
      const stateDeviceIndex = statePrograms.findIndex(program => program.deviceId === device.id);
      expect(stateDeviceIndex).toBeGreaterThanOrEqual(0);
      checkpoint.deviceStates.indexes[stateDeviceIndex] = stateIndex;
      checkpoint.deviceStates.enteredSeconds[stateDeviceIndex] = 0;
      checkpoint.deviceStates.deadlineSeconds[stateDeviceIndex] = 2;
    }
    expect(plotIndexes).toHaveLength(6);
    kernel.restoreCheckpoint({ ...checkpoint, tickNumber: 1 });
    kernel.advanceToTick(2 * 2 + 1);
    for (const index of plotIndexes) expect(kernel.createDeviceSnapshot(index).deviceState?.stateId).toBe("harvest");
    kernel.advanceToTick(4 * 2 + 1);
    const expected = {
      item_plant_sp_1: 30, item_plant_sp_2: 30, item_plant_sp_3: 30, item_plant_sp_4: 30,
      item_corp_bean_1: 30, item_byproduct_bean_1: 3,
      item_corp_cabbage_1: 30, item_corp_cabbage_2: 30,
    };
    for (const [itemId, amount] of Object.entries(expected)) {
      const slotIndex = layout.dictionary.slotIds.findIndex(id => {
        const slot = topology.slots[id]!;
        return slot.lock === itemId && topology.devices[topology.nodes[slot.nodeId]!.deviceId]!.definitionId === "warehouse";
      });
      expect(slotIndex, itemId).toBeGreaterThanOrEqual(0);
      expect(kernel.state.slotCounts[layout.slotStorageIndexes[slotIndex]!], itemId).toBe(amount);
    }
    for (const index of plotIndexes) expect(kernel.createDeviceSnapshot(index).deviceState).toMatchObject({ stateId: "seedling", enteredAtSeconds: 4 });
  });
});
