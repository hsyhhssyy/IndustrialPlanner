import type {
  CompiledSimulationDevice,
  CompiledSimulationTopology,
} from "../types";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  RuntimeDeviceRecipeState,
  SimulationMutableRuntimeState,
} from "./runtime-state";
import {
  DYNAMIC_SIMULATION_TICK_RATES,
  isDynamicTickRateCompatibleWithTransferUnits,
} from "../tick-rate";
import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";
// AI-REMOVED 2026-08-02:
// Reason: 物流族不再从 topology.logisticsKind 副本读取。
// Trigger: Worker runtime 持有唯一 RegistryContract。
// Evidence: RegistryQuery.isBeltFamily/isPipeFamily 是公开真相层。
// Replacement: 各 phase-gating 函数的 registry 参数。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { LOGISTICS_KIND } from "@/domain/shared/logistics";

export interface TransportRecipeTiming {
  readonly durationTicks: number;
  readonly recipeIdSuffix: "dynamic-belt-transfer" | "dynamic-pipe-transfer";
}

export function isDedicatedLogisticsDevice(
  device: CompiledSimulationDevice,
): boolean {
  return device.transportClass === "strict-belt" || device.transportClass === "strict-pipe";
}

export function isPhaseGatedLogisticsDevice(
  registry: RegistryContract,
  device: CompiledSimulationDevice,
): boolean {
  return registry.queries.isPipeFamily(device.definitionId);
}

export function resolveTransportRecipeTiming(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): TransportRecipeTiming | null {
  const isBelt = registry.queries.isBeltFamily(device.definitionId);
  const isPipe = registry.queries.isPipeFamily(device.definitionId);

  if (!isBelt && !isPipe) {
    return null;
  }

  const durationSeconds = isBelt ? BELT_TRANSPORT_DURATION_SECONDS : PIPE_TRANSPORT_DURATION_SECONDS;
  return {
    durationTicks: Math.max(1, Math.round(durationSeconds * topology.standardTickRate)),
    recipeIdSuffix: isBelt ? "dynamic-belt-transfer" : "dynamic-pipe-transfer",
  };
}

export function resolveDedicatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): number | null {
  if (!isDedicatedLogisticsDevice(device)) {
    return null;
  }

  const timing = resolveTransportRecipeTiming(registry, topology, device);
  if (timing === null) {
    return null;
  }

  return Math.min(timing.durationTicks, topology.standardTickRate);
}

export function resolveActiveDedicatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly number[] {
  const transferUnitTicks = new Set<number>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const unitTicks = resolveDedicatedLogisticsTransferUnitTicks(registry, topology, device);
    if (unitTicks !== null) {
      transferUnitTicks.add(unitTicks);
    }
  }

  return [...transferUnitTicks].sort((left, right) => left - right);
}

export function resolvePhaseGatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): number | null {
  if (!isPhaseGatedLogisticsDevice(registry, device)) {
    return null;
  }

  const timing = resolveTransportRecipeTiming(registry, topology, device);
  if (timing === null) {
    return null;
  }

  return Math.min(timing.durationTicks, topology.standardTickRate);
}

export function resolveActivePhaseGatedLogisticsTransferUnitTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly number[] {
  const transferUnitTicks = new Set<number>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    const unitTicks = resolvePhaseGatedLogisticsTransferUnitTicks(registry, topology, device);
    if (unitTicks !== null) {
      transferUnitTicks.add(unitTicks);
    }
  }

  return [...transferUnitTicks].sort((left, right) => left - right);
}

export function resolveDynamicTickRateSwitchIntervalTicks(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): number {
  const transferUnitTicks = resolveActivePhaseGatedLogisticsTransferUnitTicks(registry, topology);
  if (transferUnitTicks.length === 0) {
    return topology.standardTickRate;
  }

  return transferUnitTicks.reduce((currentLcm, transferUnitTicks) =>
    lcm(currentLcm, transferUnitTicks),
  );
}

export function canAdjustDynamicTickRateAtTick(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly standardTick: number;
}): boolean {
  const switchIntervalTicks = resolveDynamicTickRateSwitchIntervalTicks(options.registry, options.topology);
  return switchIntervalTicks > 0 && options.standardTick % switchIntervalTicks === 0;
}

export function resolveLegalDynamicTickRates(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
): readonly number[] {
  const transferUnitTicks = resolveActivePhaseGatedLogisticsTransferUnitTicks(registry, topology);
  return DYNAMIC_SIMULATION_TICK_RATES.filter((dynamicTickRate) =>
    isDynamicTickRateCompatibleWithTransferUnits({
      dynamicTickRate,
      transferUnitTicks,
      standardTickRate: topology.standardTickRate,
    }),
  );
}

export function canDedicatedLogisticsTransferAtTick(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly device: CompiledSimulationDevice;
  readonly standardTick: number;
}): boolean {
  const transferUnitTicks = resolveDedicatedLogisticsTransferUnitTicks(
    options.registry,
    options.topology,
    options.device,
  );
  if (transferUnitTicks === null) {
    return true;
  }

  // AI-CORRECTION 2026-07-17: 严格物流与时间轴检查点统一以 tick 1 为首个交付相位。
  return (options.standardTick - 1) % transferUnitTicks === 0;
  // AI-REMOVED 2026-07-17:
  // Reason: tick 0 相位会让 1、11、21... 的时间轴粗步长进程永久错过严格物流交付。
  // Trigger: 用户明确要求第 1 帧允许物流交付，并保持时间轴每次只计算 10 tick。
  // Evidence: 7 核息壤时间轴从 tick 301 以 step=10 推进时，旧相位在所有检查点均返回 false。
  // Replacement: 使用 (standardTick - 1) % transferUnitTicks === 0。
  // Risk: 所有严格传送带/管道的交付帧整体前移 1 tick，吞吐周期保持不变。
  // Human Review: Required
  //
  // Original code:
  // return options.standardTick % transferUnitTicks === 0;
}

export function canPhaseGatedLogisticsTransferAtTick(options: {
  readonly registry: RegistryContract;
  readonly topology: CompiledSimulationTopology;
  readonly device: CompiledSimulationDevice;
  readonly standardTick: number;
}): boolean {
  const transferUnitTicks = resolvePhaseGatedLogisticsTransferUnitTicks(
    options.registry,
    options.topology,
    options.device,
  );
  if (transferUnitTicks === null) {
    return true;
  }

  return (options.standardTick - 1) % transferUnitTicks === 0;
}

export function canDeviceTransferAtCurrentPhase(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
): boolean {
  return canPhaseGatedLogisticsTransferAtTick({
    registry,
    topology,
    device,
    standardTick: state.tickNumber,
  });
}

export function canRecipeFinishAtCurrentPhase(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  recipe: RuntimeDeviceRecipeState,
): boolean {
  const device = resolveRecipeDevice(topology, recipe);
  if (device === null) {
    return true;
  }

  return canDeviceTransferAtCurrentPhase(registry, topology, state, device);
}

// AI-REMOVED 2026-07-23:
// Reason: 仅严格物流门禁无法覆盖分流器、汇流器、桥接器和准入口等一般 PipeFamily 组件。
// Trigger: 用户要求所有管道类组件的输入、输出、配方完成与启动都只发生在整数秒。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §5.3、§6.2。
// Replacement: resolveActivePhaseGatedLogisticsTransferUnitTicks 与 canPhaseGatedLogisticsTransferAtTick。
// Risk: Medium - 一般管道不再在非整数秒相位搬运或启动配方。
// Human Review: Required
//
// Original code:
// const transferUnitTicks = resolveActiveDedicatedLogisticsTransferUnitTicks(topology);
// return canDedicatedLogisticsTransferAtTick({ topology, device, standardTick: state.tickNumber });

function resolveRecipeDevice(
  topology: CompiledSimulationTopology,
  recipe: RuntimeDeviceRecipeState,
): CompiledSimulationDevice | null {
  for (const nodeId of [...recipe.plan.ingredientNodeIds, ...recipe.plan.productNodeIds]) {
    const deviceId = topology.nodes[nodeId]?.deviceId;
    const device = deviceId === undefined ? undefined : topology.devices[deviceId];
    if (device !== undefined) {
      return device;
    }
  }

  return null;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs(left * right) / gcd(left, right);
}
