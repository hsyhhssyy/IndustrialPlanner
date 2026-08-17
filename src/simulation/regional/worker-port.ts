import type {
  RuntimeTickSnapshot,
  SimulationRuntimeStatus,
} from "../types";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../worker-protocol";
import { attachWorkerRuntime } from "@/shared/worker/attach-worker-runtime";
import type { WorkerRuntimeAttachment } from "@/shared/worker/attach-worker-runtime";
import type {
  RegionWarehouseAckBatch,
  RegionWarehouseArbitrationResult,
  RegionWarehouseCommitProposal,
  RegionWarehouseDemandBatch,
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "./types";
import type {
  RegionalAuthorityPort,
  RegionalBasePort,
  RegionalBaseTopologyInput,
} from "./session";

/**
 * simulation-worker.ts 的区域模式请求/响应桥。
 * 复用现有 Worker 入口与 bootstrap，不在模块外新增 Worker 文件。
 */
export class RegionalWorkerBridge {
  private readonly worker: Worker;
  private readonly runtimeAttachment: WorkerRuntimeAttachment;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (response: SimulationWorkerResponse) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private disposed = false;

  public constructor() {
    this.worker = new Worker(new URL("../simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.runtimeAttachment = attachWorkerRuntime(this.worker, "simulation", {
      onFault: (fault) => {
        this.rejectAll(new Error(`Regional simulation worker failed: ${fault.message}`));
      },
    });
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse>) => {
      const pending = this.pending.get(event.data.requestId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(event.data.requestId);
      pending.resolve(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      const message = event.message || "Unknown regional simulation worker error";
      console.error("[RegionalSimWorker]", message);
      this.rejectAll(new Error(`Regional simulation worker crashed: ${message}`));
    });
  }

  public loadRegionalTopology(options: {
    readonly topology: RegionalBaseTopologyInput["topology"];
    readonly baseId: string;
    readonly table: RegionalWarehouseOutletTable;
    readonly initialWarehouseCounts: Readonly<Record<string, number>>;
    readonly expectedBaseIds: readonly string[];
    readonly fixedDynamicTickRate: number;
    readonly advanceMode: "per-tick" | "coarse";
  }): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-topology-loaded" }>> {
    return this.request({
      type: "load-regional-topology",
      requestId: this.createRequestId(),
      topology: options.topology,
      baseId: options.baseId,
      table: options.table,
      initialWarehouseCounts: options.initialWarehouseCounts,
      expectedBaseIds: options.expectedBaseIds,
      fixedDynamicTickRate: options.fixedDynamicTickRate,
      advanceMode: options.advanceMode,
    }, "regional-topology-loaded");
  }

  public prepareRegionalEpoch(epochNumber: number): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-epoch-prepared" }>> {
    return this.request({
      type: "prepare-regional-epoch",
      requestId: this.createRequestId(),
      epochNumber,
    }, "regional-epoch-prepared");
  }

  public applyRegionalEpochGrant(epochNumber: number, grantedOutletIds: readonly string[]): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-epoch-grant-applied" }>> {
    return this.request({
      type: "apply-regional-epoch-grant",
      requestId: this.createRequestId(),
      epochNumber,
      grantedOutletIds,
    }, "regional-epoch-grant-applied");
  }

  public finalizeRegionalEpoch(epochNumber: number, nextWarehouseCounts: Readonly<Record<string, number>>, includeSnapshot: boolean, retainSnapshot: boolean): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-epoch-finalized" }>> {
    return this.request({
      type: "finalize-regional-epoch",
      requestId: this.createRequestId(),
      epochNumber,
      nextWarehouseCounts,
      includeSnapshot,
      retainSnapshot,
    }, "regional-epoch-finalized");
  }

  public arbitrateRegionalEpoch(epochNumber: number, demands: readonly RegionWarehouseDemandBatch[]): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-arbitrated" }>> {
    return this.request({
      type: "regional-arbitrate",
      requestId: this.createRequestId(),
      epochNumber,
      demands,
    }, "regional-arbitrated");
  }

  public takeRegionalSnapshots(): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-snapshots-taken" }>> {
    return this.request({
      type: "take-regional-snapshots",
      requestId: this.createRequestId(),
    }, "regional-snapshots-taken");
  }

  public commitRegionalEpoch(epochNumber: number, acks: readonly RegionWarehouseAckBatch[]): Promise<Extract<SimulationWorkerResponse, { readonly type: "regional-committed" }>> {
    return this.request({
      type: "regional-commit",
      requestId: this.createRequestId(),
      epochNumber,
      acks,
    }, "regional-committed");
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new Error("Regional simulation worker disposed."));
    this.runtimeAttachment.dispose();
    this.worker.terminate();
  }

  private request<TType extends SimulationWorkerResponse["type"]>(
    request: SimulationWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: TType }>> {
    if (this.disposed) {
      return Promise.reject(new Error("Regional simulation worker disposed."));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.type !== expectedType) {
            reject(new Error(`Unexpected regional worker response "${response.type}", expected "${expectedType}".`));
            return;
          }
          resolve(response as Extract<SimulationWorkerResponse, { readonly type: TType }>);
        },
        reject,
      });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.pending.delete(request.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export interface BrowserRegionalBasePortOptions {
  readonly bridge: RegionalWorkerBridge;
  readonly baseId: string;
  readonly isCurrentBase: boolean;
}

export class BrowserRegionalBasePort implements RegionalBasePort {
  public constructor(private readonly options: BrowserRegionalBasePortOptions) {}

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
    const response = await this.options.bridge.prepareRegionalEpoch(epochNumber);
    rejectRegionalWorkerError(response.status);
    return {
      baseId: this.options.baseId,
      tickNumber: response.tickNumber,
      demandedOutletIds: response.demandedOutletIds,
    };
  }

  public async applyEpochGrant(epochNumber: number, grantedOutletIds: readonly string[]): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly deposits: readonly RegionWarehouseDeposit[];
  }> {
    const response = await this.options.bridge.applyRegionalEpochGrant(epochNumber, grantedOutletIds);
    rejectRegionalWorkerError(response.status);
    return {
      baseId: this.options.baseId,
      tickNumber: response.tickNumber,
      deposits: response.deposits,
    };
  }

  public async finalizeEpoch(epochNumber: number, nextWarehouseCounts: Readonly<Record<string, number>>): Promise<{
    readonly baseId: string;
    readonly tickNumber: number;
    readonly snapshot: RuntimeTickSnapshot | null;
  }> {
    const response = await this.options.bridge.finalizeRegionalEpoch(
      epochNumber,
      nextWarehouseCounts,
      true,
      this.options.isCurrentBase,
    );
    rejectRegionalWorkerError(response.status);
    return {
      baseId: this.options.baseId,
      tickNumber: response.tickNumber,
      snapshot: response.snapshot,
    };
  }

  public async takePreparedSnapshots(): Promise<readonly RuntimeTickSnapshot[]> {
    if (!this.options.isCurrentBase) {
      return [];
    }
    const response = await this.options.bridge.takeRegionalSnapshots();
    rejectRegionalWorkerError(response.status);
    return response.snapshots;
  }

  public dispose(): void {
    // bridge 由 session 统一 dispose，避免一个分片 Worker 被重复 terminate。
  }
}

export class BrowserRegionalAuthorityPort implements RegionalAuthorityPort {
  public constructor(private readonly bridge: RegionalWorkerBridge) {}

  public async arbitrateEpoch(
    epochNumber: number,
    demands: readonly RegionWarehouseDemandBatch[],
  ): Promise<RegionWarehouseArbitrationResult> {
    const response = await this.bridge.arbitrateRegionalEpoch(epochNumber, demands);
    rejectRegionalWorkerError(response.status);
    return response.result;
  }

  public async commitEpoch(
    epochNumber: number,
    acks: readonly RegionWarehouseAckBatch[],
  ): Promise<RegionWarehouseCommitProposal> {
    const response = await this.bridge.commitRegionalEpoch(epochNumber, acks);
    rejectRegionalWorkerError(response.status);
    return response.result;
  }
}

export async function createBrowserRegionalSessionPorts(options: {
  readonly currentBaseId: string;
  readonly topologies: readonly RegionalBaseTopologyInput[];
  readonly table: RegionalWarehouseOutletTable;
  readonly expectedBaseIds: readonly string[];
  readonly initialWarehouseCounts: Readonly<Record<string, number>>;
  readonly currentBaseDynamicTickRate: number;
  readonly backgroundDynamicTickRate: number;
}): Promise<{
  readonly ports: readonly RegionalBasePort[];
  readonly authorityPort: RegionalAuthorityPort;
  readonly bridges: readonly RegionalWorkerBridge[];
}> {
  const bridges: RegionalWorkerBridge[] = [];
  const ports: RegionalBasePort[] = [];
  let authorityBridge: RegionalWorkerBridge | null = null;

  const loads: Promise<unknown>[] = [];
  for (const input of options.topologies) {
    const bridge = new RegionalWorkerBridge();
    bridges.push(bridge);
    const isCurrentBase = input.baseId === options.currentBaseId;
    loads.push(bridge.loadRegionalTopology({
      topology: input.topology,
      baseId: input.baseId,
      table: options.table,
      initialWarehouseCounts: options.initialWarehouseCounts,
      expectedBaseIds: options.expectedBaseIds,
      fixedDynamicTickRate: isCurrentBase
        ? options.currentBaseDynamicTickRate
        : options.backgroundDynamicTickRate,
      advanceMode: isCurrentBase ? "per-tick" : "coarse",
    }).then((response) => {
      if (response.result.status !== "started") {
        throw new Error(`Regional base ${input.baseId} failed to start: ${response.result.error ?? "unknown error"}`);
      }
    }));
    ports.push(new BrowserRegionalBasePort({ bridge, baseId: input.baseId, isCurrentBase }));
    if (isCurrentBase) {
      authorityBridge = bridge;
    }
  }
  await Promise.all(loads);

  if (authorityBridge === null) {
    throw new Error("Regional current base bridge is missing.");
  }

  return {
    ports,
    authorityPort: new BrowserRegionalAuthorityPort(authorityBridge),
    bridges,
  };
}


function rejectRegionalWorkerError(status: SimulationRuntimeStatus): void {
  if (status.mode === "error") {
    throw new Error(status.error ?? "Regional simulation worker entered error mode.");
  }
}
