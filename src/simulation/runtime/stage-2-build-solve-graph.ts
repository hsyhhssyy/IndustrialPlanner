import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { createEmptyTransientState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

/**
 * 对应《仿真运行原理》§5.2 Tick 阶段 2 与 §7.1 生成求解图。
 * 这里只生成本 tick 临时求解状态：Node 的占用排除集、Edge 的 shadowPull/shadowPush
 * 初始 uncertain 状态。真实库存和准入口计数仍保留在 persistent state。
 */
export function buildSolveGraph(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  // 保留前一阶段的 recipeStatsDelta，避免被 createEmptyTransientState 清空
  const preservedDelta = state.transient.recipeStatsDelta;
  const preservedReservedAmounts = state.transient.reservedAmountByStorageSlotId;
  const preservedPerf = state.transient._perf;
  state.transient = createEmptyTransientState();
  state.transient.recipeStatsDelta = preservedDelta;
  state.transient.reservedAmountByStorageSlotId = preservedReservedAmounts;
  state.transient._perf = preservedPerf;

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
      // AI-REMOVED 2026-06-12:
      // Reason: currentThroughCount 是单 tick 临时限流状态，准入口上限改为 persistent admission counter。
      // Trigger: 用户要求删除 per tick count。
      // Evidence: RuntimeTickEdgeState.currentThroughCount 已注释化删除。
      // Replacement: state.persistent.admissionCounters。
      // Risk: Medium - stage-3 必须在实际搬运成功后增加 admission counter。
      // Human Review: Required
      //
      // Original code:
      // currentThroughCount: 0,
      sourceSlotId: null,
      targetSlotId: null,
      itemType: null,
      amount: 0,
    };
  }
}
