import { describe, expect, it } from "vitest"

import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
} from "@/domain/types/simulation"
import { advanceDevices } from "@/simulation/runtime/advance-devices"
import { settleRecipes } from "@/simulation/runtime/settle-recipes"
import type { SimulationMutableRuntimeState } from "@/simulation/runtime/runtime-state"

describe("advanceDevices", () => {
  it("writes immediate-consume outputs during the advance phase when the output cache can accept them", () => {
    const plan = createRecipePlan("immediate-consume")
    const topology = createTopology(plan)
    const state = createRuntimeState(plan, {
      ingredientCount: 0,
      productCount: 0,
      recipeType: "immediate-consume",
      inputItems: [{ itemType: "item_iron_ore", amount: 1 }],
      reservations: [],
    })

    advanceDevices(topology, state)

    expect(state.persistent.slots["slot:product"]).toEqual({
      itemType: "item_iron_ore",
      count: 1,
    })
    expect(state.persistent.devices["device:test"]?.recipe).toBeNull()
  })

  it("finishes reserved-item during advance when the output cache can accept it", () => {
    const plan = createRecipePlan("reserved-item")
    const topology = createTopology(plan)
    const state = createRuntimeState(plan, {
      ingredientCount: 1,
      productCount: 0,
      recipeType: "reserved-item",
      inputItems: [{ itemType: "item_iron_ore", amount: 1 }],
      reservations: [{
        slotId: "slot:ingredient",
        itemType: "item_iron_ore",
        amount: 1,
      }],
    })

    advanceDevices(topology, state)

    expect(state.persistent.devices["device:test"]?.recipe).toBeNull()
    expect(state.persistent.slots["slot:ingredient"]).toEqual({
      itemType: "item_iron_ore",
      count: 0,
    })
    expect(state.persistent.slots["slot:product"]).toEqual({
      itemType: "item_iron_ore",
      count: 1,
    })

    settleRecipes(topology, state)

    expect(state.persistent.devices["device:test"]?.recipe).toBeNull()
    expect(state.persistent.slots["slot:ingredient"]).toEqual({
      itemType: "item_iron_ore",
      count: 0,
    })
    expect(state.persistent.slots["slot:product"]).toEqual({
      itemType: "item_iron_ore",
      count: 1,
    })
  })
})

function createRecipePlan(recipeType: "immediate-consume" | "reserved-item"): CompiledSimulationRecipePlan {
  return {
    recipeId: `recipe:${recipeType}`,
    recipeType,
    durationTicks: 2,
    inputs: recipeType === "reserved-item"
      ? [{ itemId: "any", amount: 1 }]
      : [],
    outputs: [{ itemId: "same-as-input", amount: 1 }],
    ingredientCacheGroupIds: ["cache-group:ingredient"],
    productCacheGroupIds: ["cache-group:product"],
  }
}

function createTopology(plan: CompiledSimulationRecipePlan): CompiledSimulationTopology {
  const device: CompiledSimulationDevice = {
    id: "device:test",
    sourceEntityId: null,
    definitionId: "test-device",
    position: null,
    rotation: null,
    tags: [],
    transportClass: "anchor",
    cacheGroupIds: ["cache-group:ingredient", "cache-group:product"],
    portIds: [],
    recipePlan: plan,
    recipePlans: [plan],
    routing: {},
    configHash: "config-hash",
  }

  return {
    schemaVersion: 1,
    topologyId: "topology:test",
    documentKey: "document:test",
    documentHash: "document-hash",
    registryHash: "registry-hash",
    standardTickRate: 20,
    itemCatalog: {},
    devices: {
      [device.id]: device,
    },
    cacheGroups: {
      "cache-group:ingredient": {
        id: "cache-group:ingredient",
        deviceId: device.id,
        sourceStorageSlotGroupId: null,
        cacheType: "ingredient",
        slotIds: ["slot:ingredient"],
        inputPortIds: [],
        outputPortIds: [],
        groupOrder: 0,
      },
      "cache-group:product": {
        id: "cache-group:product",
        deviceId: device.id,
        sourceStorageSlotGroupId: null,
        cacheType: "product",
        slotIds: ["slot:product"],
        inputPortIds: [],
        outputPortIds: [],
        groupOrder: 1,
      },
    },
    slots: {
      "slot:ingredient": {
        id: "slot:ingredient",
        cacheGroupId: "cache-group:ingredient",
        sourceSlotId: null,
        capacity: 1,
        domain: "any",
        lock: null,
        initialItemType: "item_iron_ore",
        initialCount: 1,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
      "slot:product": {
        id: "slot:product",
        cacheGroupId: "cache-group:product",
        sourceSlotId: null,
        capacity: 3,
        domain: "any",
        lock: null,
        initialItemType: null,
        initialCount: 0,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
    },
    ports: {},
    links: {},
    physicalConnections: {},
    transferEdges: {},
    ordering: {
      deviceOrder: [device.id],
      cacheGroupOrder: ["cache-group:ingredient", "cache-group:product"],
      slotOrder: ["slot:ingredient", "slot:product"],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder: [],
    },
    diagnostics: [],
  }
}

function createRuntimeState(
  plan: CompiledSimulationRecipePlan,
  options: {
    ingredientCount: number;
    productCount: number;
    recipeType: "immediate-consume" | "reserved-item";
    inputItems: { itemType: string; amount: number }[];
    reservations: { slotId: string; itemType: string; amount: number }[];
  },
): SimulationMutableRuntimeState {
  return {
    tickNumber: 1,
    persistent: {
      slots: {
        "slot:ingredient": {
          itemType: options.ingredientCount > 0 ? "item_iron_ore" : "item_iron_ore",
          count: options.ingredientCount,
        },
        "slot:product": {
          itemType: options.productCount > 0 ? "item_iron_ore" : null,
          count: options.productCount,
        },
      },
      devices: {
        "device:test": {
          block: false,
          recipe: {
            runId: "run:test",
            recipeId: plan.recipeId,
            recipeType: options.recipeType,
            progressTicks: 1,
            durationTicks: plan.durationTicks,
            state: "running",
            plan,
            reservations: options.reservations,
            inputItems: options.inputItems,
          },
        },
      },
      routingCursors: {},
      proxyTargetSlotIdBySourceSlotId: {},
      sharedCapacitySlotIdsBySlotId: {},
      sharedCapacityLimitBySlotId: {},
      nextRecipeRunIndex: 1,
    },
    transient: {
      nodes: {},
      edges: {},
      transfers: [],
      diagnostics: [],
    },
  }
}