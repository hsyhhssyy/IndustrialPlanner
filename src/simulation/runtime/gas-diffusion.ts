import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeGasDiffusionSnapshot,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import {
  areGridRectsContaining,
} from "@/shared/geometry/power-range";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";

interface GasDiffusionTopologyIndex {
  readonly sourceDeviceIds: readonly string[];
  readonly recipeSourceDeviceIds: readonly string[];
}

interface GasDiffusionRuntimeIndex {
  readonly topology: CompiledSimulationTopology;
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
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): readonly RuntimeGasDiffusionSnapshot[] {
  const topologyIndex = ensureGasDiffusionTopologyIndex(registry, topology);
  return topologyIndex.sourceDeviceIds.length === 0
    ? EMPTY_GAS_DIFFUSIONS
    : collectActiveGasDiffusions(topology, state, topologyIndex.sourceDeviceIds);
}

/** 气体配方的首轮启动只需要访问这些设备，普通设备不应为此被重复扫描。 */
export function getGasDiffusionRecipeSourceDeviceIds(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly string[] {
  return ensureGasDiffusionTopologyIndex(registry, topology).recipeSourceDeviceIds;
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

/** 获取设备当前完全处于的气体 itemId 集合。无任何气体覆盖时返回 null。 */
export function getDeviceCoveredGasItemIds(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  deviceId: string,
): ReadonlySet<string> | null {
  const runtimeIndex = ensureGasDiffusionRuntimeIndex(topology, state);
  return runtimeIndex.coveredGasItemIdsByDeviceId.get(deviceId) ?? null;
}

function ensureGasDiffusionRuntimeIndex(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): GasDiffusionRuntimeIndex {
  const activeGasDiffusions = state.transient.activeGasDiffusions;
  let runtimeIndex = runtimeIndexByState.get(state);
  if (
    runtimeIndex === undefined
    || runtimeIndex.topology !== topology
    || runtimeIndex.activeGasDiffusions !== activeGasDiffusions
  ) {
    runtimeIndex = {
      topology,
      activeGasDiffusions,
      coveredGasItemIdsByDeviceId: buildDeviceGasCoverage(topology, activeGasDiffusions),
    };
    runtimeIndexByState.set(state, runtimeIndex);
  }
  return runtimeIndex;
}

function ensureGasDiffusionTopologyIndex(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): GasDiffusionTopologyIndex {
  const cached = topologyIndexByTopology.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const recipeSourceDeviceIds: string[] = [];
  const sourceDeviceIds: string[] = [];

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const canRunGasDiffusionRecipe = registry.queries
      .findRecipeDefinitionsByMachine(device.definitionId)
      .some((recipe) =>
        isRecipeAvailableByActivity(recipe, topology.activeActivityIds)
        && recipe.gasDiffusionOutput !== undefined,
      )
      && (device.recipeChannels ?? []).length > 0;
    if (canRunGasDiffusionRecipe) {
      recipeSourceDeviceIds.push(deviceId);
    }
    if (canRunGasDiffusionRecipe) {
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
  const seenSourceGasPairs = new Set<string>();

  for (const deviceId of sourceDeviceIds) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    if (device === undefined || deviceState === undefined) {
      continue;
    }
    for (const recipe of Object.values(deviceState.channelRecipes)) {
      if (recipe?.state !== "running") {
        continue;
      }
      const output = recipe?.plan.gasDiffusionOutput ?? null;
      if (output === null) {
        continue;
      }
      const sourceGasKey = `${device.id}\u0000${output.gasItemId}\u0000${output.range}`;
      if (seenSourceGasPairs.has(sourceGasKey)) {
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
      seenSourceGasPairs.add(sourceGasKey);
    }
  }

  return result;
}

export function buildDeviceGasCoverage(
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
      if (!areGridRectsContaining(diffusion.gridRect, deviceGridRect)) {
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

// AI-REMOVED 2026-07-23:
// Reason: 气体覆盖查询必须严格使用帧初冻结的 transient 快照，不能观察频道实时变化后再比较刷新。
// Trigger: 用户指出同帧最后一 tick 不能因频道遍历顺序丢失。
// Evidence: ensureGasDiffusionRuntimeIndex 现只按 activeGasDiffusions 引用建立覆盖索引。
// Replacement: worker/stage-5 显式重建 activeGasDiffusions。
// Risk: Medium
// Human Review: Required
//
// Original code:
// function areGasDiffusionSnapshotsEqual(...) { ... }

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
