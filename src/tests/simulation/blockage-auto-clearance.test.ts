import { describe, expect, it } from "vitest";

import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
} from "@/simulation/types";
import type {
  RuntimeDeviceRecipeState,
  SimulationMutableRuntimeState,
} from "@/simulation/runtime/runtime-state";
import { applyBlockageAutoClearance } from "@/simulation/runtime/blockage-auto-clearance";

describe("blockage auto clearance", () => {
  it("clears configured slots once enough channels are waiting for output", () => {
    const topology = createTopology({
      enabled: true,
      blockedChannelThreshold: 2,
    });
    const state = createState({
      ch1: createWaitingOutputRecipe(),
      ch2: createWaitingOutputRecipe(),
    });

    applyBlockageAutoClearance(topology, state);

    expect(state.persistent.slots["slot:a"]).toEqual({
      itemType: null,
      count: 0,
    });
    expect(state.transient.reservedAmountByStorageSlotId).toBeNull();
  });

  it("does nothing when disabled or below threshold", () => {
    const disabledTopology = createTopology({
      enabled: false,
      blockedChannelThreshold: 1,
    });
    const belowThresholdTopology = createTopology({
      enabled: true,
      blockedChannelThreshold: 2,
    });

    const disabledState = createState({ ch1: createWaitingOutputRecipe() });
    applyBlockageAutoClearance(disabledTopology, disabledState);
    expect(disabledState.persistent.slots["slot:a"]).toEqual({
      itemType: "item_liquid_sewage",
      count: 500,
    });

    const belowThresholdState = createState({ ch1: createWaitingOutputRecipe() });
    applyBlockageAutoClearance(belowThresholdTopology, belowThresholdState);
    expect(belowThresholdState.persistent.slots["slot:a"]).toEqual({
      itemType: "item_liquid_sewage",
      count: 500,
    });
  });
});

function createTopology(options: {
  readonly enabled: boolean;
  readonly blockedChannelThreshold: number;
}): CompiledSimulationTopology {
  const device: Partial<CompiledSimulationDevice> = {
    id: "device:a",
    blockageAutoClearance: {
      enabled: options.enabled,
      channelIds: ["ch1", "ch2"],
      slotRefs: [{ storageSlotGroupId: "buffer", slotId: null }],
      blockedChannelThreshold: options.blockedChannelThreshold,
    },
  };
  const node: Partial<CompiledSimulationNode> = {
    id: "node:a",
    deviceId: "device:a",
  };
  const slot: Partial<CompiledSimulationSlot> = {
    id: "slot:a",
    nodeId: "node:a",
    sourceStorageSlotGroupId: "buffer",
    sourceSlotId: "slot_1",
  };

  return {
    ordering: {
      deviceOrder: ["device:a"],
    },
    devices: {
      "device:a": device,
    },
    nodes: {
      "node:a": node,
    },
    slots: {
      "slot:a": slot,
    },
  } as unknown as CompiledSimulationTopology;
}

function createState(
  channelRecipes: Record<string, RuntimeDeviceRecipeState | null>,
): SimulationMutableRuntimeState {
  return {
    persistent: {
      devices: {
        "device:a": {
          block: true,
          channelRecipes,
        },
      },
      slots: {
        "slot:a": {
          itemType: "item_liquid_sewage",
          count: 500,
        },
      },
      shareAllTargetSlotIdBySourceSlotId: {},
    },
    transient: {
      reservedAmountByStorageSlotId: {
        "slot:a": 2,
      },
    },
  } as unknown as SimulationMutableRuntimeState;
}

function createWaitingOutputRecipe(): RuntimeDeviceRecipeState {
  return {
    state: "waiting-output",
  } as unknown as RuntimeDeviceRecipeState;
}
