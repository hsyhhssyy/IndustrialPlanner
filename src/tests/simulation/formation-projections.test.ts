import { describe, expect, it } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { collectPeriodicRangeRegions, resolvePeriodicRangeLayoutAggregate } from "@/shared/periodic-range-conversion";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import { CONSUMPTION_CHANNEL_IDS, CONSUMPTION_SLOT_ID, CONSUMPTION_STORAGE_GROUP_ID } from "@/shared/consumption-channel";
import { resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { compileSimulationTopology } from "@/simulation/topology";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { compilePeriodicEnvironment } from "@/simulation/environment";

const registry = createRegistryContract();
const ming = "r_bipolar_magic_spawner_ming";
const hui = "r_bipolar_magic_spawner_hui";

function layout(ports: Record<string, string>, rotation: 0 | 90 = 0) {
  const doc = createWorldDocument();
  doc.entities.forge = { id: "forge", definitionId: "magic_spawner_2", position: { x: 10, y: 10 },
    rotation, tags: [], config: { channelRecipes: ports } };
  doc.entityOrder = ["forge"];
  return doc;
}

describe("内置分影明晦炉", () => {
  it.each([[ming, ming], [ming, hui], [hui, ming], [hui, hui]])("按局部投影保留 %s / %s，旋转只改变几何", (east, south) => {
    for (const rotation of [0, 90] as const) {
      const doc = layout({ east, south }, rotation);
      const regions = collectPeriodicRangeRegions({ document: doc, registry, activeActivityIds: [] });
      expect(regions).toHaveLength(2);
      expect(regions.map(region => [region.sources[0]!.channelId, resolvePeriodicRangeLayoutAggregate(region).effect])).toEqual([
        ["east", east === ming ? "ming" : "hui"], ["south", south === ming ? "ming" : "hui"],
      ]);
      expect(regions[0]!.gridRect).not.toEqual(regions[1]!.gridRect);
    }
  });

  it.each([ming, hui])("旧蓝图与存档复制单选 %s，两次读取保留独立修改", phase => {
    const doc = layout({ custom_periodic_phase: phase, other: "existing" }, 90);
    const world = normalizeWorldDocument(doc)!;
    const blueprint = normalizeBlueprintDocument(createBlueprintDocument({ name: "旧布局", baseId: doc.baseId,
      initialGridPoint: { x: 0, y: 0 }, entities: doc.entities, entityOrder: doc.entityOrder, slotLinks: [] }))!;
    for (const result of [world, blueprint]) {
      expect(result.entities.forge!.config.channelRecipes).toEqual({ east: phase, south: phase, other: "existing" });
    }
    world.entities.forge!.config.channelRecipes = { east: hui, south: ming, other: "existing" };
    expect(normalizeWorldDocument(world)!.entities.forge!.config.channelRecipes).toEqual(world.entities.forge!.config.channelRecipes);
    expect(normalizeBlueprintDocument(blueprint)!.entities.forge!.config).toEqual(blueprint.entities.forge!.config);
    const ordinary = { custom_periodic_phase: "custom:recipe:ordinary" };
    expect(normalizeWorldDocument(layout(ordinary))!.entities.forge!.config.channelRecipes).toEqual(ordinary);
    expect(normalizeWorldDocument(layout({}))!.entities.forge!.config.channelRecipes).toEqual({});
    expect(normalizeWorldDocument(layout({ custom_periodic_phase: ming, south: hui }))!.entities.forge!.config.channelRecipes)
      .toEqual({ east: ming, south: hui });
  });

  it.each(["dense", "legacy"])("%s 两口同相且只运行一个气耗通道", engine => {
    const doc = layout({ east: ming, south: ming });
    const rate = engine === "dense" ? 4 : 20;
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base",
      standardTickRate: rate, poweredEntityIds: new Set(doc.entityOrder) });
    const patch = { entityId: "forge", storageGroupId: CONSUMPTION_STORAGE_GROUP_ID, slotId: CONSUMPTION_SLOT_ID,
      itemType: "item_gas_xiranite", count: 2, ignoreStock: false };
    if (engine === "dense") {
      const kernel = new DenseSimulationKernel(topology, compileDenseTopologyLayout(topology, registry), registry);
      kernel.patchRuntimeSlot(patch);
      kernel.advanceToTick(1 + rate * 6);
      expect(kernel.periodicRegionSnapshots.map(region => [region.effect, region.layers, region.progressTimeUnits]))
        .toEqual([["ming", 1, 18000], ["ming", 1, 18000]]);
      const index = kernel.layout.dictionary.deviceIds.indexOf("device:forge");
      expect(kernel.createDeviceSnapshot(index).channelRecipes).toMatchObject({
        east: { recipeId: ming }, south: { recipeId: ming }, [CONSUMPTION_CHANNEL_IDS[0]]: { isProgressing: true },
      });
    } else {
      const runtime = new SimulationWorkerRuntime(registry);
      try {
        runtime.initializeIsolated(topology, "infinite", [patch]);
        runtime.advanceToTick(1 + rate * 6);
        const state = runtime.exportRuntimeState(1 + rate * 6)!;
        expect(state.snapshot.devices["device:forge"]!.channelRecipes).toMatchObject({
          east: { recipeId: ming }, south: { recipeId: ming }, [CONSUMPTION_CHANNEL_IDS[0]]: { isProgressing: true },
        });
        expect(state.snapshot.periodicRegions).toHaveLength(2);
      } finally { runtime.disposeIsolated(); }
    }
    expect(topology.devices["device:forge"]!.recipeChannels.filter(ch => ch.type === "consumption-channel")).toHaveLength(1);
  });

  it("两个各有一格传送带的独立区域分别向上取整，同格管道不增加名额", () => {
    const doc = layout({ east: ming, south: hui });
    const rects = collectPeriodicRangeRegions({ document: doc, registry, activeActivityIds: [] });
    for (const [i, { gridRect }] of rects.entries()) {
      for (const [j, definitionId] of ["belt_straight_1x1", "pipe_straight_1x1"].entries()) {
        const id = "segment-" + i + "-" + j;
        doc.entities[id] = { id, definitionId, rotation: 0, position: { x: gridRect.x, y: gridRect.y }, tags: [], config: {} };
        doc.entityOrder.push(id);
      }
    }
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base", standardTickRate: 4,
      poweredEntityIds: new Set(doc.entityOrder) });
    const compiled = compilePeriodicEnvironment(topology, registry, id => id)!;
    const hits: string[] = [];
    const runtime = compiled.createRuntime({ next() { throw Error("单格应全选"); } }, slot => { hits.push(slot); return true; },
      source => () => source.channelId === "east" ? "ming" : "hui");
    runtime.settle(30_000);
    expect(hits).toHaveLength(2);
    expect(hits.every(slot => slot.startsWith("device:segment-") && slot.includes("-0/node:"))).toBe(true);
    expect(new Set(hits.map(slot => slot.split("/")[0])).size).toBe(2);
  });

  it("真实一层阵列覆盖 25 个满载带格，两套引擎连续十跳每跳在相同的 5 格转化", () => {
    const doc = layout({ east: ming, south: hui });
    const east = collectPeriodicRangeRegions({ document: doc, registry, activeActivityIds: [] })
      .find(region => region.sources[0]?.channelId === "east")!.gridRect;
    const raw = "item_xiranite_powder";
    const product = "item_xiranite_ming";
    const belts = Array.from({ length: 25 }, (_, index) => "belt-" + index);
    for (const [index, id] of belts.entries()) {
      doc.entities[id] = { id, definitionId: "belt_straight_1x1", position: { x: east.x + index % 5, y: east.y + Math.floor(index / 5) },
        rotation: index % 2 === 0 ? 0 : 90, tags: [], config: { "storageSlotGroups[0].slots[0].initialItemType": raw, "storageSlotGroups[0].slots[0].initialCount": 1 } };
      doc.entityOrder.push(id);
    }
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base", standardTickRate: 4,
      poweredEntityIds: new Set(doc.entityOrder) });
    const denseLayout = compileDenseTopologyLayout(topology, registry);
    const dense = new DenseSimulationKernel(topology, denseLayout, registry);
    const legacy = new SimulationWorkerRuntime(registry);
    const gas = { entityId: "forge", storageGroupId: CONSUMPTION_STORAGE_GROUP_ID, slotId: CONSUMPTION_SLOT_ID,
      itemType: "item_gas_xiranite", count: 1, ignoreStock: true };
    const cells = belts.map(id => topology.devices["device:" + id]!.nodeIds.flatMap(node => topology.nodes[node]!.slotIds));
    const indexes = new Map(cells.flat().map(slot => [slot, denseLayout.slotStorageIndexes[denseLayout.dictionary.slotIds.indexOf(slot)]!]));
    const productIndex = denseLayout.dictionary.itemIds.indexOf(product);
    const inputIndex = denseLayout.dictionary.itemIds.indexOf(raw);
    try {
      dense.patchRuntimeSlot(gas);
      legacy.initializeIsolated(topology, "infinite", [gas]);
      for (let cycle = 1; cycle <= 10; cycle++) {
        const tick = 1 + cycle * 10 * topology.standardTickRate;
        dense.advanceToTick(tick - 1);
        expect(cells.filter(views => views.some(slot => {
          const stock = dense.state.readSlot(indexes.get(slot)!);
          return stock.count === 1 && stock.itemIndex === inputIndex;
        }))).toHaveLength(25);
        dense.advanceToTick(tick);
        legacy.advanceToTick(tick);
        const frame = legacy.exportRuntimeState(tick)!.snapshot;
        const denseHits = cells.map(views => views.find(slot => {
          const stock = dense.state.readSlot(indexes.get(slot)!);
          return stock.count === 1 && stock.itemIndex === productIndex;
        }));
        const legacyHits = cells.map(views => views.find(slot => frame.slots[slot]?.count === 1 && frame.slots[slot]?.itemType === product));
        expect(denseHits.filter(Boolean)).toHaveLength(5);
        expect(legacyHits).toEqual(denseHits);
        for (const [i, slot] of denseHits.entries()) {
          if (!slot) continue;
          const view = topology.slots[slot]!;
          const patch = { entityId: belts[i]!, storageGroupId: view.sourceStorageSlotGroupId!, slotId: view.sourceSlotId!, itemType: raw, count: 1, ignoreStock: false };
          dense.patchRuntimeSlot(patch);
          legacy.patchIsolatedSlot(patch);
        }
      }
    } finally { legacy.disposeIsolated(); }
  });

  it("真实四层明阵在十秒时将混带上的两种原料各转化一次，分影炉南口保持一层晦", () => {
    const doc = createWorldDocument();
    const rotations = [0, 90, 180, 270] as const;
    for (const [index, rotation] of rotations.entries()) {
      const definitionId = index === 0 ? "magic_spawner_2" : "magic_spawner_1";
      const def = registry.queries.findEntityDefinition(definitionId)!;
      const offset = resolveLocalRangeGridRect({ x: 0, y: 0 }, def.footprint, rotation, def.ranges!.find(r => r.id === "east")!.localRect);
      const id = "forge" + index;
      doc.entities[id] = { id, definitionId, rotation, position: { x: 20 - offset.x, y: 20 - offset.y }, tags: [],
        config: { channelRecipes: index === 0 ? { east: ming, south: hui } : { east: "r_magic_spawner_ming" } } };
      doc.entityOrder.push(id);
    }
    const raw = ["item_xiranite_powder", "item_copper_nugget"];
    for (const [index, original] of raw.entries()) {
      const id = "belt" + index;
      doc.entities[id] = { id, definitionId: "belt_straight_1x1", rotation: 0, position: { x: 20 + index * 2, y: 21 }, tags: [],
        config: { "storageSlotGroups[0].slots[0].initialItemType": original, "storageSlotGroups[0].slots[0].initialCount": 1 } };
      doc.entityOrder.push(id);
    }
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base",
      standardTickRate: 4, poweredEntityIds: new Set(doc.entityOrder) });
    const denseLayout = compileDenseTopologyLayout(topology, registry);
    const kernel = new DenseSimulationKernel(topology, denseLayout, registry, undefined, { next() { throw Error("四层明不抽样"); } });
    for (const [i] of rotations.entries()) kernel.patchRuntimeSlot({ entityId: "forge" + i, storageGroupId: CONSUMPTION_STORAGE_GROUP_ID,
      slotId: CONSUMPTION_SLOT_ID, itemType: "item_gas_xiranite", count: 2, ignoreStock: false });
    const initial = kernel.createCheckpoint();
    for (const item of raw) {
      const itemIndex = denseLayout.dictionary.itemIds.indexOf(item);
      expect(initial.slotCounts.reduce((total, count, slot) => total + (initial.slotItemIndexes[slot] === itemIndex ? count : 0), 0)).toBe(1);
    }
    kernel.advanceToTick(41);
    expect(kernel.periodicRegionSnapshots.map(r => [r.effect, r.layers, r.progressTimeUnits]))
      .toEqual(expect.arrayContaining([["ming", 4, 0], ["hui", 1, 0]]));
    const checkpoint = kernel.createCheckpoint();
    for (const [i, output] of ["item_xiranite_ming", "item_copper_ming"].entries()) {
      expect(checkpoint.warehouseProducedTotals[denseLayout.dictionary.itemIds.indexOf(output)]).toBe(1);
      expect(checkpoint.warehouseConsumedTotals[denseLayout.dictionary.itemIds.indexOf(raw[i]!)]).toBe(1);
    }
  });

  it("Dense 恢复六通道旧炉检查点时释放多余气体预留并继续两个投影", () => {
    const doc = layout({ east: ming, south: ming });
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base",
      standardTickRate: 4, poweredEntityIds: new Set(doc.entityOrder) });
    const denseLayout = compileDenseTopologyLayout(topology, registry);
    const kernel = new DenseSimulationKernel(topology, denseLayout, registry);
    kernel.patchRuntimeSlot({ entityId: "forge", storageGroupId: CONSUMPTION_STORAGE_GROUP_ID, slotId: CONSUMPTION_SLOT_ID,
      itemType: "item_gas_xiranite", count: 3, ignoreStock: false });
    kernel.advanceToTick(25);
    const curr = kernel.createCheckpoint();
    const reservation = curr.channelReservations[0]![0]!;
    const slotReserved = curr.slotReserved.slice();
    const slot = denseLayout.slotStorageIndexes[reservation.slotIndex]!;
    slotReserved[slot] = slotReserved[slot]! + reservation.amount;
    const indexes = [0, 0, 0, 0, 0, 1];
    const old = { ...curr, slotReserved,
      channelRecipeIndexes: Int32Array.from(indexes, i => curr.channelRecipeIndexes[i]!),
      channelProgressTicks: Float64Array.from(indexes, i => curr.channelProgressTicks[i]!),
      channelStates: Uint8Array.from([curr.channelStates[0]!, curr.channelStates[0]!, 0, 0, 0, curr.channelStates[1]!]),
      channelRunIds: Uint32Array.from(indexes, i => curr.channelRunIds[i]!),
      channelReservations: [curr.channelReservations[0]!, curr.channelReservations[0]!, null, null, null, curr.channelReservations[1]!],
      channelInputItems: indexes.map(i => curr.channelInputItems[i] ?? null),
    };
    const resumed = new DenseSimulationKernel(topology, denseLayout, registry);
    resumed.restoreCheckpoint(old);
    expect(resumed.createCheckpoint().slotReserved).toEqual(curr.slotReserved);
    expect(resumed.periodicRegionSnapshots.map(r => [r.effect, r.progressTimeUnits])).toEqual([["ming", 18000], ["ming", 18000]]);
  });

  it("Legacy 导入旧拓扑和运行帧后两个投影继续计时", () => {
    const doc = layout({ east: hui, south: hui });
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base", standardTickRate: 20,
      poweredEntityIds: new Set(doc.entityOrder) });
    const runtime = new SimulationWorkerRuntime(registry);
    try {
      runtime.initializeIsolated(topology, "infinite", [{ entityId: "forge", storageGroupId: CONSUMPTION_STORAGE_GROUP_ID,
        slotId: CONSUMPTION_SLOT_ID, itemType: "item_gas_xiranite", count: 2, ignoreStock: false }]);
      runtime.advanceToTick(121);
      const saved = runtime.exportRuntimeState(121)!;
      const id = "device:forge";
      const device = saved.topology.devices[id]!;
      const shared = { ...device.recipeChannels[1]!, id: "custom_periodic_phase", projectionRangeIds: undefined };
      const oldDevice = { ...device, recipeChannels: [...CONSUMPTION_CHANNEL_IDS.map(key => ({ ...device.recipeChannels[0]!, id: key })), shared] };
      const oldState = saved.runtimeState.persistent.devices[id]!;
      oldState.channelRecipes = { consumption_1: oldState.channelRecipes.consumption_1!, custom_periodic_phase: oldState.channelRecipes.east! };
      runtime.importRuntimeState({ ...saved, topology: { ...saved.topology, devices: { ...saved.topology.devices, [id]: oldDevice } } },
        { scheduleBackgroundFill: false });
      runtime.advanceToTick(141);
      const result = runtime.exportRuntimeState(141)!;
      expect(result.snapshot.periodicRegions.map(region => [region.effect, region.progressTimeUnits])).toEqual([["hui", 21000], ["hui", 21000]]);
      expect(result.snapshot.devices[id]!.channelRecipes).not.toHaveProperty("custom_periodic_phase");
    } finally { runtime.disposeIsolated(); }
  });

  it("两个投影均从世界时间的六秒处继续", () => {
    const doc = layout({ east: hui, south: hui });
    const topology = compileSimulationTopology({ document: doc, registry, simulationMode: "single-base",
      standardTickRate: 4, poweredEntityIds: new Set(doc.entityOrder) });
    const compiled = compilePeriodicEnvironment(topology, registry, id => id)!;
    const runtime = compiled.createRuntime({ next: () => .5 }, () => false, () => () => "hui");
    runtime.seek(18_000);
    expect(runtime.snapshots(18000).map(region => [region.effect, region.progressTimeUnits]))
      .toEqual([["hui", 18000], ["hui", 18000]]);
    expect(runtime.nextBoundary).toBe(30000);
  });
});
