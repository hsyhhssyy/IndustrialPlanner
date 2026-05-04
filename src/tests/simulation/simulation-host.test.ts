import { autorun } from "mobx"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkspaceContract } from "@/domain/contract/workspace-contract"
import type { WorldDocument } from "@/domain/entity/world-document"
import { createWorkspaceState } from "@/domain/state/workspace-state"
import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store"
import { createSimulationHost } from "@/simulation/simulation-host"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createSimulationHost", () => {
  it("exposes the compiled topology through the public contract", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    expect(host.state).toBe("stop")
    expect(host.topology.getSnapshot()).toBeNull()
    expect(host.queries.getCurrentTickSnapshot()).toBeNull()

    const result = await host.actions.start()
    const topology = host.topology.getSnapshot()

    expect(result.status).toBe("started")
    expect(host.state).toBe("start")
    expect(topology).not.toBeNull()
    expect(topology?.topologyId).toBe(result.topologyId)
    expect(workspace.simulation).toBe(host)

    host.dispose()
  })

  it("updates the public simulation state through start pause and stop actions", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    expect(host.state).toBe("stop")

    await host.actions.start()
    expect(host.state).toBe("start")

    host.actions.pause()
    expect(host.state).toBe("pause")

    host.actions.stop()
    expect(host.state).toBe("stop")

    host.dispose()
  })

  it("advances playback by delta ms and only pulls a new tick after crossing an integer boundary", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    expect(host.playbackTickRateHz).toBe(1)

    host.playbackTickRateHz = 2.8
    expect(host.playbackTickRateHz).toBe(2)

    const halfTick = await host.actions.advancePlaybackByDeltaMs(250)

    expect(halfTick).toBeNull()
    expect(host.queries.getCurrentTickSnapshot()).toBeNull()

    const firstTick = await host.actions.advancePlaybackByDeltaMs(250)
    const secondTick = await host.actions.advancePlaybackByDeltaMs(500)

    expect(firstTick?.status).toBe("ready")
    expect(firstTick?.status === "ready" ? firstTick.snapshot.tickNumber : null).toBe(1)
    expect(secondTick?.status).toBe("ready")
    expect(secondTick?.status === "ready" ? secondTick.snapshot.tickNumber : null).toBe(2)
    expect(host.queries.getCurrentTickSnapshot()?.tickNumber).toBe(2)

    host.dispose()
  })

  it("refreshes the exposed topology after document recompilation", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace, document } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const firstTickSnapshot = await host.actions.getTickSnapshot(0)
    const firstTopology = host.topology.getSnapshot()

    expect(firstTickSnapshot.status).toBe("ready")
    expect(firstTopology).not.toBeNull()
    expect(host.queries.getCurrentTickSnapshot()?.tickNumber).toBe(0)

    document.setSnapshot(createMovedDummyDocument())
    await flushMicrotasks(8)

    const secondTopology = host.topology.getSnapshot()

    expect(secondTopology).not.toBeNull()
    expect(secondTopology?.topologyId).not.toBe(firstTopology?.topologyId)
    expect(secondTopology?.documentHash).not.toBe(firstTopology?.documentHash)
    expect(host.queries.getCurrentTickSnapshot()).toBeNull()

    host.dispose()
  })

  it("rolls back playback progress when the target tick is not ready", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    host.playbackTickRateHz = 180

    const firstAttempt = await host.actions.advancePlaybackByDeltaMs(1000)
    const secondAttempt = await host.actions.advancePlaybackByDeltaMs(1000)

    expect(firstAttempt?.status).toBe("not-ready")
    expect(firstAttempt?.status === "not-ready" ? firstAttempt.requestedTickNumber : null).toBe(180)
    expect(secondAttempt?.status).toBe("not-ready")
    expect(secondAttempt?.status === "not-ready" ? secondAttempt.requestedTickNumber : null).toBe(180)
    expect(host.queries.getCurrentTickSnapshot()).toBeNull()

    host.dispose()
  })

  it("does nothing when playback advances outside the start state", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    host.playbackTickRateHz = 4

    const beforeStart = await host.actions.advancePlaybackByDeltaMs(1000)

    expect(beforeStart).toBeNull()
    expect(host.queries.getCurrentTickSnapshot()).toBeNull()

    await host.actions.start()
    const tickZero = await host.actions.getTickSnapshot(0)

    expect(tickZero.status).toBe("ready")

    host.actions.pause()
    const pausedAttempt = await host.actions.advancePlaybackByDeltaMs(1000)

    expect(pausedAttempt).toBeNull()
    expect(host.queries.getCurrentTickSnapshot()?.tickNumber).toBe(0)

    host.actions.stop()
    const stoppedAttempt = await host.actions.advancePlaybackByDeltaMs(1000)

    expect(stoppedAttempt).toBeNull()
    expect(host.queries.getCurrentTickSnapshot()?.tickNumber).toBe(0)

    host.dispose()
  })

  it("stores the last extracted tick snapshot as the current tick", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()

    const tickZero = await host.actions.getTickSnapshot(0)
    const tickFive = await host.actions.getTickSnapshot(5)

    expect(tickZero.status).toBe("ready")
    expect(tickFive.status).toBe("ready")
    expect(host.queries.getCurrentTickSnapshot()?.tickNumber).toBe(5)

    host.dispose()
  })

  it("projects a device runtime read model by world document id", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createGrinderProductionDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const tickOne = await host.actions.getTickSnapshot(1)

    expect(tickOne.status).toBe("ready")
    expect(host.queries.getDeviceRuntimeStatus("missing-device")).toBeNull()
    expect(host.queries.getDeviceRuntimeStatus("grinder")).toEqual({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressTicks: 0,
      desiredTicks: 4,
    })

    await host.actions.getTickSnapshot(5)

    expect(host.queries.getDeviceRuntimeStatus("grinder")).toEqual({
      recipeId: null,
      progressTicks: null,
      desiredTicks: null,
    })

    host.dispose()
  })

  it("moves items through a belt into the next storage device", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createBeltTransportDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()

    const tickOne = await host.actions.getTickSnapshot(1)
    const tickSix = await host.actions.getTickSnapshot(6)

    expect(tickOne.status).toBe("ready")
    expect(tickSix.status).toBe("ready")
    if (tickSix.status !== "ready") {
      throw new Error("Expected tick six to be ready.")
    }

    expect(tickSix.snapshot.slots["device:source-storage/cache-group:item_storage.slot_1.output-view/slot:slot_1.out-view"]?.count).toBe(19)
    expect(tickSix.snapshot.slots["device:sink-storage/cache-group:item_storage.slot_1.output-view/slot:slot_1.out-view"]?.itemType).toBe("item_iron_ore")
    expect(tickSix.snapshot.slots["device:sink-storage/cache-group:item_storage.slot_1.output-view/slot:slot_1.out-view"]?.count).toBe(1)
    expect(tickSix.snapshot.transfers).toEqual([
      expect.objectContaining({
        edgeId: expect.stringContaining("device:belt/cache-group:item_output_buffer"),
        itemType: "item_iron_ore",
        amount: 1,
      }),
    ])

    host.dispose()
  })

  it("selects a matching production recipe from the machine recipe table", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createGrinderProductionDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const tickFive = await host.actions.getTickSnapshot(5)

    expect(tickFive.status).toBe("ready")
    if (tickFive.status !== "ready") {
      throw new Error("Expected tick five to be ready.")
    }

    expect(tickFive.snapshot.slots["device:grinder/cache-group:item_input_buffer/slot:input_slot_1"]?.count).toBe(0)
    expect(tickFive.snapshot.slots["device:grinder/cache-group:item_output_buffer/slot:output_slot_1"]?.itemType).toBe("item_iron_powder")
    expect(tickFive.snapshot.slots["device:grinder/cache-group:item_output_buffer/slot:output_slot_1"]?.count).toBe(1)
    expect(tickFive.snapshot.devices["device:grinder"]?.recipe).toBeNull()

    host.dispose()
  })

  it("synthesizes default buffers for an external-recipe production shell", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createFurnaceProductionDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const tickFive = await host.actions.getTickSnapshot(5)

    expect(tickFive.status).toBe("ready")
    if (tickFive.status !== "ready") {
      throw new Error("Expected tick five to be ready.")
    }

    expect(tickFive.snapshot.slots["device:furnace/cache-group:item_input_buffer/slot:input_slot_1"]?.count).toBe(0)
    expect(tickFive.snapshot.slots["device:furnace/cache-group:item_output_buffer/slot:output_slot_1"]?.itemType).toBe("item_iron_nugget")
    expect(tickFive.snapshot.slots["device:furnace/cache-group:item_output_buffer/slot:output_slot_1"]?.count).toBe(1)

    host.dispose()
  })

  it("exposes mobx-reactive state and tick snapshot through the host contract", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)
    const observedStates: string[] = []
    const observedTickNumbers: Array<number | null> = []
    const disposeStateReaction = autorun(() => {
      observedStates.push(host.state)
    })
    const disposeTickReaction = autorun(() => {
      observedTickNumbers.push(host.queries.getCurrentTickSnapshot()?.tickNumber ?? null)
    })

    await host.actions.start()
    await host.actions.getTickSnapshot(3)
    host.actions.pause()
    host.actions.stop()

    expect(observedStates).toEqual(["stop", "start", "pause", "stop"])
    expect(observedTickNumbers).toEqual([null, 3])

    disposeTickReaction()
    disposeStateReaction()
    host.dispose()
  })
})

function createWorkspace(documentSnapshot: WorldDocument): {
  workspace: WorkspaceContract;
  document: ReturnType<typeof createSnapshotStore<WorldDocument>>;
} {
  const document = createSnapshotStore(documentSnapshot)
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
  }

  return {
    workspace,
    document,
  }
}

function createFurnaceProductionDocument(): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "44444444-4444-4444-8444-444444444444",
    baseId: "wuling_protocol_core",
    meta: {
      id: "furnace-production-world",
      name: "Furnace Production World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: {
      furnace: {
        id: "furnace",
        definitionId: "item_port_furnance_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 1,
        },
        tags: [],
      },
    },
    entityOrder: ["furnace"],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  }
}

function createBeltTransportDocument(): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "22222222-2222-4222-8222-222222222222",
    baseId: "wuling_protocol_core",
    meta: {
      id: "belt-transport-world",
      name: "Belt Transport World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: {
      "source-storage": {
        id: "source-storage",
        definitionId: "item_port_storager_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 20,
        },
        tags: [],
      },
      belt: {
        id: "belt",
        definitionId: "belt_straight_1x1",
        position: { x: 0, y: -1 },
        rotation: 270,
        config: {},
        tags: [],
      },
      "sink-storage": {
        id: "sink-storage",
        definitionId: "item_port_storager_1",
        position: { x: 0, y: -4 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["source-storage", "belt", "sink-storage"],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  }
}

function createGrinderProductionDocument(): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "33333333-3333-4333-8333-333333333333",
    baseId: "wuling_protocol_core",
    meta: {
      id: "grinder-production-world",
      name: "Grinder Production World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
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
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  }
}

function createMovedDummyDocument(): WorldDocument {
  const document = createDummyWorldDocument()
  const entity = document.entities["dummy-entity-1"]

  if (entity === undefined) {
    throw new Error("Expected dummy belt entity to exist.")
  }

  document.entities[entity.id] = {
    ...entity,
    position: {
      x: entity.position.x + 1,
      y: entity.position.y,
    },
  }

  return document
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}