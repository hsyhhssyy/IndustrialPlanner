import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
} from "../types";
import { SimulationWorkerRuntime } from "../worker-runtime";
import {
  arbitrateRegionalWarehouseEpoch,
  commitRegionalWarehouseEpoch,
} from "./warehouse-arbiter";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseAuthorityState,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "./types";

export interface RegionalBaseTopologyInput {
  readonly baseId: string;
  readonly regionBaseOrderIndex: number;
  readonly topology: CompiledSimulationTopology;
}

export interface RegionalBasePort {
  readonly baseId: string;
  readonly isCurrentBase: boolean;
  prepareEpoch(epochNumber: number): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly demandedOutletIds: readonly string[];
  }>;
  applyEpochGrant(epochNumber: number, grantedOutletIds: readonly string[]): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly deposits: readonly RegionWarehouseDeposit[];
  }>;
  finalizeEpoch(epochNumber: number, nextWarehouseCounts: Readonly<Record<string, number>>): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly snapshot: RuntimeTickSnapshot | null;
  }>;
  /** 当前基地自上次取走后新生成的逐 tick 展示快照；后台基地返回空数组。 */
  takePreparedSnapshots(): Promise<readonly RuntimeTickSnapshot[]>;
  dispose(): void;
}

export interface RegionalAuthorityPort {
  arbitrateEpoch(
    epochNumber: number,
    demands: readonly RegionWarehouseDemandBatch[],
  ): Promise<RegionWarehouseArbitrationResult>;
  commitEpoch(
    epochNumber: number,
    acks: readonly RegionWarehouseAckBatch[],
  ): Promise<RegionWarehouseCommitProposal>;
}

export interface RegionalSessionRuntimeOptions {
  readonly sessionId: string;
  readonly registry: RegistryContract;
  readonly topologies: readonly RegionalBaseTopologyInput[];
  readonly table: RegionalWarehouseOutletTable;
  readonly currentBaseId: string;
  readonly expectedBaseIds: readonly string[];
  readonly initialWarehouseCounts: Readonly<Record<string, number>>;
  readonly simulationSpeed: number;
  readonly currentBaseDynamicTickRate: number;
  readonly backgroundDynamicTickRate: number;
}

export interface RegionalCommittedEpoch {
  readonly epochNumber: number;
  readonly gateTickNumber: number;
  readonly warehouseVersion: number;
  readonly warehouseCounts: Readonly<Record<string, number>>;
  readonly snapshotsByBaseId: Readonly<Record<string, RuntimeTickSnapshot | null>>;
  /** 当前基地从本 Epoch 开始到门禁 tick 的逐 tick 展示快照。 */
  readonly playbackSnapshots: readonly RuntimeTickSnapshot[];
}

/**
 * 区域会话核心。第一版支持 local runtime ports；Worker 运输层在 protocol 接入后复用同一算法。
 */
export class RegionalSimulationSession {
  private authorityState: RegionWarehouseAuthorityState;
  private activeArbitration: RegionWarehouseArbitrationResult | null = null;
  // AI-REMOVED 2026-08-21:
  // Reason: 完整 Epoch 历史持有逐 tick 快照与各基地边界快照，随持续运行无界增长。
  // Trigger: 四基地真实蓝图在 tick 4811 后停止产出，主线程同时持有全部已提交 Epoch。
  // Evidence: committedEpochs 仅用于推导下一个 Epoch 序号和测试长度断言，无运行时历史读取方。
  // Replacement: nextEpochNumberValue 仅保存顺序提交所需的标量序号。
  // Risk: 无法再从 RegionalSimulationSession 读取完整提交历史；调用方仍即时获得本次 committedEpoch。
  // Human Review: Required
  //
  // Original code:
  // private readonly committed: RegionalCommittedEpoch[] = [];
  private nextEpochNumberValue = 0;
  private readonly regionalResourceRemainderSixths: Record<string, number> = {};
  private completedResourceSupplyWindows = 0;

  public constructor(
    private readonly options: RegionalSessionRuntimeOptions,
    private readonly ports: readonly RegionalBasePort[],
    private readonly authorityPort: RegionalAuthorityPort | null,
  ) {
    this.authorityState = {
      warehouseVersion: 0,
      warehouseCounts: { ...options.initialWarehouseCounts },
      cursorByItemId: {},
    };
  }

  // AI-REMOVED 2026-08-21:
  // Reason: 会话不再保留完整 Epoch 历史，避免主线程快照无界常驻。
  // Trigger: 四基地持续运行回归在第五个仿真分钟前停止推进。
  // Evidence: 生产调用只读取 committedEpochs.length，测试也只断言数组长度。
  // Replacement: nextEpochNumber。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // public get committedEpochs(): readonly RegionalCommittedEpoch[] {
  //   return this.committed;
  // }
  public get nextEpochNumber(): number {
    return this.nextEpochNumberValue;
  }

  public get authorityHead(): RegionWarehouseAuthorityState {
    return this.authorityState;
  }

  public get currentBasePort(): RegionalBasePort {
    const port = this.ports.find((candidate) => candidate.isCurrentBase);
    if (port === undefined) {
      throw new Error("Regional session has no current base port.");
    }
    return port;
  }

  public async runEpoch(epochNumber: number): Promise<RegionalCommittedEpoch> {
    const expectedBaseIds = this.options.expectedBaseIds;
    if (epochNumber !== this.nextEpochNumberValue) {
      throw new Error(`Regional epochs must run sequentially; expected ${this.nextEpochNumberValue}, received ${epochNumber}.`);
    }

    const prepareResults = await Promise.all(this.ports.map((port) => port.prepareEpoch(epochNumber)));
    const demands: RegionWarehouseDemandBatch[] = expectedBaseIds.map((baseId) => {
      const result = prepareResults.find((candidate) => candidate.baseId === baseId);
      if (result === undefined) {
        throw new Error(`Regional prepare missing base ${baseId}.`);
      }
      return {
        sessionId: this.options.sessionId,
        epochNumber,
        warehouseVersion: this.authorityState.warehouseVersion,
        baseId,
        demandedOutletIds: [...result.demandedOutletIds],
      };
    });

    const arbitration = await (this.authorityPort?.arbitrateEpoch(epochNumber, demands)
      ?? Promise.resolve(arbitrateRegionalWarehouseEpoch({
        sessionId: this.options.sessionId,
        epochNumber,
        table: this.options.table,
        state: this.authorityState,
        demands,
      })));
    this.activeArbitration = arbitration;

    const applyResults = await Promise.all(this.ports.map(async (port) => {
      const grant = arbitration.grantsByBaseId[port.baseId];
      if (grant === undefined) {
        throw new Error(`Regional grant missing base ${port.baseId}.`);
      }
      const applied = await port.applyEpochGrant(epochNumber, grant.grantedOutletIds);
      return { baseId: port.baseId, applied };
    }));

    const resourceDeposits = this.createRegionalResourceDeposits(epochNumber);
    const resourceDepositBaseId = expectedBaseIds[0] ?? null;
    const acks: RegionWarehouseAckBatch[] = expectedBaseIds.map((baseId) => {
      const result = applyResults.find((candidate) => candidate.baseId === baseId);
      const grant = arbitration.grantsByBaseId[baseId];
      if (result === undefined || grant === undefined) {
        throw new Error(`Regional ACK missing base ${baseId}.`);
      }
      return {
        sessionId: this.options.sessionId,
        epochNumber,
        warehouseVersion: this.authorityState.warehouseVersion,
        baseId,
        grantId: grant.grantId,
        appliedOutletIds: [...grant.grantedOutletIds],
        deposits: baseId === resourceDepositBaseId
          ? mergeRegionalDeposits(result.applied.deposits, resourceDeposits)
          : result.applied.deposits,
      };
    });

    const proposal = await (this.authorityPort?.commitEpoch(epochNumber, acks)
      ?? Promise.resolve(commitRegionalWarehouseEpoch({
        sessionId: this.options.sessionId,
        epochNumber,
        table: this.options.table,
        state: this.authorityState,
        expectedBaseIds,
        arbitration,
        acks,
      })));
    this.authorityState = {
      warehouseVersion: proposal.nextWarehouseVersion,
      warehouseCounts: proposal.warehouseCounts,
      cursorByItemId: proposal.cursorByItemId,
    };

    const finalizeResults = await Promise.all(this.ports.map(async (port) => {
      const finalized = await port.finalizeEpoch(epochNumber, proposal.warehouseCounts);
      return { baseId: port.baseId, finalized };
    }));
    const playbackSnapshots = [...await this.currentBasePort.takePreparedSnapshots()];
    const snapshotsByBaseId: Record<string, RuntimeTickSnapshot | null> = {};
    for (const result of finalizeResults) {
      snapshotsByBaseId[result.baseId] = result.finalized.snapshot;
    }

    const committedEpoch: RegionalCommittedEpoch = {
      epochNumber,
      gateTickNumber: 1 + epochNumber * 10,
      warehouseVersion: proposal.nextWarehouseVersion,
      warehouseCounts: proposal.warehouseCounts,
      snapshotsByBaseId,
      playbackSnapshots,
    };
    // AI-REMOVED 2026-08-21:
    // Reason: 已提交 Epoch 的完整快照历史没有运行时消费者，并造成持续内存增长。
    // Trigger: 四基地真实负载长跑在 tick 4811 后停止生产新快照。
    // Evidence: Search-First 仅发现 action-impl 读取数组长度、两处测试断言历史长度。
    // Replacement: nextEpochNumberValue 递增；committedEpoch 继续即时返回给调用方。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.committed.push(committedEpoch);
    this.nextEpochNumberValue += 1;
    this.activeArbitration = null;
    return committedEpoch;
  }

  public dispose(): void {
    for (const port of this.ports) {
      port.dispose();
    }
  }

  private createRegionalResourceDeposits(
    epochNumber: number,
  ): readonly RegionWarehouseDeposit[] {
    const topology = this.options.topologies[0]?.topology;
    if (topology === undefined) {
      return [];
    }
    const gateTickNumber = 1 + epochNumber * 10;
    const windowTicks = topology.standardTickRate * 10;
    const completedWindows = Math.floor(Math.max(0, gateTickNumber - 1) / windowTicks);
    const newWindowCount = completedWindows - this.completedResourceSupplyWindows;
    this.completedResourceSupplyWindows = completedWindows;
    if (newWindowCount <= 0) {
      return [];
    }

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

export interface LocalRegionalBasePortOptions {
  readonly registry: RegistryContract;
  readonly baseId: string;
  readonly regionBaseOrderIndex: number;
  readonly topology: CompiledSimulationTopology;
  readonly table: RegionalWarehouseOutletTable;
  readonly initialWarehouseCounts: Readonly<Record<string, number>>;
  readonly isCurrentBase: boolean;
  readonly simulationSpeed: number;
  readonly fixedDynamicTickRate: number;
  readonly advanceMode: "per-tick" | "coarse";
}

export class LocalRegionalBasePort implements RegionalBasePort {
  private readonly runtime: SimulationWorkerRuntime;

  public constructor(private readonly options: LocalRegionalBasePortOptions) {
    this.runtime = new SimulationWorkerRuntime(options.registry);
    const result = this.runtime.loadRegionalTopology({
      topology: options.topology,
      baseId: options.baseId,
      table: options.table,
      initialWarehouseCounts: options.initialWarehouseCounts,
      fixedDynamicTickRate: options.fixedDynamicTickRate,
      advanceMode: options.advanceMode,
      simulationSpeed: options.simulationSpeed,
    });
    if (result.status !== "started") {
      throw new Error(`Failed to start regional base ${options.baseId}: ${result.error ?? "unknown error"}`);
    }
  }

  public get baseId(): string {
    return this.options.baseId;
  }

  public get isCurrentBase(): boolean {
    return this.options.isCurrentBase;
  }

  public async prepareEpoch(epochNumber: number): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly demandedOutletIds: readonly string[];
  }> {
    const result = this.runtime.prepareRegionalEpochDemand(epochNumber);
    return { baseId: this.options.baseId, ...result };
  }

  public async applyEpochGrant(epochNumber: number, grantedOutletIds: readonly string[]): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly deposits: readonly RegionWarehouseDeposit[];
  }> {
    const result = this.runtime.applyRegionalEpochGrant({ epochNumber, grantedOutletIds });
    return { baseId: this.options.baseId, ...result };
  }

  public async finalizeEpoch(epochNumber: number, nextWarehouseCounts: Readonly<Record<string, number>>): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly snapshot: RuntimeTickSnapshot | null;
  }> {
    const result = this.runtime.finalizeRegionalEpoch({
      epochNumber,
      nextWarehouseCounts,
      includeSnapshot: true,
      retainSnapshot: this.options.isCurrentBase,
    });
    return { baseId: this.options.baseId, ...result };
  }

  public async takePreparedSnapshots(): Promise<readonly RuntimeTickSnapshot[]> {
    if (!this.options.isCurrentBase) {
      return [];
    }
    return this.runtime.takeRegionalSnapshots();
  }

  public dispose(): void {
    // Local runtime 没有独立 Worker 资源；状态由 session 生命周期释放。
  }
}
