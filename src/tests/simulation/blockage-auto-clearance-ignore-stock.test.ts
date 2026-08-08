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

/**
 * 回归测试：扩容反应池自动清堵不应清除 ignoreStock=true 的槽位
 *
 * 复现 https://github.com/hsyhhssyy/IndustrialPlanner/issues/26
 *
 * Bug：applyBlockageAutoClearance → clearConfiguredSlots 清空槽位运行时状态
 * 时没有检查拓扑层的 ignoreStock。导致用户设为"无限"的原料被清空后，
 * 后续产物进入该槽位时被错误显示为无限。
 */
describe("扩容反应池自动清堵 - ignoreStock 保护", () => {
  const DEVICE_ID = "device:mix_pool_2";
  const SLOT_PREFIX = "node:shared_input_buffer/slot:";

  /** 创建含 ignoreStock 槽位的测试拓扑 */
  function createTopology(options: {
    readonly ignoreStockSlotIds: string[];
  }): CompiledSimulationTopology {
    const slotIds = options.ignoreStockSlotIds;

    const slots: Record<string, Partial<CompiledSimulationSlot>> = {};
    for (const slotId of slotIds) {
      slots[slotId] = {
        id: slotId,
        nodeId: "node:shared_input_buffer",
        sourceStorageSlotGroupId: "shared_input_buffer",
        sourceSlotId: slotId.replace(SLOT_PREFIX, ""),
        ignoreStock: true,
      };
    }
    // 额外添加一些非 infinite 槽位
    for (const extraId of ["slot_5", "slot_6", "slot_7", "slot_8"]) {
      const compiledId = `${SLOT_PREFIX}${extraId}`;
      if (!slots[compiledId]) {
        slots[compiledId] = {
          id: compiledId,
          nodeId: "node:shared_input_buffer",
          sourceStorageSlotGroupId: "shared_input_buffer",
          sourceSlotId: extraId,
          ignoreStock: false,
        };
      }
    }

    const device: Partial<CompiledSimulationDevice> = {
      id: DEVICE_ID,
      blockageAutoClearance: {
        enabled: true,
        channelIds: ["ch1", "ch2", "ch3"],
        slotRefs: [{ storageSlotGroupId: "shared_input_buffer", slotId: null }],
        blockedChannelThreshold: 2,
      },
      sourceEntityId: "reactor",
    };
    const node: Partial<CompiledSimulationNode> = {
      id: "node:shared_input_buffer",
      deviceId: DEVICE_ID,
    };
    // AI-REMOVED 2026-08-08:
    // Reason: CompiledSimulationSlot.nodeId 已改为 readonly，不可通过赋值修改。
    //   且每个 slot 在创建时已设置 nodeId: "node:shared_input_buffer"，此循环为冗余操作。
    // Trigger: TS2540: Cannot assign to 'nodeId' because it is a read-only property.
    // Evidence: src/simulation/types.ts:316 readonly nodeId
    // Replacement: None - slot 创建时已内联设置 nodeId。
    // Risk: Low
    // Human Review: Not Required
    //
    // Original code:
    // // 确保所有 slot 节点都引用同一个 node
    // for (const slot of Object.values(slots)) {
    //     slot.nodeId = "node:shared_input_buffer";
    // }

    return {
      ordering: {
        deviceOrder: [DEVICE_ID],
      },
      devices: {
        [DEVICE_ID]: device,
      },
      nodes: {
        "node:shared_input_buffer": node,
      },
      slots,
    } as unknown as CompiledSimulationTopology;
  }

  /** 创建包含 initial 槽位内容的运行时状态 */
  function createState(options: {
    readonly slotItems: Record<string, { itemType: string; count: number }>;
    readonly channelRecipes: Record<string, RuntimeDeviceRecipeState | null>;
  }): SimulationMutableRuntimeState {
    const persistentSlots: Record<string, { itemType: string | null; count: number }> = {};
    for (const [slotId, item] of Object.entries(options.slotItems)) {
      persistentSlots[slotId] = {
        itemType: item.itemType,
        count: item.count,
      };
    }

    return {
      persistent: {
        devices: {
          [DEVICE_ID]: {
            block: true,
            channelRecipes: options.channelRecipes,
          },
        },
        slots: persistentSlots,
        shareAllTargetSlotIdBySourceSlotId: {},
      },
      transient: {
        reservedAmountByStorageSlotId: {},
      },
    } as unknown as SimulationMutableRuntimeState;
  }

  function createWaitingOutputRecipe(): RuntimeDeviceRecipeState {
    return {
      state: "waiting-output",
    } as unknown as RuntimeDeviceRecipeState;
  }

  it("不清除 ignoreStock=true 的槽位内容", () => {
    const infiniteSlot1 = `${SLOT_PREFIX}slot_1`;
    const infiniteSlot2 = `${SLOT_PREFIX}slot_2`;
    const normalSlot5 = `${SLOT_PREFIX}slot_5`;

    const topology = createTopology({
      ignoreStockSlotIds: [infiniteSlot1, infiniteSlot2],
    });

    const state = createState({
      slotItems: {
        [infiniteSlot1]: { itemType: "item_xiranite_powder", count: 10 },
        [infiniteSlot2]: { itemType: "item_liquid_water", count: 10 },
        [normalSlot5]: { itemType: "item_liquid_xiranite", count: 50 },
      },
      channelRecipes: {
        ch1: createWaitingOutputRecipe(),
        ch2: createWaitingOutputRecipe(),
        ch3: null,
      },
    });

    applyBlockageAutoClearance(topology, state);

    // ignoreStock=true 的槽位不应被清除
    expect(state.persistent.slots[infiniteSlot1]).toEqual({
      itemType: "item_xiranite_powder",
      count: 10,
    });
    expect(state.persistent.slots[infiniteSlot2]).toEqual({
      itemType: "item_liquid_water",
      count: 10,
    });

    // ignoreStock=false 的普通槽位应被清除（当前行为，作为对照）
    expect(state.persistent.slots[normalSlot5]).toEqual({
      itemType: null,
      count: 0,
    });
  });

  it("ignoreStock 槽位初始为空时不应报错（边界条件）", () => {
    const infiniteSlot1 = `${SLOT_PREFIX}slot_1`;
    const topology = createTopology({
      ignoreStockSlotIds: [infiniteSlot1],
    });

    const state = createState({
      slotItems: {
        // infiniteSlot1 初始为空
      },
      channelRecipes: {
        ch1: createWaitingOutputRecipe(),
        ch2: createWaitingOutputRecipe(),
      },
    });

    // 不应抛出异常
    expect(() => applyBlockageAutoClearance(topology, state)).not.toThrow();

    // 空槽保持空
    expect(state.persistent.slots[infiniteSlot1]).toBeUndefined();
  });
});
