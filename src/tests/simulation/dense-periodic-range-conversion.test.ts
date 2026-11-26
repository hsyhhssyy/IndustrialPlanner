import { describe, expect, it } from "vitest";
import { createRegistryQuery } from "@/registry/registry-query";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout } from "@/simulation/dense/dense-topology";
import { compileSimulationTopology } from "@/simulation/topology";
import {
  loadPeriodicRangeConversionFixture,
  PERIODIC_FIXTURE_PRODUCT_ITEM,
  PERIODIC_FIXTURE_RAW_ITEM,
} from "./periodic-range-conversion-fixture";

function createKernel({ document, registry } = loadPeriodicRangeConversionFixture(2.5)) {
  const topology = compileSimulationTopology({
    document, registry, simulationMode: "single-base", standardTickRate: 4,
    poweredEntityIds: new Set(document.entityOrder),
  });
  const layout = compileDenseTopologyLayout(topology, registry);
  return new DenseSimulationKernel(topology, layout, registry);
}

function inventory(kernel: DenseSimulationKernel, entityId: string) {
  const deviceId = Object.values(kernel.topology.devices).find(device => device.sourceEntityId === entityId)!.id;
  const deviceIndex = kernel.layout.dictionary.deviceIds.indexOf(deviceId);
  const slotIndexes = new Set<number>();
  for (const nodeId of kernel.topology.devices[deviceId]!.nodeIds) {
    for (const slotId of kernel.topology.nodes[nodeId]!.slotIds) {
      const slotIndex = kernel.layout.dictionary.slotIds.indexOf(slotId);
      if (slotIndex >= 0) slotIndexes.add(kernel.layout.slotStorageIndexes[slotIndex]!);
    }
  }
  expect(deviceIndex).toBeGreaterThanOrEqual(0);
  return [...slotIndexes].map(index => {
    const slot = kernel.state.readSlot(index);
    return { ...slot, itemId: kernel.layout.dictionary.itemIds[slot.itemIndex] };
  });
}

describe("Dense 周期范围转化", () => {
  it("转换已预占物料后按新身份持续递交，连通组件中两类物料数量守恒", () => {
    const kernel = createKernel();
    kernel.advanceToTick(9);
    expect(inventory(kernel, "covered-belt")).toContainEqual(expect.objectContaining({
      itemId: PERIODIC_FIXTURE_RAW_ITEM, count: 1, reserved: 1,
    }));
    kernel.advanceToTick(11);
    expect(inventory(kernel, "covered-belt")).toContainEqual(expect.objectContaining({
      itemId: PERIODIC_FIXTURE_PRODUCT_ITEM, count: 1, reserved: 1,
    }));
    // 线上严格传送带每 2 秒递交一件，覆盖 20 件连同末尾通过三段带的时间。
    kernel.advanceToTick(250);
    const delivered = inventory(kernel, "sink-storage");
    const raw = delivered.filter(slot => slot.itemId === PERIODIC_FIXTURE_RAW_ITEM).reduce((sum, slot) => sum + slot.count, 0);
    const product = delivered.filter(slot => slot.itemId === PERIODIC_FIXTURE_PRODUCT_ITEM).reduce((sum, slot) => sum + slot.count, 0);
    expect(raw).toBeGreaterThan(0);
    expect(product).toBeGreaterThan(0);
    expect(raw + product).toBe(20);
  });

  it("共享检查点在未发生区域事件时复用，恢复和拓扑迁移保留到期点", () => {
    const original = createKernel();
    original.advanceToTick(1);
    const starting = original.createCheckpoint();
    expect(starting.periodicEnvironment?.regions).toHaveLength(1);
    original.advanceToTick(9);
    const beforeConversion = original.createCheckpoint();
    expect(beforeConversion.periodicEnvironment).toBe(starting.periodicEnvironment);

    const resumed = createKernel();
    resumed.restoreCheckpoint(beforeConversion);
    const migrated = createKernel();
    migrated.restoreMigratedRuntime(original, []);
    for (const kernel of [original, resumed, migrated]) {
      kernel.advanceToTick(11);
      expect(inventory(kernel, "covered-belt")).toContainEqual(expect.objectContaining({
        itemId: PERIODIC_FIXTURE_PRODUCT_ITEM, count: 1, reserved: 1,
      }));
    }
  });

  it("读取没有区域字段的旧检查点时保留物料和预占，并重新累计区域周期", () => {
    const original = createKernel();
    original.advanceToTick(9);
    const { periodicEnvironment: originalRegion, ...oldCheckpoint } = original.createCheckpoint();
    expect(originalRegion?.regions).toHaveLength(1);

    const resumed = createKernel();
    resumed.restoreCheckpoint(oldCheckpoint);
    expect(resumed.createCheckpoint()).toMatchObject({
      slotItemIndexes: oldCheckpoint.slotItemIndexes,
      slotCounts: oldCheckpoint.slotCounts,
      slotReserved: oldCheckpoint.slotReserved,
      channelReservations: oldCheckpoint.channelReservations,
      periodicEnvironment: { regions: [{ active: true, remainingMs: 7_500 }] },
    });
    resumed.advanceToTick(11);
    expect(inventory(resumed, "covered-belt")).toContainEqual(expect.objectContaining({
      itemId: PERIODIC_FIXTURE_RAW_ITEM, count: 1, reserved: 1,
    }));
  });

  it("手选非默认侧时用该侧概率与映射", () => {
    const { document, registry } = loadPeriodicRangeConversionFixture(2.5);
    const fixtureDevice = registry.queries.findEntityDefinition("vaporizer_1")!;
    const fixtureChannel = fixtureDevice.recipeChannels[0]!;
    const fixtureRecipe = registry.recipeDefinitions.find(recipe => recipe.periodicRangeConversion?.programId === "fixture:periodic-range-conversion")!;
    const source = fixtureRecipe.periodicRangeConversion!;
    const selectedRecipeId = "fixture:req050:manual-side-1";
    const entityDefinitions = registry.entityDefinitions.map(definition => definition === fixtureDevice ? {
      ...definition, recipeChannels: [{ ...fixtureChannel, manualRecipeOnly: true }],
    } : definition);
    const recipeDefinitions = [
      ...registry.recipeDefinitions.filter(recipe => recipe.id !== "fixture:route:ming"),
      { ...fixtureRecipe, id: selectedRecipeId, periodicRangeConversion: { ...source, side: 1 as const } },
    ];
    document.entities["gas-diffuser"]!.config.channelRecipes = { [fixtureChannel.id]: selectedRecipeId };
    const kernel = createKernel({ document, registry: {
      ...registry, entityDefinitions, recipeDefinitions,
      queries: createRegistryQuery({ entityDefinitions, itemDefinitions: registry.itemDefinitions, recipeDefinitions }),
    } });
    const sourceDevice = Object.values(kernel.topology.devices).find(device => device.sourceEntityId === "gas-diffuser")!;
    expect(sourceDevice.recipeChannels).toContainEqual(expect.objectContaining({
      manualRecipeOnly: true, defaultRecipeId: selectedRecipeId,
    }));
    kernel.advanceToTick(11);
    expect(inventory(kernel, "covered-belt")).toContainEqual(expect.objectContaining({ itemId: PERIODIC_FIXTURE_PRODUCT_ITEM }));
  });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//     const fixtureRecipe = registry.recipeDefinitions.find(recipe => recipe.periodicRangeConversion !== undefined)!;
//
//     const [first, second, paired] = source.program.effects;
//     const program = { ...source.program, effects: [{ ...first, outputItemByInputId: {} }, second, paired] as const };
//
//       ...registry.recipeDefinitions.map(recipe => recipe === fixtureRecipe
//         ? { ...recipe, periodicRangeConversion: { ...source, program } } : recipe),
//       { ...fixtureRecipe, id: selectedRecipeId, periodicRangeConversion: { ...source, program, side: 1 as const } },
