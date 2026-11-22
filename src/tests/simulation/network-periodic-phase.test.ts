import { describe, expect, it } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { createNetworkRegistryContract } from "@/registry";
import { CONSUMPTION_CHANNEL_IDS, CONSUMPTION_SLOT_ID, CONSUMPTION_STORAGE_GROUP_ID } from "@/shared/consumption-channel";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID } from "@/shared/registry/recipe-channel-eligibility";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { periodicEnvironmentTickAtTime, periodicEnvironmentTimeUnits } from "@/simulation/environment";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { compileSimulationTopology } from "@/simulation/topology";

const uuid = "1821a9ab-a9bf-410c-8658-9185067533bb";
const phaseUuid = "d322d166-0bc6-45c2-bd88-34d2c06bc0ab";
const phaseId = `custom:recipe:${phaseUuid}`;
const alternateFuelId = "custom:item:9ce41a15-4371-477e-9042-69fd538a2dae";
const alternateFuelUuid = alternateFuelId.slice("custom:item:".length);
const fuelItemId = "item_copper_ore";
const transformedItemId = "item_copper_nugget";
const conversionSourceId = "device:conversion";
const fuelPatch = {
  entityId: "conversion",
  storageGroupId: CONSUMPTION_STORAGE_GROUP_ID,
  slotId: CONSUMPTION_SLOT_ID,
  itemType: fuelItemId,
  count: 1,
  ignoreStock: false,
};

function createFixture(standardTickRate: number, periodSeconds: number, twoSources = false) {
  const definitions = createNetworkRegistryContract({
    formatVersion: 1,
    items: [{ uuid: alternateFuelUuid, name: "虚构燃料", phase: "solid" }],
    recipes: [],
    entities: [{
      uuid,
      name: "虚构转换设备",
      footprint: { width: 1, height: 1 },
      powerDemand: 0,
      portGroups: [{
        id: "fuel",
        kind: ItemDomainFlag.Solid,
        isPipe: false,
        direction: "input",
        ports: [{
          id: "fuel_port",
          localCellX: 0,
          localCellY: 0,
          edge: "NORTH",
          acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Solid }, exclude: [] },
          priorityGroup: 1,
          roundRobinSeed: 0,
        }],
      }],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
      ranges: [{
        id: "adjacent",
        localRect: { x: 3, y: 0, width: 1, height: 1 },
        coverage: "contains",
        visualId: "power",
        placementRule: { groupId: "demo", overlap: "disjoint-or-equal", allowedSegments: ["belt", "pipe"] },
      }],
      allowDuplicateRecipesAcrossChannels: false,
      consumption: { itemIds: [fuelItemId, alternateFuelId], portGroupIds: ["fuel"] },
      periodicRangeConversion: {
        programId: "fixture",
        rangeIds: ["adjacent"],
        phases: [
          { uuid: phaseUuid, name: "明", side: 0 },
          { uuid: "b45aa398-c979-459a-bc9f-4fd366e5472a", name: "晦", side: 1 },
        ],
      },
    }],
    periodicRangeConversionPrograms: [{
      id: "fixture",
      periodSeconds,
      effects: [
        { probabilityByLayer: [1], outputItemByInputId: { [fuelItemId]: transformedItemId } },
        { probabilityByLayer: [0], outputItemByInputId: {} },
        { probabilityByLayer: [0], outputItemByInputId: {} },
      ],
    }],
  });
  const document = createWorldDocument();
  document.entities = {
    conversion: {
      id: "conversion",
      definitionId: `custom:entity:${uuid}:1x1`,
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
    belt: {
      id: "belt",
      definitionId: "belt_straight_1x1",
      position: { x: 3, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
  };
  document.entityOrder = ["conversion", "belt"];
  if (twoSources) {
    document.entities.second = {
      ...document.entities.conversion!,
      id: "second",
      position: { x: 6, y: 0 },
      rotation: 180,
    };
    document.entityOrder.push("second");
  }
  const topology = (selectPhase: boolean) => {
    const config = selectPhase ? { channelRecipes: { [CUSTOM_PERIODIC_PHASE_CHANNEL_ID]: phaseId } } : {};
    document.entities.conversion!.config = config;
    if (document.entities.second !== undefined) document.entities.second.config = config;
    return compileSimulationTopology({
      document, registry: definitions, standardTickRate, simulationMode: "single-base",
      poweredEntityIds: new Set(document.entityOrder),
    });
  };
  return { definitions, topology };
}

describe("网络手选相位的燃料授权", () => {
  it("Dense 在消耗周期中途选择相位，耗尽时暂停作用区，替代燃料可恢复计时", () => {
    const rate = 4;
    const fixture = createFixture(rate, 10);
    const topology = fixture.topology(false);
    const beforeChoice = new DenseSimulationKernel(topology, compileDenseTopologyLayout(topology, fixture.definitions), fixture.definitions);
    beforeChoice.patchRuntimeSlot(fuelPatch);
    beforeChoice.advanceToTick(2 * rate + 1);
    const idx = beforeChoice.layout.dictionary.deviceIds.indexOf(conversionSourceId);
    const initialRecipes = beforeChoice.createDeviceSnapshot(idx).channelRecipes;
    expect(initialRecipes[CONSUMPTION_CHANNEL_IDS[0]]?.isProgressing).toBe(true);
    expect(initialRecipes[CUSTOM_PERIODIC_PHASE_CHANNEL_ID]?.isProgressing).toBeUndefined();

    const selected = fixture.topology(true);
    const kernel = new DenseSimulationKernel(selected, compileDenseTopologyLayout(selected, fixture.definitions), fixture.definitions);
    kernel.restoreMigratedRuntime(beforeChoice, []);
    const readRegion = () => kernel.createCheckpoint().periodicEnvironment!.regions[0]!;
    kernel.advanceToTick(3 * rate + 1);
    expect(readRegion().active).toBe(true);
    kernel.advanceToTick(11 * rate + 1);
    const paused = readRegion();
    const sourceIndex = kernel.layout.dictionary.deviceIds.indexOf(conversionSourceId);
    const depletedRecipes = kernel.createDeviceSnapshot(sourceIndex).channelRecipes;
    expect(depletedRecipes[CONSUMPTION_CHANNEL_IDS[0]]?.isProgressing).toBeUndefined();
    expect(depletedRecipes[CUSTOM_PERIODIC_PHASE_CHANNEL_ID]?.isProgressing).toBe(false);
    expect(paused.active).toBe(false);
    expect(paused.remainingMs).toBeGreaterThan(0);
    expect(paused.remainingMs).toBeLessThan(paused.periodMs);
    kernel.advanceToTick(18 * rate + 1);
    expect(readRegion()).toEqual(paused);

    kernel.patchRuntimeSlot({ ...fuelPatch, itemType: alternateFuelId });
    for (let step = 0; step < rate && !readRegion().active; step++) {
      kernel.advanceToTick(kernel.tickNumber + 1);
    }
    const resumed = readRegion();
    expect(resumed.active).toBe(true);
    expect(resumed.remainingMs).toBe(paused.remainingMs);
    const dueTime = periodicEnvironmentTimeUnits(kernel.tickNumber, rate) + resumed.remainingMs;
    kernel.advanceToTick(periodicEnvironmentTickAtTime(dueTime, rate));
    expect(readRegion().remainingMs).toBe(resumed.periodMs);
  });

  it("合并两个网络来源时从最后一层读取概率，并在续燃边界完成当期结算", () => {
    const rate = 4;
    const fixture = createFixture(rate, 10, true);
    const topology = fixture.topology(true);
    const kernel = new DenseSimulationKernel(topology, compileDenseTopologyLayout(topology, fixture.definitions), fixture.definitions);
    kernel.patchRuntimeSlot({ ...fuelPatch, count: 2 });
    kernel.patchRuntimeSlot({ ...fuelPatch, entityId: "second", count: 2 });
    kernel.advanceToTick(10 * rate + 1);
    const checkpoint = kernel.createCheckpoint().periodicEnvironment!;
    expect(checkpoint.regions).toHaveLength(1);
    expect(checkpoint.regions[0]).toMatchObject({ active: true, remainingMs: 30_000 });
    expect(checkpoint.sources).toHaveLength(2);
  });

  it("Legacy 在相同的真实配置迁移后暂停未完成相位，替代燃料可恢复计时", () => {
    const rate = 20;
    const fixture = createFixture(rate, 10);
    const runtime = new SimulationWorkerRuntime(fixture.definitions);
    const readRegion = () => runtime.exportRuntimeState()!.runtimeState.persistent.periodicEnvironment!.regions[0]!;
    try {
      runtime.initializeIsolated(fixture.topology(false), "infinite", [fuelPatch]);
      runtime.advanceToTick(2 * rate + 1);
      const beforeChoice = runtime.exportRuntimeState(2 * rate + 1)!.snapshot.devices[conversionSourceId]!.channelRecipes;
      expect(beforeChoice[CONSUMPTION_CHANNEL_IDS[0]]?.isProgressing).toBe(true);
      expect(beforeChoice[CUSTOM_PERIODIC_PHASE_CHANNEL_ID]?.isProgressing).toBeUndefined();
      expect(runtime.handleRequest({
        type: "load-topology", requestId: 1, topology: fixture.topology(true),
        migration: { baseTickNumber: 2 * rate + 1, resetDeviceIds: [] },
      })).toMatchObject({ type: "topology-loaded", result: { status: "started" } });
      runtime.advanceToTick(3 * rate + 1);
      expect(readRegion().active).toBe(true);
      runtime.advanceToTick(11 * rate + 1);
      const paused = readRegion();
      const depletedRecipes = runtime.exportRuntimeState(11 * rate + 1)!.snapshot.devices[conversionSourceId]!.channelRecipes;
      expect(depletedRecipes[CONSUMPTION_CHANNEL_IDS[0]]?.isProgressing).toBeUndefined();
      expect(depletedRecipes[CUSTOM_PERIODIC_PHASE_CHANNEL_ID]?.isProgressing).toBe(false);
      expect(paused.active).toBe(false);
      expect(paused.remainingMs).toBeGreaterThan(0);
      expect(paused.remainingMs).toBeLessThan(paused.periodMs);
      runtime.advanceToTick(18 * rate + 1);
      expect(readRegion()).toEqual(paused);

      runtime.patchIsolatedSlot({ ...fuelPatch, itemType: alternateFuelId });
      runtime.advanceToTick(19 * rate + 1);
      const resumed = readRegion();
      expect(resumed.active).toBe(true);
      expect(resumed.remainingMs).toBe(paused.remainingMs);
      runtime.advanceToTick(23 * rate + 1);
      expect(readRegion().remainingMs).toBe(resumed.periodMs);
    } finally {
      runtime.disposeIsolated();
    }
  });
});
