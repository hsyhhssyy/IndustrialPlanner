import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { createEmptyTransientState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.2 Tick 阶段 2 与 §7.1 生成求解图。
 * 这里只生成本 tick 临时求解状态：Node 的占用排除集、Edge 的 shadowPull/shadowPush
 * 初始 uncertain 状态，以及 edge 本 tick 通过量计数。真实库存仍保留在 persistent slots。
 */
export function buildSolveGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  state.transient = createEmptyTransientState();

  for (const nodeId of topology.ordering.nodeOrder) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    const excludedItemTypes = new Set<string>();
    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const itemType = state.persistent.slots[storageSlotId]?.itemType ?? null;
      if (itemType !== null) {
        excludedItemTypes.add(itemType);
      }
    }

    state.transient.nodes[nodeId] = {
      nodeId,
      result: "uncertain",
      resolveState: "unresolved",
      excludedItemTypes: [...excludedItemTypes].sort(),
      acceptedInputEdgeIds: [],
      acceptedOutputEdgeIds: [],
    };
  }

  for (const edgeId of topology.ordering.edgeOrder) {
    state.transient.edges[edgeId] = {
      edgeId,
      shadowPull: "uncertain",
      shadowPush: "uncertain",
      currentThroughCount: 0,
      sourceSlotId: null,
      targetSlotId: null,
      itemType: null,
      amount: 0,
    };
  }
}
