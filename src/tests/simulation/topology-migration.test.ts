import { describe, expect, it } from "vitest";

import type { WorldDocument } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import {
  aggregateInputItems,
  resolveDeviceRecipePlans,
  selectRecipeInputs,
} from "@/simulation/runtime/runtime-slot-access";
import {
  createMigratedSimulationMutableRuntimeState,
  createSimulationMutableRuntimeState,
  type RuntimeDeviceRecipeState,
  type SimulationMutableRuntimeState,
} from "@/simulation/runtime/runtime-state";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { createSimulationTopologyMigration } from "@/simulation/topology-migration";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationTopologyMigration,
} from "@/simulation/types";

describe("simulation topology migration", () => {
  it("keeps production recipe progress and slot contents after a graph-only move", () => {
    const previousDocument = createGrinderProductionDocument();
    const nextDocument = moveEntity(previousDocument, "grinder", 1, 0);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const previousState = createSimulationMutableRuntimeState(previousTopology);

    previousState.tickNumber = 7;
    seedDeviceSlot(previousTopology, previousState, "device:grinder", "item_input_buffer", "item_iron_nugget", 1);
    startRecipe(previousTopology, previousState, "device:grinder");
    const migration = createMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: previousState.tickNumber,
    });
    const migratedState = createMigratedSimulationMutableRuntimeState({
      previousTopology,
      previousState,
      topology: nextTopology,
      resetDeviceIds: migration.resetDeviceIds,
    });

    expect(migration.resetDeviceIds).toEqual([]);
    expect(migratedState.tickNumber).toBe(7);
    expect(migratedState.persistent.devices["device:grinder"]?.recipe?.progressTicks).toBe(1);
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:grinder", "item_input_buffer")?.itemType)
      .toBe("item_iron_nugget");
  });

  it("resets recipe and slots when an initial slot config changes", () => {
    const previousDocument = createGrinderProductionDocument();
    const nextDocument = updateEntityConfig(previousDocument, "grinder", {
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    });
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const runtime = new SimulationWorkerRuntime();

    loadTopology(runtime, previousTopology);
    const previousTick = getTick(runtime, 2);
    const migration = createMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: previousTick.tickNumber,
    });

    expect(migration.resetDeviceIds).toEqual(["device:grinder"]);

    loadTopology(runtime, nextTopology, migration);
    const migratedTick = getTick(runtime, previousTick.tickNumber);
    const inputSlot = readDeviceSlot(migratedTick, nextTopology, "device:grinder", "item_input_buffer");

    expect(migratedTick.devices["device:grinder"]?.recipe).toBeNull();
    expect(inputSlot).toEqual(expect.objectContaining({
      itemType: "item_copper_ore",
      count: 2,
      reserved: 0,
    }));
  });

  it("keeps the requested migration tick ready when the base runtime state is unavailable", () => {
    const previousDocument = createGrinderProductionDocument();
    const nextDocument = moveEntity(previousDocument, "grinder", 1, 0);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const runtime = new SimulationWorkerRuntime();
    const migration = createMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 220,
    });

    loadTopology(runtime, previousTopology);
    loadTopology(runtime, nextTopology, migration);
    const migratedTick = getTick(runtime, 220);
    const nextTick = getTick(runtime, 221);

    expect(migratedTick.tickNumber).toBe(220);
    expect(nextTick.tickNumber).toBe(221);
  });

  it("resets linked endpoint devices when document slot links change", () => {
    const previousDocument = createGrinderProductionDocument();
    const nextDocument = addStorageLinkToGrinder(previousDocument);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const previousState = createSimulationMutableRuntimeState(previousTopology);
    seedDeviceSlot(previousTopology, previousState, "device:grinder", "item_input_buffer", "item_iron_nugget", 1);
    startRecipe(previousTopology, previousState, "device:grinder");

    const migration = createMigration({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      baseTickNumber: 0,
    });
    const migratedState = createMigratedSimulationMutableRuntimeState({
      previousTopology,
      previousState,
      topology: nextTopology,
      resetDeviceIds: migration.resetDeviceIds,
    });

    expect(migration.resetDeviceIds).toEqual(["device:grinder"]);
    expect(migratedState.persistent.devices["device:grinder"]?.recipe).toBeNull();
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:grinder", "item_input_buffer"))
      .toEqual(expect.objectContaining({ itemType: "item_iron_nugget", count: 1 }));
  });

  it("merges pipe groups without clearing slots when item types match", () => {
    const previousDocument = createSeparatedPipeGroupsDocument();
    const nextDocument = addPipeBridge(previousDocument);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const previousState = createSimulationMutableRuntimeState(previousTopology);

    seedDeviceSlot(previousTopology, previousState, "device:pipe-a", "synthetic-input", "item_liquid_acid", 1);
    seedDeviceSlot(previousTopology, previousState, "device:pipe-c", "synthetic-input", "item_liquid_acid", 1);

    const migratedState = migratePipeState({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      previousState,
    });
    const componentId = nextTopology.devices["device:pipe-a"]?.transportComponentId;

    expect(componentId).not.toBeNull();
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-a", "synthetic-input")?.itemType)
      .toBe("item_liquid_acid");
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-c", "synthetic-input")?.itemType)
      .toBe("item_liquid_acid");
    expect(migratedState.persistent.transportComponentDomain[componentId ?? ""])
      .toBe("item_liquid_acid");
  });

  it("clears both sides and resets recipes when merged pipe groups contain different items", () => {
    const previousDocument = createSeparatedPipeGroupsDocument();
    const nextDocument = addPipeBridge(previousDocument);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const previousState = createSimulationMutableRuntimeState(previousTopology);

    seedDeviceSlot(previousTopology, previousState, "device:pipe-a", "synthetic-input", "item_liquid_acid", 1);
    seedDeviceSlot(previousTopology, previousState, "device:pipe-c", "synthetic-input", "item_liquid_water", 1);
    startRecipe(previousTopology, previousState, "device:pipe-a");
    startRecipe(previousTopology, previousState, "device:pipe-c");

    const migratedState = migratePipeState({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      previousState,
    });
    const componentId = nextTopology.devices["device:pipe-a"]?.transportComponentId;

    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-a", "synthetic-input"))
      .toEqual(expect.objectContaining({ itemType: null, count: 0 }));
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-c", "synthetic-input"))
      .toEqual(expect.objectContaining({ itemType: null, count: 0 }));
    expect(migratedState.persistent.devices["device:pipe-a"]?.recipe).toBeNull();
    expect(migratedState.persistent.devices["device:pipe-c"]?.recipe).toBeNull();
    expect(migratedState.persistent.transportComponentDomain[componentId ?? ""])
      .toBeNull();
  });

  it("preserves pipe slots when a pipe group splits", () => {
    const previousDocument = createConnectedPipeGroupDocument();
    const nextDocument = moveEntity(previousDocument, "pipe-b", 10, 0);
    const previousTopology = compileTestTopology(previousDocument);
    const nextTopology = compileTestTopology(nextDocument);
    const previousState = createSimulationMutableRuntimeState(previousTopology);

    seedDeviceSlot(previousTopology, previousState, "device:pipe-a", "synthetic-input", "item_liquid_acid", 1);
    seedDeviceSlot(previousTopology, previousState, "device:pipe-c", "synthetic-input", "item_liquid_acid", 1);

    const migratedState = migratePipeState({
      previousDocument,
      nextDocument,
      previousTopology,
      nextTopology,
      previousState,
    });
    const firstComponentId = nextTopology.devices["device:pipe-a"]?.transportComponentId;
    const secondComponentId = nextTopology.devices["device:pipe-c"]?.transportComponentId;

    expect(firstComponentId).not.toBe(secondComponentId);
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-a", "synthetic-input")?.itemType)
      .toBe("item_liquid_acid");
    expect(readDeviceStateSlot(nextTopology, migratedState, "device:pipe-c", "synthetic-input")?.itemType)
      .toBe("item_liquid_acid");
    expect(migratedState.persistent.transportComponentDomain[firstComponentId ?? ""])
      .toBe("item_liquid_acid");
    expect(migratedState.persistent.transportComponentDomain[secondComponentId ?? ""])
      .toBe("item_liquid_acid");
  });
});

function compileTestTopology(document: WorldDocument): CompiledSimulationTopology {
  return compileSimulationTopology({
    document,
    registry: createRegistryContract(),
  });
}

function createMigration(options: {
  readonly previousDocument: WorldDocument;
  readonly nextDocument: WorldDocument;
  readonly previousTopology: CompiledSimulationTopology;
  readonly nextTopology: CompiledSimulationTopology;
  readonly baseTickNumber: number;
}): SimulationTopologyMigration {
  const migration = createSimulationTopologyMigration(options);
  if (migration === null) {
    throw new Error("Expected topology migration to be created.");
  }
  return migration;
}

function migratePipeState(options: {
  readonly previousDocument: WorldDocument;
  readonly nextDocument: WorldDocument;
  readonly previousTopology: CompiledSimulationTopology;
  readonly nextTopology: CompiledSimulationTopology;
  readonly previousState: SimulationMutableRuntimeState;
}): SimulationMutableRuntimeState {
  const migration = createMigration({
    previousDocument: options.previousDocument,
    nextDocument: options.nextDocument,
    previousTopology: options.previousTopology,
    nextTopology: options.nextTopology,
    baseTickNumber: options.previousState.tickNumber,
  });
  return createMigratedSimulationMutableRuntimeState({
    previousTopology: options.previousTopology,
    previousState: options.previousState,
    topology: options.nextTopology,
    resetDeviceIds: migration.resetDeviceIds,
  });
}

function loadTopology(
  runtime: SimulationWorkerRuntime,
  topology: CompiledSimulationTopology,
  migration?: SimulationTopologyMigration,
): void {
  const response = runtime.handleRequest(migration === undefined
    ? {
        type: "load-topology",
        requestId: 1,
        topology,
      }
    : {
        type: "load-topology",
        requestId: 1,
        topology,
        migration,
      });

  if (response.type !== "topology-loaded" || response.result.status !== "started") {
    throw new Error("Expected topology to load.");
  }
}

function getTick(runtime: SimulationWorkerRuntime, tickNumber: number): RuntimeTickSnapshot {
  const response = runtime.handleRequest({
    type: "get-tick-snapshot",
    requestId: 2,
    tickNumber,
  });
  if (response.type !== "tick-snapshot-result" || response.result.currentTick === null) {
    throw new Error(`Expected tick ${tickNumber} to be ready.`);
  }
  return response.result.currentTick;
}

function startRecipe(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): void {
  const device = topology.devices[deviceId];
  const deviceState = state.persistent.devices[deviceId];
  if (device === undefined || deviceState === undefined) {
    throw new Error(`Expected ${deviceId} to exist.`);
  }

  const plan = resolveDeviceRecipePlans({ topology, state, device })[0];
  if (plan === undefined) {
    throw new Error(`Expected ${deviceId} to have a startable recipe plan.`);
  }

  const reservations = selectRecipeInputs({ topology, state, plan });
  if (reservations === null) {
    throw new Error(`Expected ${deviceId} recipe inputs to be selectable.`);
  }

  const recipe: RuntimeDeviceRecipeState = {
    runId: `test-recipe:${deviceId}`,
    recipeId: plan.recipeId,
    recipeType: plan.recipeType,
    progressTicks: 1,
    durationTicks: plan.durationTicks,
    state: "running",
    plan,
    reservations,
    inputItems: aggregateInputItems(reservations),
  };
  deviceState.recipe = recipe;
  deviceState.block = false;
}

function seedDeviceSlot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
  storageSlotGroupId: string,
  itemType: string,
  count: number,
): void {
  const slotState = readDeviceStateSlot(topology, state, deviceId, storageSlotGroupId);
  if (slotState === null) {
    throw new Error(`Expected ${deviceId} ${storageSlotGroupId} slot to exist.`);
  }

  slotState.itemType = itemType;
  slotState.count = count;
}

function readDeviceStateSlot(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
  storageSlotGroupId: string,
): SimulationMutableRuntimeState["persistent"]["slots"][string] | null {
  const slotId = resolveDeviceSlotId(topology, deviceId, storageSlotGroupId);
  return slotId === null ? null : state.persistent.slots[slotId] ?? null;
}

function readDeviceSlot(
  snapshot: RuntimeTickSnapshot,
  topology: CompiledSimulationTopology,
  deviceId: string,
  storageSlotGroupId: string,
): RuntimeTickSnapshot["slots"][string] | null {
  const slotId = resolveDeviceSlotId(topology, deviceId, storageSlotGroupId);
  return slotId === null ? null : snapshot.slots[slotId] ?? null;
}

function resolveDeviceSlotId(
  topology: CompiledSimulationTopology,
  deviceId: string,
  storageSlotGroupId: string,
): string | null {
  const device = topology.devices[deviceId];
  if (device === undefined) {
    return null;
  }

  for (const nodeId of device.nodeIds) {
    const node = topology.nodes[nodeId];
    if (node?.sourceStorageSlotGroupId === storageSlotGroupId) {
      return node.slotIds[0] ?? null;
    }
  }
  return null;
}

function createGrinderProductionDocument(): WorldDocument {
  return createWorldDocument({
    documentKey: "33333333-3333-4333-8333-333333333333",
    id: "grinder-production-world",
    name: "Grinder Production World",
    entities: {
      grinder: {
        id: "grinder",
        definitionId: "item_port_grinder_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        },
        tags: [],
      },
    },
    entityOrder: ["grinder"],
  });
}

function addStorageLinkToGrinder(document: WorldDocument): WorldDocument {
  const nextDocument = cloneDocument(document);
  nextDocument.entities.storage = {
    id: "storage",
    definitionId: "item_port_storager_1",
    position: { x: 5, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
  nextDocument.entityOrder = ["grinder", "storage"];
  nextDocument.slotLinks = [{
    id: "storage-to-grinder",
    linkType: "share-cap",
    source: {
      entityId: "storage",
      storageSlotGroupId: "item_storage",
      slotId: "slot_1",
    },
    target: {
      entityId: "grinder",
      storageSlotGroupId: "item_input_buffer",
      slotId: "input_slot_1",
    },
  }];
  return nextDocument;
}

function createSeparatedPipeGroupsDocument(): WorldDocument {
  return createWorldDocument({
    documentKey: "55555555-5555-4555-8555-555555555555",
    id: "separated-pipe-world",
    name: "Separated Pipe World",
    entities: {
      "pipe-a": createPipeEntity("pipe-a", 0),
      "pipe-b": createPipeEntity("pipe-b", 1),
      "pipe-c": createPipeEntity("pipe-c", 3),
      "pipe-d": createPipeEntity("pipe-d", 4),
    },
    entityOrder: ["pipe-a", "pipe-b", "pipe-c", "pipe-d"],
  });
}

function createConnectedPipeGroupDocument(): WorldDocument {
  return createWorldDocument({
    documentKey: "66666666-6666-4666-8666-666666666666",
    id: "connected-pipe-world",
    name: "Connected Pipe World",
    entities: {
      "pipe-a": createPipeEntity("pipe-a", 0),
      "pipe-b": createPipeEntity("pipe-b", 1),
      "pipe-c": createPipeEntity("pipe-c", 2),
    },
    entityOrder: ["pipe-a", "pipe-b", "pipe-c"],
  });
}

function addPipeBridge(document: WorldDocument): WorldDocument {
  const nextDocument = cloneDocument(document);
  nextDocument.entities["pipe-bridge"] = createPipeEntity("pipe-bridge", 2);
  nextDocument.entityOrder = ["pipe-a", "pipe-b", "pipe-bridge", "pipe-c", "pipe-d"];
  return nextDocument;
}

function createPipeEntity(id: string, x: number): WorldDocument["entities"][string] {
  return {
    id,
    definitionId: "pipe_straight_1x1",
    position: { x, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function moveEntity(document: WorldDocument, entityId: string, x: number, y: number): WorldDocument {
  const nextDocument = cloneDocument(document);
  const entity = nextDocument.entities[entityId];
  if (entity === undefined) {
    throw new Error(`Expected ${entityId} to exist.`);
  }
  nextDocument.entities[entityId] = {
    ...entity,
    position: { x, y },
  };
  return nextDocument;
}

function updateEntityConfig(
  document: WorldDocument,
  entityId: string,
  config: WorldDocument["entities"][string]["config"],
): WorldDocument {
  const nextDocument = cloneDocument(document);
  const entity = nextDocument.entities[entityId];
  if (entity === undefined) {
    throw new Error(`Expected ${entityId} to exist.`);
  }
  nextDocument.entities[entityId] = {
    ...entity,
    config,
  };
  return nextDocument;
}

function createWorldDocument(options: {
  readonly documentKey: string;
  readonly id: string;
  readonly name: string;
  readonly entities: WorldDocument["entities"];
  readonly entityOrder: string[];
}): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: options.documentKey,
    baseId: "wuling_protocol_core",
    meta: {
      id: options.id,
      name: options.name,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: options.entities,
    entityOrder: options.entityOrder,
    slotLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  };
}

function cloneDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}
