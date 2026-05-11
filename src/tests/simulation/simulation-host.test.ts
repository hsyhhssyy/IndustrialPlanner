import { autorun } from "mobx"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import type { WorldDocument } from "@/domain/document/world-document"
import { createWorkspaceState } from "@/domain/document/workspace-state"
import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store"
import { createSimulationHost } from "@/simulation/simulation-host"
import {
  STANDARD_TICK_RATE_PER_SECOND,
} from "@/simulation/tick-rate"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createSimulationHost", () => {
  const transportRecipeDurationTicks = STANDARD_TICK_RATE_PER_SECOND
  const transportRecipeCompletionTick = transportRecipeDurationTicks + 1
  const transportDeliveryTick = transportRecipeDurationTicks + 2

  it("keeps the compiled topology on the simulation owner host", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    expect(host.state.runningState).toBe("stop")
    expect(host.topology.getSnapshot()).toBeNull()
    expect(host.internalState.currentSnapshot).toBeNull()

    await host.actions.start()
    const topology = host.topology.getSnapshot()

    expect(host.state.runningState).toBe("start")
    expect(topology).not.toBeNull()
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)
    expect(host.internalState.runtimeStatus.topologyId).toBe(topology?.topologyId ?? null)
    expect(workspace.simulation).toBe(host)

    host.dispose()
  })

  it("updates the public simulation state through start pause resume and stop actions", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    expect(host.state.runningState).toBe("stop")

    await host.actions.start()
    expect(host.state.runningState).toBe("start")

    host.actions.pause()
    expect(host.state.runningState).toBe("pause")

    host.actions.resume()
    expect(host.state.runningState).toBe("start")

    host.actions.stop()
    expect(host.state.runningState).toBe("stop")

    host.dispose()
  })

  it("resumes playback from the paused tick without recompiling the simulation", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    await host.internalActions.syncToTick(0)

    await host.actions.advancePlaybackByDeltaMs(500)
    const firstAdvancedTickNumber = host.internalState.currentSnapshot?.tickNumber ?? null

    expect(firstAdvancedTickNumber).not.toBeNull()

    const topologyBeforePause = host.topology.getSnapshot()

    host.actions.pause()
    expect(host.state.runningState).toBe("pause")
    await host.actions.advancePlaybackByDeltaMs(500)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(firstAdvancedTickNumber)

    host.actions.resume()
    expect(host.state.runningState).toBe("start")

    await host.actions.advancePlaybackByDeltaMs(500)
    const secondAdvancedTickNumber = host.internalState.currentSnapshot?.tickNumber ?? null

    expect(host.topology.getSnapshot()).toBe(topologyBeforePause)
    expect(secondAdvancedTickNumber).toBeGreaterThan(firstAdvancedTickNumber ?? -1)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(secondAdvancedTickNumber)

    host.dispose()
  })

  it("advances playback by delta ms and only pulls a new tick after crossing an integer boundary", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    expect(host.state.simulationSpeed).toBe(1)

    host.internalActions.setSimulationSpeed(0.1)
    expect(host.state.simulationSpeed).toBe(0.1)

    await host.actions.advancePlaybackByDeltaMs(250)

    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)

    await host.actions.advancePlaybackByDeltaMs(250)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(1)

    await host.actions.advancePlaybackByDeltaMs(500)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(2)

    host.dispose()
  })

  it("refreshes the exposed topology after document recompilation", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace, document } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const firstTickStatus = await host.internalActions.syncToTick(0)
    const firstTopology = host.topology.getSnapshot()

    expect(firstTickStatus.status).toBe("ready")
    expect(firstTopology).not.toBeNull()
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)

    document.setSnapshot(createMovedDummyDocument())
    await flushMicrotasks(8)

    const secondTopology = host.topology.getSnapshot()

    expect(secondTopology).not.toBeNull()
    expect(secondTopology?.topologyId).not.toBe(firstTopology?.topologyId)
    expect(secondTopology?.documentHash).not.toBe(firstTopology?.documentHash)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)

    host.dispose()
  })

  it("keeps the existing topology when only documentSettings change", async () => {
    vi.stubGlobal("Worker", undefined)

    const initialDocument = createDummyWorldDocument()
    const { workspace, document } = createWorkspace(initialDocument)
    const host = createSimulationHost(workspace)

    await host.actions.start()
    await host.internalActions.syncToTick(3)

    const topologyBeforeSettingsChange = host.topology.getSnapshot()
    const tickBeforeSettingsChange = host.internalState.currentSnapshot

    expect(topologyBeforeSettingsChange).not.toBeNull()
    expect(tickBeforeSettingsChange?.tickNumber).toBe(3)

    document.setSnapshot({
      ...initialDocument,
      documentSettings: {
        ...initialDocument.documentSettings,
        viewport: {
          ...initialDocument.documentSettings.viewport,
          center: {
            x: 12,
            y: -8,
          },
          gridSize: 2,
        },
        showDiagnostics: true,
      },
    })
    await flushMicrotasks(8)

    expect(host.topology.getSnapshot()).toBe(topologyBeforeSettingsChange)
    expect(host.internalState.currentSnapshot).toBe(tickBeforeSettingsChange)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(3)

    host.dispose()
  })

  it("rolls back playback progress when the target tick is not ready", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    host.internalActions.setSimulationSpeed(9)

    await host.actions.advancePlaybackByDeltaMs(1000)
    await host.actions.advancePlaybackByDeltaMs(1000)

    expect(host.internalState.currentPlaybackTickNumber).toBe(0)
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)

    host.dispose()
  })

  it("snaps playback forward when it asks for a tick already cleared by the worker", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const retainedTick = await host.internalActions.syncToTick(50)

    expect(retainedTick.status).toBe("ready")
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(50)
    expect(host.internalState.currentPlaybackTickNumber).toBe(0)

    await host.actions.advancePlaybackByDeltaMs(1000 / STANDARD_TICK_RATE_PER_SECOND)

    expect(host.internalState.currentSnapshot?.tickNumber).toBe(50)
    expect(host.internalState.currentPlaybackTickNumber).toBe(50)

    await host.actions.advancePlaybackByDeltaMs(1000 / STANDARD_TICK_RATE_PER_SECOND)

    expect(host.internalState.currentSnapshot?.tickNumber).toBe(51)
    expect(host.internalState.currentPlaybackTickNumber).toBe(51)

    host.dispose()
  })

  it("does nothing when playback advances outside the start state", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    host.internalActions.setSimulationSpeed(4)

    await host.actions.advancePlaybackByDeltaMs(1000)

    expect(host.internalState.currentSnapshot).toBeNull()

    await host.actions.start()
    const tickZero = await host.internalActions.syncToTick(0)

    expect(tickZero.status).toBe("ready")

    host.actions.pause()
    await host.actions.advancePlaybackByDeltaMs(1000)

    expect(host.internalState.currentSnapshot?.tickNumber).toBe(0)

    host.actions.stop()
    await host.actions.advancePlaybackByDeltaMs(1000)

    expect(host.internalState.currentSnapshot).toBeNull()

    host.dispose()
  })

  it("stores the last extracted tick snapshot as the current tick", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()

    const tickZero = await host.internalActions.syncToTick(0)
    const tickFive = await host.internalActions.syncToTick(5)

    expect(tickZero.status).toBe("ready")
    expect(tickFive.status).toBe("ready")
    expect(host.internalState.currentSnapshot?.tickNumber).toBe(5)

    host.dispose()
  })

  it("projects a device runtime read model by world document id", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createGrinderProductionDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const tickOne = await host.internalActions.syncToTick(1)
    const grinderStatusAtRequestedTick = host.queries.getDeviceRuntimeStatus("grinder")

    expect(tickOne.status).toBe("ready")
    expect(host.queries.getDeviceRuntimeStatus("missing-device")).toBeNull()
    expect(grinderStatusAtRequestedTick).toEqual(expect.objectContaining({
      slotItems: expect.arrayContaining([
        expect.objectContaining({
          storageGroupId: "item_input_buffer",
          slotId: "input_slot_1",
        }),
        expect.objectContaining({
          storageGroupId: "item_output_buffer",
          slotId: "output_slot_1",
        }),
      ]),
    }))

    await host.internalActions.syncToTick(transportRecipeCompletionTick)

    expect(host.queries.getDeviceRuntimeStatus("grinder")).toEqual(expect.objectContaining({
      recipeId: null,
      progressSeconds: null,
      desiredSeconds: null,
      slotItems: expect.arrayContaining([
        expect.objectContaining({
          storageGroupId: "item_input_buffer",
          slotId: "input_slot_1",
        }),
        expect.objectContaining({
          storageGroupId: "item_output_buffer",
          slotId: "output_slot_1",
          itemType: "item_iron_powder",
          count: 1,
        }),
      ]),
    }))

    host.dispose()
  })

  it("projects runtime status across a belt transport topology", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createBeltTransportDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()

    const tickOne = await host.internalActions.syncToTick(1)
    const beltStatusAtTickOne = host.queries.getDeviceRuntimeStatus("belt")
    const deliveredTick = await host.internalActions.syncToTick(transportDeliveryTick)

    expect(tickOne.status).toBe("ready")
    expect(deliveredTick.status).toBe("ready")
    if (deliveredTick.status !== "ready") {
      throw new Error("Expected delivered tick to be ready.")
    }

    expect(host.queries.getDeviceRuntimeStatus("source-storage")?.slotItems).toHaveLength(6)
    expect(beltStatusAtTickOne?.slotItems).toHaveLength(2)
    expect(beltStatusAtTickOne?.slotItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotType: "ingredient",
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "input-view",
      }),
      expect.objectContaining({
        slotType: "product",
        storageGroupId: "item_buffer",
        slotId: "slot_1",
        viewRole: "output-view",
      }),
    ]))
    expect(host.queries.getDeviceRuntimeStatus("belt")?.recipeId).not.toBeNull()
    expect(host.queries.getDeviceRuntimeStatus("sink-storage")?.slotItems).toHaveLength(6)

    host.dispose()
  })

  it("exposes resolved buffer slots for an external-recipe production shell", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createFurnaceProductionDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const completedTick = await host.internalActions.syncToTick(transportRecipeCompletionTick)

    expect(completedTick.status).toBe("ready")
    if (completedTick.status !== "ready") {
      throw new Error("Expected completed tick to be ready.")
    }

    expect(host.queries.getDeviceRuntimeStatus("furnace")).toEqual(expect.objectContaining({
      recipeId: null,
      progressSeconds: null,
      desiredSeconds: null,
      slotItems: expect.arrayContaining([
        expect.objectContaining({
          storageGroupId: "item_input_buffer",
          slotId: "input_item_slot_1",
          itemType: null,
          count: 0,
        }),
        expect.objectContaining({
          storageGroupId: "item_output_buffer",
          slotId: "output_item_slot_1",
          itemType: "item_iron_nugget",
          count: 1,
        }),
      ]),
    }))

    host.dispose()
  })

  it("exposes mobx-reactive state and runtime json through the host contract", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)
    const observedStates: string[] = []
    const observedRuntimeJson: string[] = []
    const disposeStateReaction = autorun(() => {
      observedStates.push(host.state.runningState)
    })
    const disposeTickReaction = autorun(() => {
      observedRuntimeJson.push(String(host.queries.getStatusRuntimeJson()))
    })

    await host.actions.start()
    await host.internalActions.syncToTick(3)
    host.actions.pause()
    host.actions.stop()

    expect(observedStates).toEqual(["stop", "start", "pause", "stop"])
  expect(observedRuntimeJson[0]).toContain('"runningState":"stop"')
  expect(observedRuntimeJson.some((value) => value.includes('"tickNumber":3'))).toBe(true)

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
    slotLinks: [],
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
      },
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
    slotLinks: [],
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
      },
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
    slotLinks: [],
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
      },
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
