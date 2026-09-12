import type { SimulationQuery } from "@/domain/simulation/simulation-query";
import type {
  SimulationDeviceOperatingStatus,
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeSlotItemReadModel,
  SimulationDeviceRuntimeStatusReadModel,
  SimulationPerformanceDiagnosticsReadModel,
} from "@/domain/simulation/types/simulation-types";
import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import {
  convertSimulationTicksToSeconds,
  type CompiledSimulationTopology,
  type RuntimeDeviceSnapshot,
  type SimulationStateReadWrite,
  type WarehouseStats,
} from "@/simulation/contracts";
import type { SimulationPresentationProjection } from "./presentation-projection";
import { buildDeviceGasCoverage } from "./gas-coverage";

/** 引擎提供当前投影及会话汇总；Query 只负责构建公开读模型。 */
export interface SimulationQueryContext {
  readonly state: SimulationStateReadWrite;
  getTopology(): CompiledSimulationTopology | null;
  getPresentation(): SimulationPresentationProjection | null;
  getTotalPowerDemand(topology: CompiledSimulationTopology, presentation: SimulationPresentationProjection): number | null;
  getWarehouseStats(): WarehouseStats | null;
  getPerformanceDiagnostics(): SimulationPerformanceDiagnosticsReadModel;
  getDebugDataEnabled(): boolean;
  beforeReadDebugData?(): void;
}

export function createSimulationQueries(context: SimulationQueryContext): SimulationQuery {
  // 帧级缓存：topology 在同一帧内引用不变，shareCapSlotIds 只需计算一次。
  // BeltCargoDecoration 等 decoration 每帧对多个 entity 调用此方法时命中缓存。
  let cachedTopology: CompiledSimulationTopology | null = null;
  let cachedShareCapSlotIds: Set<string> | null = null;
  let cachedOperatingTopology: CompiledSimulationTopology | null = null;
  let cachedOperatingPresentation: SimulationPresentationProjection | null = null;
  let cachedOperatingTickNumber: number | null = null;
  let cachedOperatingRunningState: SimulationStateReadWrite["runningState"] | null = null;
  let cachedOperatingPowerOutage = false;
  const cachedOperatingStatuses = new Map<string, {
    readonly snapshot: RuntimeDeviceSnapshot;
    readonly status: SimulationDeviceOperatingStatus;
  }>();
  return {
    getStatusRuntimeJson: () => {
      context.beforeReadDebugData?.();
      const presentation = context.getPresentation();
      const state = context.state;
      return JSON.stringify({
        state: {
          runningState: state.runningState,
          simulationSpeed: state.simulationSpeed,
          currentPlaybackTickNumber: state.currentPlaybackTickNumber,
        },
        runtimeStatus: state.runtimeStatus,
        currentTick: presentation === null || presentation.tickNumber === null
          ? null
          : {
              tickNumber: presentation.tickNumber,
              standardTickRate: presentation.standardTickRate,
              tickRate: presentation.tickRate,
              status: presentation.status,
              totalPowerDemand: presentation.totalPowerDemand,
              transferCount: presentation.getTransfers().length,
              diagnosticCount: presentation.getDiagnostics().length,
              ...(context.getDebugDataEnabled() && presentation.debugData !== undefined
                ? { debugData: presentation.debugData } : {}),
            },
      });
    },
    getPerformanceDiagnostics: () => context.getPerformanceDiagnostics(),
    getDocumentRuntimeStatus: () => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null) return null;
      return {
        tickNumber: presentation.tickNumber,
        standardTickRate: presentation.standardTickRate ?? topology.standardTickRate,
        tickRate: presentation.tickRate ?? topology.standardTickRate,
        totalPowerDemand: context.getTotalPowerDemand(topology, presentation),
        currentPowerGeneration: presentation.currentPowerGeneration,
        isPowerOutage: presentation.isPowerOutage,
        baseBatteryJoules: presentation.baseBatteryJoules,
        baseBatteryCapacity: presentation.baseBatteryCapacity,
      };
    },
    getDeviceOperatingStatus: (deviceId) => {
      const runningState = context.state.runningState;
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      const tickNumber = presentation?.tickNumber ?? null;
      if (topology === null || presentation === null || tickNumber === null) {
        return runningState === "stop" ? "closed" : null;
      }

      if (cachedOperatingTopology !== topology
        || cachedOperatingPresentation !== presentation
        || cachedOperatingTickNumber !== tickNumber
        || cachedOperatingRunningState !== runningState
        || cachedOperatingPowerOutage !== presentation.isPowerOutage) {
        cachedOperatingStatuses.clear();
        cachedOperatingTopology = topology;
        cachedOperatingPresentation = presentation;
        cachedOperatingTickNumber = tickNumber;
        cachedOperatingRunningState = runningState;
        cachedOperatingPowerOutage = presentation.isPowerOutage;
      }

      const compiledDeviceId = resolveCompiledDeviceId(topology, deviceId);
      if (compiledDeviceId === null) return null;
      const device = topology.devices[compiledDeviceId];
      const snapshot = presentation.getDevice(compiledDeviceId);
      if (device === undefined || snapshot === null) return null;

      const cached = cachedOperatingStatuses.get(deviceId);
      if (cached?.snapshot === snapshot) return cached.status;
      const status = resolveDeviceOperatingStatus({
        device,
        snapshot,
        isPowerOutage: presentation.isPowerOutage,
      });
      cachedOperatingStatuses.set(deviceId, { snapshot, status });
      return status;
    },
    getDeviceRuntimeStatus: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology !== cachedTopology) {
        cachedTopology = topology;
        cachedShareCapSlotIds = topology === null ? null : resolveShareCapSlotIds(topology);
      }
      if (presentation === null) return null;
      return resolveDeviceRuntimeStatus({
        topology, deviceId, presentation, shareCapSlotIds: cachedShareCapSlotIds,
        runtimeCanProgress: context.state.runtimeStatus.mode === "running",
      });
    },
    getPipeFluidItemId: (deviceId) => {
      const presentation = context.getPresentation();
      if (presentation === null) return null;
      return resolvePipeFluidItemId({
        runningState: context.state.runningState,
        topology: context.getTopology(), deviceId, presentation,
      });
    },
    isPipeDeviceSlotOccupied: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (context.state.runningState === "stop" || topology === null
        || presentation === null || presentation.tickNumber === null) return false;
      const compiledId = resolveCompiledDeviceId(topology, deviceId);
      const device = compiledId === null ? undefined : topology.devices[compiledId];
      if (device === undefined || device.transportClass !== "strict-pipe") return false;
      // 遍历设备节点的 slot，有任意一个非空即视为占用。
      return device.nodeIds.some((nodeId) => topology.nodes[nodeId]?.slotIds.some((slotId) => {
        const slot = presentation.getSlot(slotId);
        return slot !== null && slot.itemType !== null;
      }) === true);
    },
    getActiveGasDiffusionRanges: () => context.getPresentation()?.getGasDiffusions().map((diffusion) => ({
      sourceDeviceId: diffusion.sourceDeviceId,
      gasItemId: diffusion.gasItemId,
      gridRect: { ...diffusion.gridRect },
    })) ?? [],
    getDeviceActiveGasItemIds: (deviceId) => {
      const topology = context.getTopology();
      const presentation = context.getPresentation();
      if (topology === null || presentation === null || presentation.tickNumber === null) return null;
      const diffusions = presentation.getGasDiffusions();
      if (diffusions.length === 0) return null;
      const compiledId = resolveCompiledDeviceId(topology, deviceId);
      if (compiledId === null) return null;
      const itemIds = buildDeviceGasCoverage(topology, diffusions).get(compiledId);
      return itemIds === undefined ? null : [...itemIds];
    },
    getWarehouseStats: () => {
      const stats = context.getWarehouseStats();
      if (stats === null) return null;
      return {
        items: Object.fromEntries(Object.entries(stats.items).map(([itemId, item]) => [itemId, {
          producedPerMinute: item.producedPerMinute,
          consumedPerMinute: item.consumedPerMinute,
          warehouseCount: item.warehouseCount,
          infinite: item.infinite,
          lastChangedTick: item.lastChangedTick,
        }])),
        statsWindowReady: stats.statsWindowReady,
      };
    },
  };
}

function resolveDeviceOperatingStatus(options: {
  device: CompiledSimulationTopology["devices"][string];
  snapshot: RuntimeDeviceSnapshot;
  isPowerOutage: boolean;
}): SimulationDeviceOperatingStatus {
  if (options.device.powerStatus === "out-of-power-range") return "not-in-power-net";
  if (options.device.requiresPower && options.isPowerOutage) return "no-power";

  let hasProgressingRecipe = false;
  for (const recipe of Object.values(options.snapshot.channelRecipes)) {
    if (recipe?.state === "waiting-output") return "blocked";
    hasProgressingRecipe ||= recipe?.state === "running" && recipe.isProgressing;
  }
  return hasProgressingRecipe ? "normal" : "idle";
}



function resolvePipeFluidItemId(options: {
  runningState: SimulationStateReadWrite["runningState"];
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  presentation: SimulationPresentationProjection;
}): string | null {
  if (
    options.runningState === "stop"
    || options.topology === null
    || options.presentation.tickNumber === null
  ) {
    return null;
  }

  const device = options.topology.devices[options.deviceId]
    ?? options.topology.devices[`device:${options.deviceId}`];
  if (device === undefined || device.transportClass !== "strict-pipe") {
    return null;
  }

  const componentId = device.transportComponentId;
  if (componentId === null) {
    return null;
  }

  return options.presentation.getTransportComponentItemType(componentId);
}



function resolveDeviceRuntimeStatus(options: {
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  presentation: SimulationPresentationProjection;
  shareCapSlotIds: Set<string> | null;
  runtimeCanProgress: boolean;
}): SimulationDeviceRuntimeStatusReadModel | null {
  const currentTickNumber = options.presentation.tickNumber;
  if (options.topology === null || currentTickNumber === null) {
    return null;
  }

  const compiledDeviceId = resolveCompiledDeviceId(options.topology, options.deviceId);
  if (compiledDeviceId === null) {
    return null;
  }

  const deviceSnapshot = options.presentation.getDevice(compiledDeviceId);
  if (deviceSnapshot === null) {
    return null;
  }

  // AI-CORRECTION 2026-05-29: 新增 channelRecipes 映射所有 channel 运行时状态。
  const channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null> = {};
  if (deviceSnapshot.channelRecipes) {
    for (const [chId, chRecipe] of Object.entries(deviceSnapshot.channelRecipes)) {
      channelRecipes[chId] = chRecipe === null
        ? null
        : {
            channelId: chId,
            recipeId: chRecipe.recipeId,
            progressSeconds: convertSimulationTicksToSeconds(
              chRecipe.progressTicks,
              options.topology.standardTickRate,
            ),
            desiredSeconds: convertSimulationTicksToSeconds(
              chRecipe.durationTicks,
              options.topology.standardTickRate,
            ),
            isProgressing: chRecipe.isProgressing && options.runtimeCanProgress,
            state: chRecipe.state,
          };
    }
  }

  // AI-REMOVED 2026-05-30:
  // Reason: recipeId/progressSeconds/desiredSeconds 已从 SimulationDeviceRuntimeStatusReadModel 中移除。
  // Trigger: 接口字段迁移到 channelRecipes。
  // Evidence: 接口中已删除，所有调用方已迁移到 channelRecipes。
  // Replacement: channelRecipes
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  //   recipeId: deviceSnapshot.recipe?.recipeId ?? null,
  //   progressSeconds: deviceSnapshot.recipe === null
  //     ? null
  //     : convertSimulationTicksToSeconds(deviceSnapshot.recipe.progressTicks),
  //   desiredSeconds: deviceSnapshot.recipe === null
  //     ? null
  //     : convertSimulationTicksToSeconds(deviceSnapshot.recipe.durationTicks),
  return {
    channelRecipes,
    // AI-REMOVED 2026-07-23:
    // Reason: 设备状态不再投影已删除的分钟计量 read model。
    // Trigger: Inspector 改为直接读取真实消耗槽。
    // Evidence: 下方 slotItems 已提供 count/reserved，channelRecipes 提供运行状态。
    // Replacement: slotItems + channelRecipes。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // meteredConsumption: deviceSnapshot.meteredConsumption === null
    //   ? null
    //   : {
    //       currentWindowCount: deviceSnapshot.meteredConsumption.currentCount,
    //       currentWindowItemId: deviceSnapshot.meteredConsumption.currentItemId,
    //       previousWindowCount: deviceSnapshot.meteredConsumption.previousWindowCount,
    //       previousWindowItemId: deviceSnapshot.meteredConsumption.previousWindowItemId
    //         ?? (deviceSnapshot.meteredConsumption.previousWindowCount > 0
    //           ? deviceSnapshot.meteredConsumption.activeEffectItemId
    //           : null)
    //         ?? null,
    //     },
    admissionCounters: Object.fromEntries(
      Object.entries(deviceSnapshot.admissionCounters ?? {}).map(([portRef, counter]) => {
        const windowTicks = options.topology!.standardTickRate * 10;
        // AI-CORRECTION 2026-08-04: 窗口对齐起点复用 resolveCounterWindowStartTick 逻辑（tick 1 相位）。
        const currentWindowStartTick = options.topology!.standardTickRate > 0
          ? 1 + Math.floor(Math.max(0, currentTickNumber - 1) / windowTicks) * windowTicks
          : 1;
        const cutoff = currentTickNumber - options.topology!.standardTickRate * 60;
        // pastWindowCounts 存 6 个已完成窗口：[0]=最旧（可能部分超出 60s）, [1..5]=完整窗口。
        // oneMinuteCount = 精算最旧窗口在 cutoff 内的部分 + 累加 [1..5] + 当前窗口。
        const oldestWindowStart = currentWindowStartTick - ADMISSION_RATE_WINDOWS_PER_MINUTE * windowTicks;
        const earliestFullWindowStart = currentWindowStartTick - (ADMISSION_RATE_WINDOWS_PER_MINUTE - 1) * windowTicks;
        const oldestPartial = (counter.moveTicks ?? []).reduce(
          (sum, t) => t >= oldestWindowStart && t < earliestFullWindowStart && t > cutoff ? sum + 1 : sum,
          0,
        );
        const fullWindowsSum = counter.pastWindowCounts.slice(1).reduce((sum, c) => sum + c, 0);
        const oneMinuteCount = oldestPartial + fullWindowsSum + counter.rateWindowCount;
        return [
          portRef,
          {
            portGroupId: counter.portGroupId,
            portId: counter.portDefinitionId,
            itemType: counter.itemId,
            limit: counter.limit,
            count: counter.count,
            perMinuteLimit: counter.perMinuteLimit,
            rateWindowCount: counter.rateWindowCount,
            oneMinuteCount,
          },
        ] as const;
      }),
    ),
    powerStatus: options.topology.devices[compiledDeviceId]?.powerStatus ?? null,
    slotItems: resolveDeviceRuntimeSlotItems({
      topology: options.topology,
      compiledDeviceId,
      presentation: options.presentation,
      shareCapSlotIds: options.shareCapSlotIds,
    }),
  };
}



function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  deviceId: string,
): string | null {
  if (topology.devices[deviceId] !== undefined) {
    return deviceId;
  }

  const directCompiledId = `device:${deviceId}`;
  if (topology.devices[directCompiledId] !== undefined) {
    return directCompiledId;
  }

  return topology.ordering.deviceOrder.find((topologyDeviceId) =>
    topology.devices[topologyDeviceId]?.sourceEntityId === deviceId,
  ) ?? null;
}



function resolveShareCapSlotIds(
  topology: CompiledSimulationTopology,
): Set<string> {
  return new Set(
    Object.values(topology.links)
      .filter((link) => link.linkType === "share-cap")
      .flatMap((link) => [...link.sourceSlotIds, ...link.targetSlotIds]),
  );
}



function resolveDeviceRuntimeSlotItems(options: {
  topology: CompiledSimulationTopology;
  compiledDeviceId: string;
  presentation: SimulationPresentationProjection;
  shareCapSlotIds: Set<string> | null;
}): SimulationDeviceRuntimeSlotItemReadModel[] {
  const device = options.topology.devices[options.compiledDeviceId];
  if (device === undefined) {
    return [];
  }

  const shareCapSlotIds = options.shareCapSlotIds ?? new Set<string>();
  const slotItemsByRealSlotKey = new Map<string, SimulationDeviceRuntimeSlotItemReadModel>();
  for (const nodeId of device.nodeIds) {
    const node = options.topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }

    for (const compiledSlotId of node.slotIds) {
      const compiledSlot = options.topology.slots[compiledSlotId];
      const slotSnapshot = options.presentation.getSlot(compiledSlotId);
      if (compiledSlot === undefined || slotSnapshot === null) {
        continue;
      }

      const isShareCapSlot = shareCapSlotIds.has(compiledSlotId);
      const storageGroupId = compiledSlot.sourceStorageSlotGroupId ?? "synthetic";
      const sourceSlotId = compiledSlot.sourceSlotId ?? compiledSlot.id;
      const realSlotKey = isShareCapSlot
        ? compiledSlotId
        : `${storageGroupId}:${sourceSlotId}`;
      const existing = slotItemsByRealSlotKey.get(realSlotKey);
      slotItemsByRealSlotKey.set(realSlotKey, {
        // AI-CORRECTION 2026-05-13: slotType removed. viewRole alone determines slot role for display.
        storageGroupId,
        slotId: sourceSlotId,
        viewRole: isShareCapSlot ? node.viewRole : "single-view",
        itemType: existing?.itemType ?? slotSnapshot.itemType,
        count: Math.max(existing?.count ?? 0, slotSnapshot.count),
        reserved: Math.max(existing?.reserved ?? 0, slotSnapshot.reserved),
        ignoreStock: (existing?.ignoreStock ?? false) || slotSnapshot.ignoreStock,
      });
    }
  }

  return [...slotItemsByRealSlotKey.values()];
}
