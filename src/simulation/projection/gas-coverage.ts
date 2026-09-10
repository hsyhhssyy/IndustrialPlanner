import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
  RuntimeGasDiffusionSnapshot,
} from "../contracts";



import {
  areGridRectsContaining,
} from "@/shared/geometry/power-range";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
const EMPTY_DEVICE_GAS_COVERAGE: ReadonlyMap<string, ReadonlySet<string>> = new Map();

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
