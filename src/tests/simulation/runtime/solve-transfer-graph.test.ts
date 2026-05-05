import { describe, expect, it } from "vitest"

import type { CompiledSimulationTopology } from "@/domain/types/simulation"
import { buildSolveGraph } from "@/simulation/runtime/build-solve-graph"
import { moveItems } from "@/simulation/runtime/move-items"
import { resetTickState } from "@/simulation/runtime/reset-tick-state"
import {
  createSimulationMutableRuntimeState,
  type SimulationMutableRuntimeState,
} from "@/simulation/runtime/runtime-state"
import { solveTransferGraph } from "@/simulation/runtime/solve-transfer-graph"

describe("solveTransferGraph", () => {
  it("commits an accepted edge immediately so later edges see refreshed capacity", () => {
    const topology = createImmediateCommitTopology([
      "edge:belt-to-sink",
      "edge:source-to-belt",
    ])
    const state = createRuntimeState(topology)

    resetTickState(topology, state)
    buildSolveGraph(topology, state)

    expect(state.transient.nodes["cache-group:belt.in"]?.isDeleted).toBe(true)
    expect(state.transient.edges["edge:source-to-belt"]?.isDeleted).toBe(true)

    solveTransferGraph(topology, state)

    expect(state.transient.transfers).toEqual([
      {
        edgeId: "edge:belt-to-sink",
        sourceSlotId: "slot:belt.out",
        targetSlotId: "slot:sink.in",
        itemType: "item_iron_ore",
        amount: 1,
      },
      {
        edgeId: "edge:source-to-belt",
        sourceSlotId: "slot:source.out",
        targetSlotId: "slot:belt.in",
        itemType: "item_iron_ore",
        amount: 1,
      },
    ])
    expect(state.transient.edges["edge:source-to-belt"]).toEqual(expect.objectContaining({
      isDeleted: false,
      shadowPull: "accept",
      shadowPush: "accept",
      amount: 1,
    }))
    expect(state.persistent.slots["slot:source.out"]).toEqual({
      itemType: "item_iron_ore",
      count: 0,
    })
    expect(state.persistent.slots["slot:belt.in"]).toEqual({
      itemType: "item_iron_ore",
      count: 1,
    })
    expect(state.persistent.slots["slot:belt.out"]).toEqual({
      itemType: "item_iron_ore",
      count: 0,
    })
    expect(state.persistent.slots["slot:sink.in"]).toEqual({
      itemType: "item_iron_ore",
      count: 1,
    })

    moveItems(topology, state)

    expect(state.persistent.slots["slot:source.out"]?.count).toBe(0)
    expect(state.persistent.slots["slot:belt.in"]?.count).toBe(1)
    expect(state.persistent.slots["slot:belt.out"]?.count).toBe(0)
    expect(state.persistent.slots["slot:sink.in"]?.count).toBe(1)
  })

  it("retries an earlier upstream edge after a downstream commit frees capacity", () => {
    const topology = createImmediateCommitTopology([
      "edge:source-to-belt",
      "edge:belt-to-sink",
    ])
    const state = createRuntimeState(topology)

    resetTickState(topology, state)
    buildSolveGraph(topology, state)

    expect(state.transient.nodes["cache-group:belt.in"]?.isDeleted).toBe(true)
    expect(state.transient.edges["edge:source-to-belt"]?.isDeleted).toBe(true)

    solveTransferGraph(topology, state)

    expect(state.transient.transfers).toEqual([
      {
        edgeId: "edge:belt-to-sink",
        sourceSlotId: "slot:belt.out",
        targetSlotId: "slot:sink.in",
        itemType: "item_iron_ore",
        amount: 1,
      },
      {
        edgeId: "edge:source-to-belt",
        sourceSlotId: "slot:source.out",
        targetSlotId: "slot:belt.in",
        itemType: "item_iron_ore",
        amount: 1,
      },
    ])
    expect(state.transient.edges["edge:source-to-belt"]).toEqual(expect.objectContaining({
      isDeleted: false,
      shadowPull: "accept",
      shadowPush: "accept",
      amount: 1,
    }))
  })
})

function createRuntimeState(topology: CompiledSimulationTopology): SimulationMutableRuntimeState {
  return createSimulationMutableRuntimeState(topology)
}

function createImmediateCommitTopology(edgeOrder: string[]): CompiledSimulationTopology {
  return {
    schemaVersion: 1,
    topologyId: "topology:immediate-commit",
    documentKey: "document:immediate-commit",
    documentHash: "document-hash",
    registryHash: "registry-hash",
    standardTickRate: 20,
    itemCatalog: {
      item_iron_ore: {
        id: "item_iron_ore",
        domain: "solid",
        tags: [],
      },
    },
    devices: {
      "device:source": createDevice("device:source", ["cache-group:source.out"]),
      "device:belt": createDevice("device:belt", ["cache-group:belt.in", "cache-group:belt.out"]),
      "device:sink": createDevice("device:sink", ["cache-group:sink.in"]),
    },
    cacheGroups: {
      "cache-group:source.out": {
        id: "cache-group:source.out",
        deviceId: "device:source",
        sourceStorageSlotGroupId: null,
        cacheType: "product",
        slotIds: ["slot:source.out"],
        inputPortIds: [],
        outputPortIds: ["port:source.out"],
        groupOrder: 0,
      },
      "cache-group:belt.in": {
        id: "cache-group:belt.in",
        deviceId: "device:belt",
        sourceStorageSlotGroupId: null,
        cacheType: "ingredient",
        slotIds: ["slot:belt.in"],
        inputPortIds: ["port:belt.in"],
        outputPortIds: [],
        groupOrder: 1,
      },
      "cache-group:belt.out": {
        id: "cache-group:belt.out",
        deviceId: "device:belt",
        sourceStorageSlotGroupId: null,
        cacheType: "product",
        slotIds: ["slot:belt.out"],
        inputPortIds: [],
        outputPortIds: ["port:belt.out"],
        groupOrder: 2,
      },
      "cache-group:sink.in": {
        id: "cache-group:sink.in",
        deviceId: "device:sink",
        sourceStorageSlotGroupId: null,
        cacheType: "ingredient",
        slotIds: ["slot:sink.in"],
        inputPortIds: ["port:sink.in"],
        outputPortIds: [],
        groupOrder: 3,
      },
    },
    slots: {
      "slot:source.out": {
        id: "slot:source.out",
        cacheGroupId: "cache-group:source.out",
        sourceSlotId: null,
        capacity: 1,
        domain: "solid",
        lock: null,
        initialItemType: "item_iron_ore",
        initialCount: 1,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
      "slot:belt.in": {
        id: "slot:belt.in",
        cacheGroupId: "cache-group:belt.in",
        sourceSlotId: null,
        capacity: 1,
        domain: "solid",
        lock: null,
        initialItemType: null,
        initialCount: 0,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
      "slot:belt.out": {
        id: "slot:belt.out",
        cacheGroupId: "cache-group:belt.out",
        sourceSlotId: null,
        capacity: 1,
        domain: "solid",
        lock: null,
        initialItemType: "item_iron_ore",
        initialCount: 1,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
      "slot:sink.in": {
        id: "slot:sink.in",
        cacheGroupId: "cache-group:sink.in",
        sourceSlotId: null,
        capacity: 2,
        domain: "solid",
        lock: null,
        initialItemType: null,
        initialCount: 0,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
    },
    ports: {},
    links: {
      "link:belt": {
        id: "link:belt",
        linkType: "share-cap",
        sourceSlotIds: ["slot:belt.in"],
        targetSlotIds: ["slot:belt.out"],
        targetSlotIdBySourceSlotId: {
          "slot:belt.in": "slot:belt.out",
        },
      },
    },
    physicalConnections: {},
    transferEdges: {
      "edge:belt-to-sink": {
        id: "edge:belt-to-sink",
        physicalConnectionId: "physical:belt-to-sink",
        sourcePortId: "port:belt.out",
        targetPortId: "port:sink.in",
        sourceCacheGroupId: "cache-group:belt.out",
        targetCacheGroupId: "cache-group:sink.in",
        acceptRule: { base: { kind: "any" }, exclude: [] },
        count: 1,
      },
      "edge:source-to-belt": {
        id: "edge:source-to-belt",
        physicalConnectionId: "physical:source-to-belt",
        sourcePortId: "port:source.out",
        targetPortId: "port:belt.in",
        sourceCacheGroupId: "cache-group:source.out",
        targetCacheGroupId: "cache-group:belt.in",
        acceptRule: { base: { kind: "any" }, exclude: [] },
        count: 1,
      },
    },
    ordering: {
      deviceOrder: ["device:source", "device:belt", "device:sink"],
      cacheGroupOrder: [
        "cache-group:source.out",
        "cache-group:belt.in",
        "cache-group:belt.out",
        "cache-group:sink.in",
      ],
      slotOrder: ["slot:source.out", "slot:belt.in", "slot:belt.out", "slot:sink.in"],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder,
    },
    diagnostics: [],
  }
}

function createDevice(id: string, cacheGroupIds: string[]) {
  return {
    id,
    sourceEntityId: null,
    definitionId: id,
    position: null,
    rotation: null,
    tags: [],
    transportClass: "anchor" as const,
    cacheGroupIds,
    portIds: [],
    recipePlan: null,
    recipePlans: [],
    routing: {},
    configHash: `${id}:config`,
  }
}