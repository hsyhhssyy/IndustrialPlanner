import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { runBlueprintSimulation } from "./blueprint-runner";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { createSimulationTopologyMigration } from "@/simulation/topology-migration";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { createRegistryContract } from "@/registry";
import {
  createBlueprint,
  createEntity,
  findSlot,
} from "./blueprint-test-helpers";

function createGrinderBlueprint(
  name: string,
  position: WorldEntity["position"],
  initialItemType: string,
  initialCount: number,
): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("grinder", "grinder_1", position.x, position.y, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": initialItemType,
      "storageSlotGroups[0].slots[0].initialCount": initialCount,
    }),
  ]);
}

function createLinkedGrinderBlueprint(): BlueprintDocument {
  return createBlueprint(
    "linked-grinder",
    [
      createEntity("grinder", "grinder_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
        "storageSlotGroups[0].slots[0].initialCount": 1,
      }),
      createEntity("storage", "storager_1", 5, 0),
    ],
    [{
      id: "storage-to-grinder",
      linkType: "share-cap",
      source: {
        entityId: "storage",
        storageSlotGroupId: "storage_slot_1",
        slotId: "slot_1",
      },
      target: {
        entityId: "grinder",
        storageSlotGroupId: "item_input_buffer",
        slotId: "input_slot_1",
      },
    }],
  );
}

describe("REQ-076: topology migration", () => {
  it("covers topology-migration scenarios as blueprint pairs instead of private runtime state mutation", async () => {
    const original = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-original", { x: 0, y: 0 }, "item_iron_nugget", 1),
      registry: createRegistryContract(),
      maxTickNumber: 0,
    });
    const moved = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-moved", { x: 1, y: 0 }, "item_iron_nugget", 1),
      registry: createRegistryContract(),
      maxTickNumber: 0,
    });
    const configChanged = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("migration-config-changed", { x: 0, y: 0 }, "item_copper_ore", 2),
      registry: createRegistryContract(),
      maxTickNumber: 0,
    });
    const linked = await runBlueprintSimulation({
      blueprint: createLinkedGrinderBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 0,
    });

    expect(moved.topology.documentHash).not.toBe(original.topology.documentHash);
    expect(findSlot(moved, 0, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
    expect(findSlot(configChanged, 0, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_copper_ore",
        count: 2,
      });
    expect(linked.blueprint.slotLinkCount).toBe(1);
    expect(linked.topology.diagnosticCount).toBe(0);
  });

  it("resets only the switched device when definition and links change", () => {
    const registry = createRegistryContract();
    const previousDocument = createVariantSwitchDocument("filling_pd_mc_1", [
      createStorageToFactorySlotLink(),
    ]);
    const nextDocument = createVariantSwitchDocument(
      "liquid_filling_pd_mc_1",
      [],
    );
    const previousTopology = compileSimulationTopology({
      document: previousDocument,
      registry,
      poweredEntityIds: new Set(previousDocument.entityOrder),
    });
    const nextTopology = compileSimulationTopology({
      document: nextDocument,
      registry,
      poweredEntityIds: new Set(nextDocument.entityOrder),
    });

    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 42,
    });

    expect(migration).toEqual({
      baseTickNumber: 42,
      resetDeviceIds: ["device:factory"],
    });
  });

  it("hot-swaps a switched device without resetting unaffected device runtime state", () => {
    const registry = createRegistryContract();
    const previousDocument = createVariantSwitchDocument("furnance_1", []);
    const nextDocument = createVariantSwitchDocument("liquid_furnance_1", []);
    const previousTopology = compileSimulationTopology({
      document: previousDocument,
      registry,
      poweredEntityIds: new Set(previousDocument.entityOrder),
    });
    const nextTopology = compileSimulationTopology({
      document: nextDocument,
      registry,
      poweredEntityIds: new Set(nextDocument.entityOrder),
    });
    const runtime = new SimulationWorkerRuntime(registry);

    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: previousTopology,
    });
    runtime.advanceToTick(12);
    readRuntimeTick(runtime, 12, 2);
    patchRuntimeSlot(runtime, 3, "factory", "item_input_buffer", "input_item_slot_1", "item_iron_nugget", 8);
    runtime.advanceToTick(12);
    patchRuntimeSlot(runtime, 4, "storage", "storage_slot_1", "slot_1", "item_copper_ore", 11);
    runtime.advanceToTick(12);

    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 12,
    });
    if (migration === null) {
      throw new Error("Expected a topology migration.");
    }

    const loaded = runtime.handleRequest({
      type: "load-topology",
      requestId: 5,
      topology: nextTopology,
      migration,
    });
    if (loaded.type !== "topology-loaded") {
      throw new Error(`Unexpected response type '${loaded.type}'.`);
    }

    expect(loaded.result.runtimeTransition).toMatchObject({
      kind: "topology-hot-swap",
      baseTickNumber: 12,
      invalidatedFromTickNumber: 13,
      resetDeviceIds: ["device:factory"],
    });
    expect(runtime.getStatus()).toMatchObject({
      retainedFromTick: 12,
      latestTickNumber: 12,
      bufferSize: 1,
    });

    const migratedTick = readRuntimeTick(runtime, 12, 6);
    expect(migratedTick.slots["device:factory/node:item_input_buffer/slot:input_item_slot_1"])
      .toMatchObject({ itemType: null, count: 0 });
    expect(readDeviceStorageGroupSlots(migratedTick, "storage", "storage_slot_1"))
      .toContainEqual(expect.objectContaining({ itemType: "item_copper_ore", count: 11 }));

    runtime.advanceToTick(13);
    const continuedTick = readRuntimeTick(runtime, 13, 7);
    expect(readDeviceStorageGroupSlots(continuedTick, "storage", "storage_slot_1"))
      .toContainEqual(expect.objectContaining({ itemType: "item_copper_ore", count: 11 }));
  });

  it("retains the last displayed tick as the exact topology migration anchor", () => {
    const registry = createRegistryContract();
    const previousDocument = createVariantSwitchDocument("furnance_1", []);
    const nextDocument = createVariantSwitchDocument("liquid_furnance_1", []);
    const previousTopology = compileSimulationTopology({
      document: previousDocument,
      registry,
      poweredEntityIds: new Set(previousDocument.entityOrder),
    });
    const nextTopology = compileSimulationTopology({
      document: nextDocument,
      registry,
      poweredEntityIds: new Set(nextDocument.entityOrder),
    });
    const runtime = new SimulationWorkerRuntime(registry);

    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: previousTopology,
    });
    runtime.advanceToTick(20);
    readRuntimeTick(runtime, 12, 2);
    readRuntimeTick(runtime, 20, 3, 12);

    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 12,
    });
    if (migration === null) {
      throw new Error("Expected a topology migration.");
    }

    const loaded = runtime.handleRequest({
      type: "load-topology",
      requestId: 4,
      topology: nextTopology,
      migration,
    });
    if (loaded.type !== "topology-loaded") {
      throw new Error(`Unexpected response type '${loaded.type}'.`);
    }

    expect(loaded.result.runtimeTransition).toMatchObject({
      kind: "topology-hot-swap",
      baseTickNumber: 12,
      resetDeviceIds: ["device:factory"],
    });
  });

  it("rejects a migration with no exact anchor instead of resetting or advancing time", () => {
    const registry = createRegistryContract();
    const previousDocument = createVariantSwitchDocument("furnance_1", []);
    const nextDocument = createVariantSwitchDocument("liquid_furnance_1", []);
    const previousTopology = compileSimulationTopology({
      document: previousDocument,
      registry,
      poweredEntityIds: new Set(previousDocument.entityOrder),
    });
    const nextTopology = compileSimulationTopology({
      document: nextDocument,
      registry,
      poweredEntityIds: new Set(nextDocument.entityOrder),
    });
    const runtime = new SimulationWorkerRuntime(registry);

    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: previousTopology,
    });
    runtime.advanceToTick(20);
    readRuntimeTick(runtime, 20, 2);

    const migration = createSimulationTopologyMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 12,
    });
    if (migration === null) {
      throw new Error("Expected a topology migration.");
    }

    const loaded = runtime.handleRequest({
      type: "load-topology",
      requestId: 3,
      topology: nextTopology,
      migration,
    });
    if (loaded.type !== "topology-loaded") {
      throw new Error(`Unexpected response type '${loaded.type}'.`);
    }

    expect(loaded.result).toMatchObject({
      status: "failed",
      runtimeTransition: {
        kind: "migration-rejected",
        baseTickNumber: 12,
      },
    });
    expect(runtime.getStatus().topologyId).toBe(previousTopology.topologyId);
  });
});

function patchRuntimeSlot(
  runtime: SimulationWorkerRuntime,
  requestId: number,
  entityId: string,
  storageGroupId: string,
  slotId: string,
  itemType: string,
  count: number,
): void {
  runtime.handleRequest({
    type: "patch-runtime-slot",
    requestId,
    patch: {
      entityId,
      storageGroupId,
      slotId,
      itemType,
      count,
      ignoreStock: false,
    },
  });
}

function readRuntimeTick(
  runtime: SimulationWorkerRuntime,
  tickNumber: number,
  requestId: number,
  retainTickNumber?: number,
) {
  const response = runtime.handleRequest({
    type: "get-tick-snapshot",
    requestId,
    tickNumber,
    retainTickNumber,
  });
  if (response.type !== "tick-snapshot-result" || response.result.currentTick === null) {
    throw new Error(`Expected ready tick ${tickNumber}.`);
  }
  return response.result.currentTick;
}

function readDeviceStorageGroupSlots(
  tick: ReturnType<typeof readRuntimeTick>,
  entityId: string,
  storageGroupId: string,
) {
  return Object.entries(tick.slots)
    .filter(([slotId]) => slotId.startsWith(`device:${entityId}/node:${storageGroupId}`))
    .map(([, slot]) => slot);
}

function createVariantSwitchDocument(
  factoryDefinitionId: string,
  slotLinks: WorldDocument["slotLinks"],
): WorldDocument {
  const document = createWorldDocument();
  document.entities = {
    storage: createDocumentEntity("storage", "storager_1", 4, 10),
    factory: createDocumentEntity("factory", factoryDefinitionId, 10, 10),
  };
  document.entityOrder = ["storage", "factory"];
  document.slotLinks = [...slotLinks];
  return document;
}

function createDocumentEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function createStorageToFactorySlotLink(): WorldDocument["slotLinks"][number] {
  return {
    id: "storage-to-factory",
    linkType: "share-cap",
    source: {
      entityId: "storage",
      storageSlotGroupId: "storage_slot_1",
      slotId: "slot_1",
    },
    target: {
      entityId: "factory",
      storageSlotGroupId: "item_input_buffer",
      slotId: "input_slot_1",
    },
  };
}
