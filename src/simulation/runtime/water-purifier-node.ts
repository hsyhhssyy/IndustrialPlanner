import type { CompiledSimulationDevice, CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

export function applyWaterPurifierManualOutput(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  standardStepTicks: number,
  powerMode: "real" | "infinite",
  currentPowerGeneration: number,
  effectiveTotalPowerDemand: number,
): void {
  const stepTicks = Math.max(1, Math.trunc(standardStepTicks));
  const powerInsufficient = powerMode === "real"
    && currentPowerGeneration < effectiveTotalPowerDemand;

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined || !canManualOutputRun(device, powerInsufficient)) {
      continue;
    }

    const config = device.waterPurifierNode;
    if (
      config === undefined
      || config === null
      || config.outputMode !== "manual-rate"
      || config.manualOutputPerMinute <= 0
    ) {
      continue;
    }

    const perStandardTick = config.manualOutputPerMinute / (topology.standardTickRate * 60);
    const total = (state.persistent.waterPurifierManualRemainders[deviceId] ?? 0)
      + perStandardTick * stepTicks;
    const amount = Math.floor(total);
    state.persistent.waterPurifierManualRemainders[deviceId] = total - amount;
    if (amount <= 0) {
      continue;
    }

    const produced = produceIntoWaterPurifierOutput(topology, state, device, amount);
    if (produced > 0 && device.isProducer) {
      state.transient.recipeStatsDelta.produced[config.outputItemId] =
        (state.transient.recipeStatsDelta.produced[config.outputItemId] ?? 0) + produced;
    }
  }
}

function canManualOutputRun(
  device: CompiledSimulationDevice,
  powerInsufficient: boolean,
): boolean {
  if (device.powerStatus === "out-of-power-range") {
    return false;
  }
  if (powerInsufficient && device.requiresPower) {
    return false;
  }
  return true;
}

function produceIntoWaterPurifierOutput(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  amount: number,
): number {
  const config = device.waterPurifierNode;
  if (config === undefined || config === null) {
    return 0;
  }

  const compiledSlot = Object.values(topology.slots)
    .filter((slot) => {
      const node = topology.nodes[slot.nodeId];
      return node?.deviceId === device.id
        && slot.sourceStorageSlotGroupId === config.outputStorageGroupId
        && slot.sourceSlotId === config.outputSlotId;
    })
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (compiledSlot === undefined) {
    return 0;
  }

  const storageSlotId = resolveStorageSlotId(state, compiledSlot.id);
  const slotState = state.persistent.slots[storageSlotId];
  if (slotState === undefined) {
    return 0;
  }
  if (slotState.itemType !== null && slotState.itemType !== config.outputItemId) {
    return 0;
  }

  const available = Math.max(0, compiledSlot.capacity - slotState.count);
  const accepted = Math.min(amount, available);
  if (accepted <= 0) {
    return 0;
  }

  slotState.itemType = slotState.itemType ?? config.outputItemId;
  slotState.count += accepted;
  return accepted;
}
