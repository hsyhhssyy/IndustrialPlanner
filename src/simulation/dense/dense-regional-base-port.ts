import type { RegistryContract } from "@/domain/registry/registry-contract";

import type {
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "../regional/types";
import type { RegionalBasePort } from "../regional/session";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
} from "../types";
import { DenseFrameEmitter } from "./dense-frame-emitter";
import { DenseProjectionStore } from "./dense-frame-delta";
import {
  DenseSimulationKernel,
  type DenseRegionalGrantResult,
} from "./dense-simulation-kernel";
import { compileDenseTopologyLayout } from "./dense-topology";

export interface DenseLocalRegionalBasePortOptions {
  readonly registry: RegistryContract;
  readonly baseId: string;
  readonly topology: CompiledSimulationTopology;
  readonly table: RegionalWarehouseOutletTable;
  readonly initialWarehouseCounts: Readonly<Record<string, number>>;
  readonly isCurrentBase: boolean;
  readonly advanceMode: "per-tick" | "coarse";
}

/**
 * dense 区域基地的同步测试端口。生产浏览器路径使用相同 kernel 协议的独立 Worker，
 * 本端口只负责让区域 Contract/Blueprint 差分无需依赖 legacy Runtime。
 */
export class DenseLocalRegionalBasePort implements RegionalBasePort {
  private readonly kernel: DenseSimulationKernel;
  private readonly emitter: DenseFrameEmitter;
  private readonly projection: DenseProjectionStore;
  private preparedSnapshots: RuntimeTickSnapshot[];
  private advanceMode: "per-tick" | "coarse";
  private pendingGrant: DenseRegionalGrantResult | null = null;

  public constructor(private readonly options: DenseLocalRegionalBasePortOptions) {
    const layout = compileDenseTopologyLayout(options.topology, options.registry);
    const identity = {
      sessionId: `dense-regional-local:${options.baseId}`,
      topologyVersion: 1,
    } as const;
    this.kernel = new DenseSimulationKernel(
      options.topology,
      layout,
      options.registry,
      {
        baseId: options.baseId,
        table: options.table,
        initialWarehouseCounts: options.initialWarehouseCounts,
      },
    );
    this.emitter = new DenseFrameEmitter(options.topology, layout, identity);
    this.projection = new DenseProjectionStore(layout.dictionary, identity);
    this.projection.apply(this.emitter.emitInitial(this.kernel));
    this.preparedSnapshots = options.isCurrentBase
      ? [this.projection.materializeSnapshot()]
      : [];
    this.advanceMode = options.advanceMode;
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
    const prepared = this.kernel.prepareRegionalEpoch(epochNumber, (result) => {
      if (this.isCurrentBase && this.advanceMode === "per-tick") {
        this.projection.apply(this.emitter.emitTick(this.kernel, result));
        this.preparedSnapshots.push(this.projection.materializeSnapshot());
      }
    });
    return { baseId: this.baseId, ...prepared };
  }

  public async applyEpochGrant(
    epochNumber: number,
    grantedOutletIds: readonly string[],
  ): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly deposits: readonly RegionWarehouseDeposit[];
  }> {
    this.pendingGrant = this.kernel.applyRegionalGrant(epochNumber, grantedOutletIds);
    return {
      baseId: this.baseId,
      tickNumber: this.pendingGrant.result.tickNumber,
      deposits: this.pendingGrant.deposits,
    };
  }

  public async finalizeEpoch(
    epochNumber: number,
    nextWarehouseCounts: Readonly<Record<string, number>>,
  ): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly snapshot: RuntimeTickSnapshot;
  }> {
    const pending = this.pendingGrant;
    if (pending === null) {
      throw new Error(`Dense regional base ${this.baseId} has no applied epoch ${epochNumber}.`);
    }
    this.kernel.finalizeRegionalEpoch(epochNumber, nextWarehouseCounts);
    this.projection.apply(this.emitter.emitTick(this.kernel, pending.result));
    const snapshot = this.projection.materializeSnapshot();
    if (this.isCurrentBase) this.preparedSnapshots.push(snapshot);
    this.pendingGrant = null;
    return { baseId: this.baseId, tickNumber: snapshot.tickNumber, snapshot };
  }

  public async takePreparedSnapshots(): Promise<readonly RuntimeTickSnapshot[]> {
    if (!this.isCurrentBase) return [];
    const snapshots = this.preparedSnapshots;
    this.preparedSnapshots = [];
    return snapshots;
  }

  public async setAdvanceMode(advanceMode: "per-tick" | "coarse"): Promise<void> {
    if (this.pendingGrant !== null) {
      throw new Error("Dense regional advance mode can only change between epochs.");
    }
    this.advanceMode = advanceMode;
  }

  public dispose(): void {
    this.preparedSnapshots = [];
    this.pendingGrant = null;
  }
}
