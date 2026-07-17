import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeGasDiffusionSnapshot,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import {
  areGridRectsIntersecting,
} from "@/shared/geometry/power-range";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import {
  isDeviceElectricallyPowered,
  isMeteredConsumptionAuthorized,
} from "./metered-consumption";

interface GasDiffusionTopologyIndex {
  readonly sourceDeviceIds: readonly string[];
  readonly recipeSourceDeviceIds: readonly string[];
}

interface GasDiffusionRuntimeIndex {
  readonly topology: CompiledSimulationTopology;
  readonly topologyIndex: GasDiffusionTopologyIndex;
  activeGasDiffusions: readonly RuntimeGasDiffusionSnapshot[];
  coveredGasItemIdsByDeviceId: ReadonlyMap<string, ReadonlySet<string>>;
}

const EMPTY_GAS_DIFFUSIONS: readonly RuntimeGasDiffusionSnapshot[] = [];
const EMPTY_DEVICE_GAS_COVERAGE: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const topologyIndexByTopology = new WeakMap<CompiledSimulationTopology, GasDiffusionTopologyIndex>();
const runtimeIndexByState = new WeakMap<SimulationMutableRuntimeState, GasDiffusionRuntimeIndex>();

/**
 * AI-CORRECTION 2026-07-17：气体范围改为按潜在气体源稀疏观察，并在来源集合变化时重建设备覆盖索引。
 * 派生索引通过 WeakMap 绑定运行时状态，不进入每 tick 的深拷贝；拓扑迁移或状态恢复会自然创建新索引。
 */
export function computeActiveGasDiffusions(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly RuntimeGasDiffusionSnapshot[] {
  return ensureGasDiffusionRuntimeIndex(topology, state).activeGasDiffusions;
}

/** 气体配方的首轮启动只需要访问这些设备，普通设备不应为此被重复扫描。 */
export function getGasDiffusionRecipeSourceDeviceIds(
  topology: CompiledSimulationTopology,
): readonly string[] {
  return ensureGasDiffusionTopologyIndex(topology).recipeSourceDeviceIds;
}

export function isDeviceInRequiredGasDiffusion(options: {
  readonly topology: CompiledSimulationTopology;
  readonly state: SimulationMutableRuntimeState;
  readonly device: CompiledSimulationDevice;
  readonly requiredGasDiffusion: string | null;
}): boolean {
  if (options.requiredGasDiffusion === null) {
    return true;
  }

  const runtimeIndex = ensureGasDiffusionRuntimeIndex(options.topology, options.state);
  return runtimeIndex.coveredGasItemIdsByDeviceId
    .get(options.device.id)
    ?.has(options.requiredGasDiffusion) ?? false;
}

function ensureGasDiffusionRuntimeIndex(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): GasDiffusionRuntimeIndex {
  const topologyIndex = ensureGasDiffusionTopologyIndex(topology);
  let runtimeIndex = runtimeIndexByState.get(state);
  if (runtimeIndex === undefined || runtimeIndex.topology !== topology) {
    runtimeIndex = {
      topology,
      topologyIndex,
      activeGasDiffusions: EMPTY_GAS_DIFFUSIONS,
      coveredGasItemIdsByDeviceId: EMPTY_DEVICE_GAS_COVERAGE,
    };
    runtimeIndexByState.set(state, runtimeIndex);
  }

  if (topologyIndex.sourceDeviceIds.length === 0) {
    return runtimeIndex;
  }

  const observedGasDiffusions = collectActiveGasDiffusions(
    topology,
    state,
    topologyIndex.sourceDeviceIds,
  );
  if (areGasDiffusionSnapshotsEqual(runtimeIndex.activeGasDiffusions, observedGasDiffusions)) {
    return runtimeIndex;
  }

  runtimeIndex.activeGasDiffusions = observedGasDiffusions;
  runtimeIndex.coveredGasItemIdsByDeviceId = buildDeviceGasCoverage(
    topology,
    observedGasDiffusions,
  );
  return runtimeIndex;
}

function ensureGasDiffusionTopologyIndex(
  topology: CompiledSimulationTopology,
): GasDiffusionTopologyIndex {
  const cached = topologyIndexByTopology.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const recipeSourceDefinitionIds = new Set(
    Object.values(topology.recipeCatalog)
      .filter((recipe) => recipe.gasDiffusionOutput !== null)
      .map((recipe) => recipe.machineId),
  );
  const recipeSourceDeviceIds: string[] = [];
  const sourceDeviceIds: string[] = [];

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const canRunGasDiffusionRecipe = recipeSourceDefinitionIds.has(device.definitionId)
      && (device.recipeChannels ?? []).length > 0;
    if (canRunGasDiffusionRecipe) {
      recipeSourceDeviceIds.push(deviceId);
    }
    if (
      canRunGasDiffusionRecipe
      || (
        device.meteredConsumption !== undefined
        && device.meteredConsumption !== null
        && device.meteredConsumption.gasDiffusionRange !== null
      )
    ) {
      sourceDeviceIds.push(deviceId);
    }
  }

  const result = { sourceDeviceIds, recipeSourceDeviceIds };
  topologyIndexByTopology.set(topology, result);
  return result;
}

function collectActiveGasDiffusions(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  sourceDeviceIds: readonly string[],
): readonly RuntimeGasDiffusionSnapshot[] {
  const result: RuntimeGasDiffusionSnapshot[] = [];

  for (const deviceId of sourceDeviceIds) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    if (!isDeviceElectricallyPowered(device, state)) {
      continue;
    }

    const metered = device.meteredConsumption;
    const meteredState = state.persistent.meteredConsumptions[device.id];
    if (
      metered !== undefined
      && metered !== null
      && metered.gasDiffusionRange !== null
      && meteredState?.activeEffectItemId !== null
      && meteredState?.activeEffectItemId !== undefined
      && isMeteredConsumptionAuthorized(device, state)
    ) {
      const gridRect = resolveDeviceCenteredRangeRect(device, metered.gasDiffusionRange);
      if (gridRect !== null) {
        result.push({
          sourceDeviceId: device.id,
          gasItemId: meteredState.activeEffectItemId,
          gridRect,
        });
      }
    }

    if (!isMeteredConsumptionAuthorized(device, state)) {
      continue;
    }

    for (const recipe of Object.values(deviceState.channelRecipes)) {
      const output = recipe?.plan.gasDiffusionOutput ?? null;
      if (output === null) {
        continue;
      }

      const gridRect = resolveDeviceCenteredRangeRect(device, output.range);
      if (gridRect === null) {
        continue;
      }

      result.push({
        sourceDeviceId: device.id,
        gasItemId: output.gasItemId,
        gridRect,
      });
    }
  }

  return result;
}

function buildDeviceGasCoverage(
  topology: CompiledSimulationTopology,
  activeGasDiffusions: readonly RuntimeGasDiffusionSnapshot[],
): ReadonlyMap<string, ReadonlySet<string>> {
  if (activeGasDiffusions.length === 0) {
    return EMPTY_DEVICE_GAS_COVERAGE;
  }

  const coveredGasItemIdsByDeviceId = new Map<string, ReadonlySet<string>>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }
    const deviceGridRect = resolveDeviceGridRect(device);
    if (deviceGridRect === null) {
      continue;
    }

    let coveredGasItemIds: Set<string> | null = null;
    for (const diffusion of activeGasDiffusions) {
      if (!areGridRectsIntersecting(deviceGridRect, diffusion.gridRect)) {
        continue;
      }
      coveredGasItemIds ??= new Set<string>();
      coveredGasItemIds.add(diffusion.gasItemId);
    }
    if (coveredGasItemIds !== null) {
      coveredGasItemIdsByDeviceId.set(deviceId, coveredGasItemIds);
    }
  }
  return coveredGasItemIdsByDeviceId;
}

function areGasDiffusionSnapshotsEqual(
  left: readonly RuntimeGasDiffusionSnapshot[],
  right: readonly RuntimeGasDiffusionSnapshot[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((leftDiffusion, index) => {
    const rightDiffusion = right[index];
    return rightDiffusion !== undefined
      && leftDiffusion.sourceDeviceId === rightDiffusion.sourceDeviceId
      && leftDiffusion.gasItemId === rightDiffusion.gasItemId
      && leftDiffusion.gridRect.x === rightDiffusion.gridRect.x
      && leftDiffusion.gridRect.y === rightDiffusion.gridRect.y
      && leftDiffusion.gridRect.width === rightDiffusion.gridRect.width
      && leftDiffusion.gridRect.height === rightDiffusion.gridRect.height;
  });
}

function resolveDeviceGridRect(device: CompiledSimulationDevice): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(device.footprint, device.rotation);
  return {
    x: device.position.x,
    y: device.position.y,
    width: rotatedFootprint.width,
    height: rotatedFootprint.height,
  };
}

function resolveDeviceCenteredRangeRect(
  device: CompiledSimulationDevice,
  range: number,
): RuntimeGasDiffusionSnapshot["gridRect"] | null {
  if (device.position === null || device.rotation === null || device.footprint === null) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(device.footprint, device.rotation);
  const center = getGridFootprintCenterCells(device.position, rotatedFootprint);
  const halfRange = range / 2;

  return {
    x: center.x - halfRange,
    y: center.y - halfRange,
    width: range,
    height: range,
  };
}
