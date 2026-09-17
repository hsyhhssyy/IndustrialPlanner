// @vitest-environment node

import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

it("Dense 2 TPS：五个运行消耗通道同时消耗库存，不能被普通配方去重规则串行化", () => {
  const registry = createRegistryContract();
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/metered-consumption/scene-04-five-consumption-items-d13b6eff.schema6.json");
  const document = createWorldDocumentFromBlueprint(blueprint);
  const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base",
    standardTickRate: 2, poweredEntityIds: new Set(document.entityOrder) });
  const engine = createDenseBlueprintEngine(registry, { topology, powerMode: "infinite",
    initialSlots: [{ entityId: "vaporizer", storageGroupId: "consume_buffer", slotId: "consume_slot",
      itemType: "item_gas_xiranite", count: 5, ignoreStock: false }] });
  try {
    engine.advance();
    const device = engine.readDevices().find((entry) => entry.deviceId === "device:vaporizer")!;
    expect(Object.values(device.channelRecipes).filter(Boolean)).toHaveLength(5);
    expect(engine.readSlots().reduce((sum, slot) => sum + slot.count, 0)).toBe(5);
    expect(engine.readSlots().reduce((sum, slot) => sum + slot.reserved, 0)).toBe(5);
    // AI-CORRECTION 2026-09-17: 经用户授权，库存于配方完成时扣除；首 tick 仅预留。
    for (let tick = 0; tick < 20; tick += 1) engine.advance();
    expect(engine.readSlots().reduce((sum, slot) => sum + slot.count, 0)).toBe(0);
    expect(engine.readSlots().reduce((sum, slot) => sum + slot.reserved, 0)).toBe(0);
  } finally { engine.dispose(); }
});
