import { performance } from "node:perf_hooks";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorldDocument } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

import { createSimulationHost } from "@/simulation/simulation-host";
import type {
  CompiledSimulationTopology,
  RegionalResourceSupplySetting,
  RuntimeTickSnapshot,
  RuntimeTransferSnapshot,
} from "@/simulation/types";

type TransportClassSummary = "strict-belt" | "strict-pipe";

export interface RunBlueprintSimulationOptions {
  readonly blueprint: BlueprintDocument;
  readonly maxTickNumber: number;
  readonly registry: RegistryContract;
  /** 启用轻量性能统计，输出逐 tick 阶段耗时报告 */
  readonly perfEnabled?: boolean;
  readonly regionalResources?: readonly RegionalResourceSupplySetting[];
}

export interface BlueprintSimulationReport {
  readonly blueprint: {
    readonly blueprintId: string;
    readonly version: string;
    readonly name: string;
    readonly description: string;
    readonly baseId: string;
    readonly entityCount: number;
    readonly slotLinkCount: number;
  };
  readonly topology: {
    readonly topologyId: string;
    readonly documentHash: string;
    readonly totalPowerDemand: number;
    readonly diagnosticCount: number;
    readonly diagnostics: readonly CompiledSimulationTopology["diagnostics"][number][];
  };
  readonly execution: {
    readonly maxTickNumber: number;
    readonly totalTicksCaptured: number;
  };
  readonly ticks: readonly BlueprintSimulationTickReport[];
  readonly summary: BlueprintSimulationSummary;
}

export interface BlueprintSimulationTickReport {
  readonly tickNumber: number;
  readonly status: RuntimeTickSnapshot["status"];
  readonly totalPowerDemand: number;
  readonly transferCount: number;
  readonly diagnosticCount: number;
  readonly transfers: readonly RuntimeTransferSnapshot[];
  readonly diagnostics: readonly RuntimeTickSnapshot["diagnostics"][number][];
  readonly devices: Readonly<Record<string, SimulationDeviceRuntimeStatusReadModel>>;
  readonly warehouseStats: RuntimeTickSnapshot["warehouseStats"];
}

export interface BlueprintSimulationSummary {
  readonly maxTickNumber: number;
  readonly totalTicksCaptured: number;
  readonly totalTransferCount: number;
  readonly runtimeDiagnosticCount: number;
  readonly deviceInventoryChanges: readonly BlueprintSimulationDeviceInventoryChange[];
  readonly transportComponentThroughput: readonly BlueprintSimulationTransportThroughput[];
}

export interface BlueprintSimulationDeviceInventoryChange {
  readonly deviceId: string;
  readonly slotChanges: readonly BlueprintSimulationSlotInventoryChange[];
}

export interface BlueprintSimulationSlotInventoryChange {
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly initialItemType: string | null;
  readonly finalItemType: string | null;
  readonly initialCount: number;
  readonly finalCount: number;
  readonly deltaCount: number;
  readonly initialReserved: number;
  readonly finalReserved: number;
  readonly deltaReserved: number;
}

export interface BlueprintSimulationTransportThroughput {
  readonly transportComponentId: string;
  readonly transportClass: TransportClassSummary;
  readonly compiledDeviceIds: readonly string[];
  readonly sourceEntityIds: readonly string[];
  readonly transferCount: number;
  readonly totalAmount: number;
  readonly itemAmounts: Readonly<Record<string, number>>;
}

export async function runBlueprintSimulation(
  options: RunBlueprintSimulationOptions,
): Promise<BlueprintSimulationReport> {
  if (!Number.isInteger(options.maxTickNumber) || options.maxTickNumber < 0) {
    throw new Error(`Expected maxTickNumber to be a non-negative integer, received: ${options.maxTickNumber}`);
  }

  const tStart = performance.now();

  const document = createWorldDocumentFromBlueprint(options.blueprint);
  const workspace = createHeadlessWorkspace(document, options.registry);
  const host = createSimulationHost(workspace, {
    workerMode: "runtime",
    getPerfEnabled: options.perfEnabled ? () => true : undefined,
    ...(options.regionalResources === undefined
      ? {}
      : { getRegionalResourceSettings: () => options.regionalResources! }),
  });

  try {
    const tRefreshStart = performance.now();
    const startResult = await host.internalActions.refreshFromCurrentDocument();
    const tRefreshEnd = performance.now();
    console.log(`   [perf] 启动编译: ${(tRefreshEnd - tRefreshStart).toFixed(1)} ms`);

    const topology = host.topology.getSnapshot();

    if (startResult.status !== "started" || topology === null) {
      const error = startResult.error ?? host.internalState.runtimeStatus.error ?? "Unknown simulation startup failure.";
      throw new Error(`Failed to start blueprint simulation: ${error}`);
    }

    const sourceEntityIds = resolveSourceEntityIds(topology);
    const ticks: BlueprintSimulationTickReport[] = [];

    let tickSyncTotal = 0;
    let tickReportTotal = 0;
    const maxTick = options.maxTickNumber;

    for (let tickNumber = 0; tickNumber <= maxTick; tickNumber += 1) {
      const tTickStart = performance.now();
      const tickStatus = await host.internalActions.syncToTick(tickNumber);
      const tTickEnd = performance.now();
      tickSyncTotal += tTickEnd - tTickStart;
      if (tickStatus.status !== "ready") {
        throw new Error(formatUnavailableTickMessage(tickNumber, tickStatus));
      }

      const snapshot = host.internalState.currentSnapshot;
      if (snapshot === null || snapshot.tickNumber !== tickNumber) {
        throw new Error(`Simulation produced no snapshot for tick ${tickNumber}.`);
      }

      const tReportStart = performance.now();
      ticks.push(createTickReport({
        host,
        snapshot,
        sourceEntityIds,
      }));
      tickReportTotal += performance.now() - tReportStart;

      if (tickNumber > 0 && tickNumber % 600 === 0) {
        console.log(`   [perf] tick ${tickNumber}: sync累计=${tickSyncTotal.toFixed(0)}ms report累计=${tickReportTotal.toFixed(0)}ms`);
      }
    }

    const tTotal = performance.now() - tStart;
    console.log(`   [perf] 总耗时: ${tTotal.toFixed(0)}ms | sync=${tickSyncTotal.toFixed(0)}ms(${(tickSyncTotal/tTotal*100).toFixed(1)}%) report=${tickReportTotal.toFixed(0)}ms(${(tickReportTotal/tTotal*100).toFixed(1)}%) 其他=${(tTotal-tickSyncTotal-tickReportTotal).toFixed(0)}ms(${((tTotal-tickSyncTotal-tickReportTotal)/tTotal*100).toFixed(1)}%)`);

    return {
      blueprint: {
        blueprintId: options.blueprint.blueprintId,
        version: options.blueprint.version,
        name: options.blueprint.name,
        description: options.blueprint.description,
        baseId: options.blueprint.baseId,
        entityCount: options.blueprint.entityOrder.length,
        slotLinkCount: options.blueprint.slotLinks.length,
      },
      topology: {
        topologyId: topology.topologyId,
        documentHash: topology.documentHash,
        totalPowerDemand: topology.totalPowerDemand,
        diagnosticCount: topology.diagnostics.length,
        diagnostics: [...topology.diagnostics],
      },
      execution: {
        maxTickNumber: options.maxTickNumber,
        totalTicksCaptured: ticks.length,
      },
      ticks,
      summary: createSummary({
        topology,
        ticks,
        maxTickNumber: options.maxTickNumber,
      }),
    };
  } finally {
    host.dispose();
  }
}

export function createHeadlessWorkspace(documentSnapshot: WorldDocument, registry: RegistryContract): WorkspaceContract {
  const document = createSnapshotStore(documentSnapshot);

  return {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: {
      document,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
  };
}

function resolveSourceEntityIds(topology: CompiledSimulationTopology): string[] {
  const sourceEntityIds = new Set<string>();

  for (const compiledDeviceId of topology.ordering.deviceOrder) {
    const sourceEntityId = topology.devices[compiledDeviceId]?.sourceEntityId;
    if (sourceEntityId !== null && sourceEntityId !== undefined) {
      sourceEntityIds.add(sourceEntityId);
    }
  }

  return [...sourceEntityIds];
}

function createTickReport(options: {
  readonly host: ReturnType<typeof createSimulationHost>;
  readonly snapshot: RuntimeTickSnapshot;
  readonly sourceEntityIds: readonly string[];
}): BlueprintSimulationTickReport {
  const devices: Record<string, SimulationDeviceRuntimeStatusReadModel> = {};

  for (const deviceId of options.sourceEntityIds) {
    const status = options.host.queries.getDeviceRuntimeStatus(deviceId);
    if (status === null) {
      continue;
    }

    devices[deviceId] = {
      slotItems: status.slotItems.map((slotItem) => ({ ...slotItem })),
      channelRecipes: { ...status.channelRecipes },
      admissionCounters: Object.fromEntries(
        Object.entries(status.admissionCounters ?? {}).map(([key, counter]) => [
          key,
          { ...counter },
        ]),
      ),
      // AI-REMOVED 2026-07-23:
      // Reason: 蓝图报告不再复制已删除的固定窗口计量快照。
      // Trigger: 消耗状态迁移到 slotItems 与 channelRecipes。
      // Evidence: 上方两项已经完整复制新机制持久状态的只读投影。
      // Replacement: slotItems + channelRecipes。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // meteredConsumption: clone(status.meteredConsumption),
      // AI-CORRECTION 2026-05-30: recipeId/progressSeconds/desiredSeconds 已从 readmodel 删除，
      //   改为从 channelRecipes 获取。此处仅做浅拷贝传递给测试断言。
      powerStatus: status.powerStatus,
    };
  }

  return {
    tickNumber: options.snapshot.tickNumber,
    status: options.snapshot.status,
    totalPowerDemand: options.snapshot.totalPowerDemand,
    transferCount: options.snapshot.transfers.length,
    diagnosticCount: options.snapshot.diagnostics.length,
    transfers: options.snapshot.transfers.map((transfer) => ({ ...transfer })),
    diagnostics: options.snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    devices,
    warehouseStats: options.snapshot.warehouseStats === null
      ? null
      : {
          items: Object.fromEntries(
            Object.entries(options.snapshot.warehouseStats.items).map(([itemId, stats]) => [
              itemId,
              { ...stats },
            ]),
          ),
          statsWindowReady: options.snapshot.warehouseStats.statsWindowReady,
        },
  };
}

function createSummary(options: {
  readonly topology: CompiledSimulationTopology;
  readonly ticks: readonly BlueprintSimulationTickReport[];
  readonly maxTickNumber: number;
}): BlueprintSimulationSummary {
  return {
    maxTickNumber: options.maxTickNumber,
    totalTicksCaptured: options.ticks.length,
    totalTransferCount: options.ticks.reduce((total, tick) => total + tick.transferCount, 0),
    runtimeDiagnosticCount: options.ticks.reduce((total, tick) => total + tick.diagnosticCount, 0),
    deviceInventoryChanges: createDeviceInventoryChanges(options.ticks),
    transportComponentThroughput: createTransportComponentThroughput({
      topology: options.topology,
      ticks: options.ticks,
    }),
  };
}

function createDeviceInventoryChanges(
  ticks: readonly BlueprintSimulationTickReport[],
): BlueprintSimulationDeviceInventoryChange[] {
  const initialTick = ticks[0];
  const finalTick = ticks.at(-1);

  if (initialTick === undefined || finalTick === undefined) {
    return [];
  }

  const deviceIds = new Set<string>([
    ...Object.keys(initialTick.devices),
    ...Object.keys(finalTick.devices),
  ]);
  const changes: BlueprintSimulationDeviceInventoryChange[] = [];

  for (const deviceId of deviceIds) {
    const initialStatus = initialTick.devices[deviceId];
    const finalStatus = finalTick.devices[deviceId];
    const slotKeys = new Set<string>([
      ...resolveSlotKeys(initialStatus),
      ...resolveSlotKeys(finalStatus),
    ]);
    const slotChanges: BlueprintSimulationSlotInventoryChange[] = [];

    for (const slotKey of slotKeys) {
      const initialSlot = initialStatus === undefined ? undefined : createSlotItemMap(initialStatus)[slotKey];
      const finalSlot = finalStatus === undefined ? undefined : createSlotItemMap(finalStatus)[slotKey];
      const initialItemType = initialSlot?.itemType ?? null;
      const finalItemType = finalSlot?.itemType ?? null;
      const initialCount = initialSlot?.count ?? 0;
      const finalCount = finalSlot?.count ?? 0;
      const initialReserved = initialSlot?.reserved ?? 0;
      const finalReserved = finalSlot?.reserved ?? 0;

      if (
        initialItemType === finalItemType
        && initialCount === finalCount
        && initialReserved === finalReserved
      ) {
        continue;
      }

      const [storageGroupId, slotId] = slotKey.split(":");
      if (storageGroupId === undefined || slotId === undefined) {
        continue;
      }

      slotChanges.push({
        storageGroupId,
        slotId,
        initialItemType,
        finalItemType,
        initialCount,
        finalCount,
        deltaCount: finalCount - initialCount,
        initialReserved,
        finalReserved,
        deltaReserved: finalReserved - initialReserved,
      });
    }

    if (slotChanges.length > 0) {
      changes.push({
        deviceId,
        slotChanges,
      });
    }
  }

  return changes.sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

function createTransportComponentThroughput(options: {
  readonly topology: CompiledSimulationTopology;
  readonly ticks: readonly BlueprintSimulationTickReport[];
}): BlueprintSimulationTransportThroughput[] {
  const throughputByComponentId = new Map<string, {
    transportClass: TransportClassSummary;
    compiledDeviceIds: string[];
    sourceEntityIds: string[];
    transferCount: number;
    totalAmount: number;
    itemAmounts: Record<string, number>;
  }>();

  for (const tick of options.ticks) {
    for (const transfer of tick.transfers) {
      const components = resolveTransportComponentsForTransfer(options.topology, transfer);
      for (const component of components) {
        const existing = throughputByComponentId.get(component.transportComponentId);
        if (existing === undefined) {
          throughputByComponentId.set(component.transportComponentId, {
            transportClass: component.transportClass,
            compiledDeviceIds: [...component.compiledDeviceIds],
            sourceEntityIds: [...component.sourceEntityIds],
            transferCount: 1,
            totalAmount: transfer.amount,
            itemAmounts: {
              [transfer.itemType]: transfer.amount,
            },
          });
          continue;
        }

        existing.transferCount += 1;
        existing.totalAmount += transfer.amount;
        existing.itemAmounts[transfer.itemType] = (existing.itemAmounts[transfer.itemType] ?? 0) + transfer.amount;
      }
    }
  }

  return [...throughputByComponentId.entries()]
    .map(([transportComponentId, value]) => ({
      transportComponentId,
      transportClass: value.transportClass,
      compiledDeviceIds: value.compiledDeviceIds,
      sourceEntityIds: value.sourceEntityIds,
      transferCount: value.transferCount,
      totalAmount: value.totalAmount,
      itemAmounts: value.itemAmounts,
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount);
}

function resolveTransportComponentsForTransfer(
  topology: CompiledSimulationTopology,
  transfer: RuntimeTransferSnapshot,
): Array<{
  transportComponentId: string;
  transportClass: TransportClassSummary;
  compiledDeviceIds: readonly string[];
  sourceEntityIds: readonly string[];
}> {
  const compiledDeviceIds = [
    resolveCompiledDeviceIdBySlotId(topology, transfer.sourceSlotId),
    resolveCompiledDeviceIdBySlotId(topology, transfer.targetSlotId),
  ];
  const components = new Map<string, {
    transportComponentId: string;
    transportClass: TransportClassSummary;
    compiledDeviceIds: readonly string[];
    sourceEntityIds: readonly string[];
  }>();

  for (const compiledDeviceId of compiledDeviceIds) {
    if (compiledDeviceId === null) {
      continue;
    }

    const device = topology.devices[compiledDeviceId];
    if (device === undefined || !isTransportClass(device.transportClass)) {
      continue;
    }

    const transportComponentId = device.transportComponentId ?? device.id;
    const component = topology.transportComponents[transportComponentId];
    const componentDeviceIds = component?.deviceIds ?? [device.id];
    const sourceEntityIds = componentDeviceIds
      .map((deviceId) => topology.devices[deviceId]?.sourceEntityId ?? null)
      .filter((deviceId): deviceId is string => deviceId !== null);

    components.set(transportComponentId, {
      transportComponentId,
      transportClass: device.transportClass,
      compiledDeviceIds: [...componentDeviceIds],
      sourceEntityIds,
    });
  }

  return [...components.values()];
}

function resolveCompiledDeviceIdBySlotId(
  topology: CompiledSimulationTopology,
  slotId: string,
): string | null {
  const slot = topology.slots[slotId];
  if (slot === undefined) {
    return null;
  }

  const node = topology.nodes[slot.nodeId];
  return node?.deviceId ?? null;
}

function isTransportClass(value: string): value is TransportClassSummary {
  return value === "strict-belt" || value === "strict-pipe";
}

function resolveSlotKeys(
  status: SimulationDeviceRuntimeStatusReadModel | undefined,
): string[] {
  if (status === undefined) {
    return [];
  }

  return status.slotItems.map((slotItem) => `${slotItem.storageGroupId}:${slotItem.slotId}`);
}

function createSlotItemMap(
  status: SimulationDeviceRuntimeStatusReadModel,
): Record<string, SimulationDeviceRuntimeStatusReadModel["slotItems"][number]> {
  const slotMap: Record<string, SimulationDeviceRuntimeStatusReadModel["slotItems"][number]> = {};

  for (const slotItem of status.slotItems) {
    slotMap[`${slotItem.storageGroupId}:${slotItem.slotId}`] = slotItem;
  }

  return slotMap;
}

function formatUnavailableTickMessage(
  tickNumber: number,
  status: { readonly status: string; readonly reason?: string },
): string {
  if (status.status === "not-found" && status.reason !== undefined) {
    return `Simulation could not retain tick ${tickNumber}: ${status.reason}.`;
  }

  return `Simulation could not produce tick ${tickNumber}: ${status.status}.`;
}
