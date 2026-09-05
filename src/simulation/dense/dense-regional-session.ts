import type { RegistryContract } from "@/domain/registry/registry-contract";

import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "../regional/warehouse-arbiter";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseAuthorityState,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "../regional/types";
import type {
  CompiledRegionalResourceSupply,
  CompiledSimulationTopology,
  WarehouseStats,
} from "../types";
import {
  createDenseEngineBridge,
  type DenseEngineBridge,
} from "./dense-engine-bridge";
import {
  DenseProjectionStore,
  type DenseFrameDelta,
} from "./dense-frame-delta";
import type { DenseTopologyDictionary } from "./dense-topology";
import { resolveRecipePhaseTicks } from "../tick-rate";

export interface DenseRegionalBaseInput {
  readonly baseId: string;
  readonly topology: CompiledSimulationTopology;
  readonly powerMode: "real" | "infinite";
  readonly powerConsumptionOverride: number | undefined;
}

export interface DenseRegionalCommittedEpoch {
  readonly epochNumber: number;
  readonly gateTickNumber: number;
  readonly warehouseCounts: Readonly<Record<string, number>>;
  readonly playbackDeltas: readonly DenseFrameDelta[];
  readonly warehouseStats: WarehouseStats;
  readonly totalPowerDemand: number;
}

interface DenseRegionalBaseRuntime {
  readonly input: DenseRegionalBaseInput;
  readonly bridge: DenseEngineBridge;
  readonly projection: DenseProjectionStore;
  readonly dictionary: DenseTopologyDictionary;
  readonly identity: { readonly sessionId: string; readonly topologyVersion: number };
}

export class DenseRegionalSimulationSession {
  private authorityState: RegionWarehouseAuthorityState = {
    warehouseVersion: 0,
    warehouseCounts: {},
    cursorByItemId: {},
  };
  private nextEpochNumberValue = 0;
  private readonly regionalResourceRemainderSixths: Record<string, number> = {};
  private completedResourceSupplyWindows = 0;

  private constructor(
    private readonly sessionId: string,
    private readonly currentBaseId: string,
    private readonly table: RegionalWarehouseOutletTable,
    private readonly bases: readonly DenseRegionalBaseRuntime[],
  ) {}

  public static async create(options: {
    readonly sessionId: string;
    readonly currentBaseId: string;
    readonly table: RegionalWarehouseOutletTable;
    readonly bases: readonly DenseRegionalBaseInput[];
    readonly registry: RegistryContract;
    readonly workerMode: "auto" | "runtime";
  }): Promise<{
    readonly session: DenseRegionalSimulationSession;
    readonly currentBaseInitialDelta: DenseFrameDelta;
    readonly currentBasePresentationProjection: DenseProjectionStore;
  }> {
    const runtimes = await Promise.all(options.bases.map(async (input, index) => {
      const bridge = createDenseEngineBridge(options.workerMode, options.registry);
      try {
        const identity = {
          sessionId: `${options.sessionId}:${input.baseId}`,
          topologyVersion: index + 1,
        } as const;
        const response = await bridge.initialize({
          identity,
          topology: input.topology,
          perfEnabled: false,
          debugDataEnabled: false,
          powerMode: input.powerMode,
          powerConsumptionOverride: input.powerConsumptionOverride,
          regional: {
            baseId: input.baseId,
            table: options.table,
            initialWarehouseCounts: {},
            captureIntermediateFrames: input.baseId === options.currentBaseId,
          },
        });
        const projection = new DenseProjectionStore(response.layout.dictionary, identity);
        projection.apply(response.initialDelta);
        return {
          input,
          bridge,
          projection,
          dictionary: response.layout.dictionary,
          identity,
          initialDelta: response.initialDelta,
        };
      } catch (error) {
        bridge.dispose();
        throw error;
      }
    }));
    const current = runtimes.find((runtime) => runtime.input.baseId === options.currentBaseId);
    if (current === undefined) {
      for (const runtime of runtimes) runtime.bridge.dispose();
      throw new Error(`Dense regional current base "${options.currentBaseId}" is missing.`);
    }
    return {
      session: new DenseRegionalSimulationSession(
        options.sessionId,
        options.currentBaseId,
        options.table,
        runtimes,
      ),
      currentBaseInitialDelta: current.initialDelta,
      currentBasePresentationProjection: createInitializedProjection(
        current.dictionary,
        current.identity,
        current.initialDelta,
      ),
    };
  }

  public get nextEpochNumber(): number {
    return this.nextEpochNumberValue;
  }

  public get currentWarehouseCounts(): Readonly<Record<string, number>> {
    return this.authorityState.warehouseCounts;
  }

  public async runNextEpoch(): Promise<DenseRegionalCommittedEpoch> {
    const epochNumber = this.nextEpochNumberValue;
    const prepared = await Promise.all(this.bases.map(async (base) => ({
      base,
      response: await base.bridge.prepareRegionalEpoch(epochNumber),
    })));
    const demands: RegionWarehouseDemandBatch[] = prepared.map(({ base, response }) => ({
      sessionId: this.sessionId,
      epochNumber,
      warehouseVersion: this.authorityState.warehouseVersion,
      baseId: base.input.baseId,
      demandedOutletIds: response.demandedOutletIds,
    }));
    const arbitration = arbitrateRegionalWarehouseEpoch({
      sessionId: this.sessionId,
      epochNumber,
      table: this.table,
      state: this.authorityState,
      demands,
    });
    const applied = await Promise.all(this.bases.map(async (base) => {
      const grant = arbitration.grantsByBaseId[base.input.baseId];
      if (grant === undefined) {
        throw new Error(`Dense regional grant is missing base "${base.input.baseId}".`);
      }
      return {
        base,
        grantId: grant.grantId,
        grantedOutletIds: grant.grantedOutletIds,
        response: await base.bridge.applyRegionalGrant(epochNumber, grant.grantedOutletIds),
      };
    }));
    const resourceDeposits = this.createRegionalResourceDeposits(epochNumber);
    const resourceDepositBaseId = this.bases[0]?.input.baseId ?? null;
    const acks: RegionWarehouseAckBatch[] = applied.map(({ base, grantId, grantedOutletIds, response }) => ({
      sessionId: this.sessionId,
      epochNumber,
      warehouseVersion: this.authorityState.warehouseVersion,
      baseId: base.input.baseId,
      grantId,
      appliedOutletIds: grantedOutletIds,
      deposits: base.input.baseId === resourceDepositBaseId
        ? mergeRegionalDeposits(response.deposits, resourceDeposits)
        : response.deposits,
    }));
    const proposal = commitRegionalWarehouseEpoch({
      sessionId: this.sessionId,
      epochNumber,
      table: this.table,
      state: this.authorityState,
      expectedBaseIds: this.bases.map((base) => base.input.baseId),
      arbitration,
      acks,
    });
    this.authorityState = {
      warehouseVersion: proposal.nextWarehouseVersion,
      warehouseCounts: proposal.warehouseCounts,
      cursorByItemId: proposal.cursorByItemId,
    };

    const finalized = await Promise.all(this.bases.map(async (base) => ({
      base,
      response: await base.bridge.finalizeRegionalEpoch(
        epochNumber,
        proposal.warehouseCounts,
      ),
    })));
    const playbackDeltas: DenseFrameDelta[] = [];
    for (const { base, response } of finalized) {
      const preparedResponse = prepared.find((entry) => entry.base === base)?.response;
      if (preparedResponse === undefined) {
        throw new Error(`Dense regional prepared response is missing base "${base.input.baseId}".`);
      }
      for (const delta of preparedResponse.intermediateDeltas) {
        base.projection.apply(delta);
        if (base.input.baseId === this.currentBaseId) playbackDeltas.push(delta);
      }
      base.projection.apply(response.delta);
      if (base.input.baseId === this.currentBaseId) playbackDeltas.push(response.delta);
    }
    playbackDeltas.sort((left, right) => left.tickNumber - right.tickNumber);
    this.nextEpochNumberValue += 1;
    return {
      epochNumber,
      gateTickNumber: resolveDenseRegionalGateTick(
        this.bases[0]?.input.topology,
        epochNumber,
      ),
      warehouseCounts: proposal.warehouseCounts,
      playbackDeltas,
      warehouseStats: aggregateDenseRegionalWarehouseStats({
        projections: this.bases.map((base) => base.projection),
        authorityCounts: proposal.warehouseCounts,
        supply: this.bases[0]?.input.topology.regionalResourceSupply,
      }),
      totalPowerDemand: this.bases.reduce(
        (sum, base) => sum + (base.projection.totalPowerDemand ?? 0),
        0,
      ),
    };
  }

  public dispose(): void {
    for (const base of this.bases) base.bridge.dispose();
  }

  private createRegionalResourceDeposits(
    epochNumber: number,
  ): readonly RegionWarehouseDeposit[] {
    const topology = this.bases[0]?.input.topology;
    if (topology === undefined) return [];
    const gateTickNumber = resolveDenseRegionalGateTick(topology, epochNumber);
    const windowTicks = topology.standardTickRate * 10;
    const completedWindows = Math.floor(Math.max(0, gateTickNumber - 1) / windowTicks);
    const newWindowCount = completedWindows - this.completedResourceSupplyWindows;
    this.completedResourceSupplyWindows = completedWindows;
    if (newWindowCount <= 0) return [];
    return Object.entries(
      topology.regionalResourceSupply?.finitePerMinuteByItemId ?? {},
    ).flatMap(([itemId, perMinute]) => {
      const numerator = (this.regionalResourceRemainderSixths[itemId] ?? 0)
        + perMinute * newWindowCount;
      const amount = Math.floor(numerator / 6);
      this.regionalResourceRemainderSixths[itemId] = numerator % 6;
      return amount > 0 ? [{ itemId, amount }] : [];
    });
  }
}

function resolveDenseRegionalGateTick(
  topology: CompiledSimulationTopology | undefined,
  epochNumber: number,
): number {
  const phaseTicks = topology === undefined
    ? null
    : resolveRecipePhaseTicks(topology.standardTickRate);
  if (phaseTicks === null) {
    throw new Error("Dense regional topology cannot represent the recipe phase.");
  }
  return 1 + epochNumber * phaseTicks;
}

function createInitializedProjection(
  dictionary: ConstructorParameters<typeof DenseProjectionStore>[0],
  identity: ConstructorParameters<typeof DenseProjectionStore>[1],
  initialDelta: DenseFrameDelta,
): DenseProjectionStore {
  const projection = new DenseProjectionStore(dictionary, identity);
  projection.apply(initialDelta);
  return projection;
}

function aggregateDenseRegionalWarehouseStats(options: {
  readonly projections: readonly DenseProjectionStore[];
  readonly authorityCounts: Readonly<Record<string, number>>;
  readonly supply: CompiledRegionalResourceSupply | undefined;
}): WarehouseStats {
  const items: Record<string, MutableWarehouseItemStats> = {};
  for (const projection of options.projections) {
    const warehouseStats = projection.getWarehouseStats();
    if (warehouseStats === null) continue;
    for (const [itemId, stats] of Object.entries(warehouseStats.items)) {
      const target = items[itemId] ??= {
        producedPerMinute: 0,
        consumedPerMinute: 0,
        warehouseCount: 0,
        infinite: false,
        lastChangedTick: 0,
      };
      target.producedPerMinute += stats.producedPerMinute;
      target.consumedPerMinute += stats.consumedPerMinute;
      target.infinite ||= stats.infinite;
      target.lastChangedTick = Math.max(target.lastChangedTick, stats.lastChangedTick);
    }
  }
  for (const [itemId, count] of Object.entries(options.authorityCounts)) {
    if (count <= 0) continue;
    const target = items[itemId] ??= createEmptyWarehouseItemStats();
    target.warehouseCount = count;
  }
  for (const itemId of options.supply?.infiniteItemIds ?? []) {
    const target = items[itemId] ??= createEmptyWarehouseItemStats();
    target.infinite = true;
  }
  for (const [itemId, perMinute] of Object.entries(
    options.supply?.finitePerMinuteByItemId ?? {},
  )) {
    const target = items[itemId] ??= createEmptyWarehouseItemStats();
    target.producedPerMinute += perMinute;
  }
  return {
    items,
    statsWindowReady: options.projections.length > 0
      && options.projections.every(
        (projection) => projection.getWarehouseStats()?.statsWindowReady === true,
      ),
  };
}

interface MutableWarehouseItemStats {
  producedPerMinute: number;
  consumedPerMinute: number;
  warehouseCount: number;
  infinite: boolean;
  lastChangedTick: number;
}

function createEmptyWarehouseItemStats(): MutableWarehouseItemStats {
  return {
    producedPerMinute: 0,
    consumedPerMinute: 0,
    warehouseCount: 0,
    infinite: false,
    lastChangedTick: 0,
  };
}

function mergeRegionalDeposits(
  baseDeposits: readonly RegionWarehouseDeposit[],
  resourceDeposits: readonly RegionWarehouseDeposit[],
): readonly RegionWarehouseDeposit[] {
  const amountByItemId: Record<string, number> = {};
  for (const deposit of [...baseDeposits, ...resourceDeposits]) {
    amountByItemId[deposit.itemId] = (amountByItemId[deposit.itemId] ?? 0) + deposit.amount;
  }
  return Object.entries(amountByItemId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, amount]) => ({ itemId, amount }));
}
