import type { RegistryContract } from "@/domain/registry/registry-contract";
import {
  attachWorkerRuntime,
  type WorkerRuntimeAttachment,
} from "@/shared/worker/attach-worker-runtime";
import { ActiveTimeWatchdog } from "@/shared/worker/active-time-watchdog";
import { createLogger } from "@/shared/logging/logger";

import type {
  CompiledSimulationTopology,
  SimulationTopologyMigration,
} from "../types";
import type { RegionalWarehouseOutletTable } from "../regional/types";
import { collectDenseFrameTransferables } from "./dense-frame-delta";
import { DENSE_SIMULATION_PROTOCOL_VERSION } from "./dense-topology";
import { DenseWorkerRuntime } from "./dense-worker-runtime";
import type {
  DenseProtocolIdentity,
  DenseWorkerCommand,
  DenseWorkerRequest,
  DenseWorkerResponse,
} from "./dense-worker-protocol";

const DENSE_RPC_SLOW_WARNING_MS = 5_000;
const DENSE_RPC_TIMEOUT_MS = 30_000;
const DENSE_INITIALIZE_TIMEOUT_MS = 90_000;
const logger = createLogger("dense-simulation-worker-bridge");

export interface DenseEngineSessionIdentity {
  readonly sessionId: string;
  readonly topologyVersion: number;
}

export interface DenseEngineBridge {
  initialize(options: {
    readonly identity: DenseEngineSessionIdentity;
    readonly topology: CompiledSimulationTopology;
    readonly perfEnabled: boolean;
    readonly debugDataEnabled: boolean;
    readonly powerMode: "real" | "infinite";
    readonly powerConsumptionOverride: number | undefined;
    readonly migration?: SimulationTopologyMigration;
    readonly regional?: {
      readonly baseId: string;
      readonly table: RegionalWarehouseOutletTable;
      readonly initialWarehouseCounts: Readonly<Record<string, number>>;
      readonly captureIntermediateFrames: boolean;
    };
  }): Promise<Extract<DenseWorkerResponse, { readonly type: "topology-ready" }>>;
  sendCommands(
    commands: readonly DenseWorkerCommand[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "command-ack" }>>;
  advanceToTick(
    targetTickNumber: number,
    wallTimeBudgetMs: number,
  ): Promise<Extract<DenseWorkerResponse, {
    readonly type: "frame-delta" | "presentation-checkpoint";
  }>>;
  requestPresentationCheckpoint(
    tickNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "presentation-checkpoint" }>>;
  prepareRegionalEpoch(
    epochNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-prepared" }>>;
  applyRegionalGrant(
    epochNumber: number,
    grantedOutletIds: readonly string[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-grant-applied" }>>;
  finalizeRegionalEpoch(
    epochNumber: number,
    nextWarehouseCounts: Readonly<Record<string, number>>,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-finalized" }>>;
  dispose(): void;
}

export function createDenseEngineBridge(
  mode: "auto" | "runtime",
  registry: RegistryContract,
): DenseEngineBridge {
  return mode === "runtime"
    ? new LocalDenseEngineBridge(registry)
    : new BrowserDenseEngineBridge();
}

class LocalDenseEngineBridge implements DenseEngineBridge {
  private readonly runtime: DenseWorkerRuntime;
  private identity: DenseEngineSessionIdentity | null = null;
  private nextSequence = 1;

  public constructor(registry: RegistryContract) {
    this.runtime = new DenseWorkerRuntime(registry);
  }

  public initialize(options: {
    readonly identity: DenseEngineSessionIdentity;
    readonly topology: CompiledSimulationTopology;
    readonly perfEnabled: boolean;
    readonly debugDataEnabled: boolean;
    readonly powerMode: "real" | "infinite";
    readonly powerConsumptionOverride: number | undefined;
    readonly migration?: SimulationTopologyMigration;
    readonly regional?: {
      readonly baseId: string;
      readonly table: RegionalWarehouseOutletTable;
      readonly initialWarehouseCounts: Readonly<Record<string, number>>;
      readonly captureIntermediateFrames: boolean;
    };
  }): Promise<Extract<DenseWorkerResponse, { readonly type: "topology-ready" }>> {
    this.identity = options.identity;
    this.nextSequence = 1;
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "initialize-session",
      topology: options.topology,
      perfEnabled: options.perfEnabled,
      debugDataEnabled: options.debugDataEnabled,
      powerMode: options.powerMode,
      powerConsumptionOverride: options.powerConsumptionOverride,
      ...(options.migration === undefined ? {} : { migration: options.migration }),
      ...(options.regional === undefined ? {} : { regional: options.regional }),
    }), "topology-ready"));
  }

  public sendCommands(
    commands: readonly DenseWorkerCommand[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "command-ack" }>> {
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "command-batch",
      commands,
    }), "command-ack"));
  }

  public advanceToTick(
    targetTickNumber: number,
    wallTimeBudgetMs: number,
  ): Promise<Extract<DenseWorkerResponse, {
    readonly type: "frame-delta" | "presentation-checkpoint";
  }>> {
    const response = this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "advance-budget",
      targetTickNumber,
      wallTimeBudgetMs,
    });
    if (response.type === "protocol-error") {
      throw createDenseProtocolError(response);
    }
    if (response.type !== "frame-delta" && response.type !== "presentation-checkpoint") {
      throw new Error(`Unexpected dense worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public requestPresentationCheckpoint(
    tickNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "presentation-checkpoint" }>> {
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "request-presentation-checkpoint",
      tickNumber,
    }), "presentation-checkpoint"));
  }

  public prepareRegionalEpoch(
    epochNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-prepared" }>> {
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "prepare-regional-epoch",
      epochNumber,
    }), "regional-epoch-prepared"));
  }

  public applyRegionalGrant(
    epochNumber: number,
    grantedOutletIds: readonly string[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-grant-applied" }>> {
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "apply-regional-grant",
      epochNumber,
      grantedOutletIds,
    }), "regional-grant-applied"));
  }

  public finalizeRegionalEpoch(
    epochNumber: number,
    nextWarehouseCounts: Readonly<Record<string, number>>,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-finalized" }>> {
    return Promise.resolve(this.expectResponse(this.runtime.handleRequest({
      ...this.createIdentity(),
      type: "finalize-regional-epoch",
      epochNumber,
      nextWarehouseCounts,
    }), "regional-epoch-finalized"));
  }

  public dispose(): void {
    this.runtime.reset();
    this.identity = null;
  }

  private createIdentity(): DenseProtocolIdentity {
    const identity = this.identity;
    if (identity === null) {
      throw new Error("Dense engine bridge is not initialized.");
    }
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    return {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: identity.sessionId,
      topologyVersion: identity.topologyVersion,
      sequence,
    };
  }

  private expectResponse<TType extends DenseWorkerResponse["type"]>(
    response: DenseWorkerResponse,
    expectedType: TType,
  ): Extract<DenseWorkerResponse, { readonly type: TType }> {
    if (response.type === "protocol-error") {
      throw createDenseProtocolError(response);
    }
    if (response.type !== expectedType) {
      throw new Error(`Unexpected dense worker response "${response.type}".`);
    }
    return response as Extract<DenseWorkerResponse, { readonly type: TType }>;
  }
}

class BrowserDenseEngineBridge implements DenseEngineBridge {
  private readonly worker: Worker;
  private readonly runtimeAttachment: WorkerRuntimeAttachment;
  private identity: DenseEngineSessionIdentity | null = null;
  private nextSequence = 1;
  private readonly pending = new Map<number, {
    readonly resolve: (response: DenseWorkerResponse) => void;
    readonly reject: (error: Error) => void;
    readonly watchdog: ActiveTimeWatchdog;
  }>();
  private readonly handleVisibilityChange = (): void => {
    const active = this.isPageActive();
    for (const pending of this.pending.values()) {
      pending.watchdog.setActive(active);
    }
  };

  public constructor() {
    this.worker = new Worker(new URL("../dense-simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.runtimeAttachment = attachWorkerRuntime(this.worker, "simulation", {
      onFault: (fault) => {
        this.rejectAll(new Error(`Dense simulation worker failed: ${fault.message}`));
      },
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  public async initialize(options: {
    readonly identity: DenseEngineSessionIdentity;
    readonly topology: CompiledSimulationTopology;
    readonly perfEnabled: boolean;
    readonly debugDataEnabled: boolean;
    readonly powerMode: "real" | "infinite";
    readonly powerConsumptionOverride: number | undefined;
    readonly migration?: SimulationTopologyMigration;
    readonly regional?: {
      readonly baseId: string;
      readonly table: RegionalWarehouseOutletTable;
      readonly initialWarehouseCounts: Readonly<Record<string, number>>;
      readonly captureIntermediateFrames: boolean;
    };
  }): Promise<Extract<DenseWorkerResponse, { readonly type: "topology-ready" }>> {
    this.rejectAll(new Error("Dense simulation session was replaced by a newer topology."));
    this.identity = options.identity;
    this.nextSequence = 1;
    return this.request({
      ...this.createIdentity(),
      type: "initialize-session",
      topology: options.topology,
      perfEnabled: options.perfEnabled,
      debugDataEnabled: options.debugDataEnabled,
      powerMode: options.powerMode,
      powerConsumptionOverride: options.powerConsumptionOverride,
      ...(options.migration === undefined ? {} : { migration: options.migration }),
      ...(options.regional === undefined ? {} : { regional: options.regional }),
    }, "topology-ready");
  }

  public sendCommands(
    commands: readonly DenseWorkerCommand[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "command-ack" }>> {
    return this.request({
      ...this.createIdentity(),
      type: "command-batch",
      commands,
    }, "command-ack");
  }

  public async advanceToTick(
    targetTickNumber: number,
    wallTimeBudgetMs: number,
  ): Promise<Extract<DenseWorkerResponse, {
    readonly type: "frame-delta" | "presentation-checkpoint";
  }>> {
    const response = await this.requestAny({
      ...this.createIdentity(),
      type: "advance-budget",
      targetTickNumber,
      wallTimeBudgetMs,
    });
    if (response.type !== "frame-delta" && response.type !== "presentation-checkpoint") {
      throw new Error(`Unexpected dense worker response "${response.type}".`);
    }
    return response;
  }

  public requestPresentationCheckpoint(
    tickNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "presentation-checkpoint" }>> {
    return this.request({
      ...this.createIdentity(),
      type: "request-presentation-checkpoint",
      tickNumber,
    }, "presentation-checkpoint");
  }

  public prepareRegionalEpoch(
    epochNumber: number,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-prepared" }>> {
    return this.request({
      ...this.createIdentity(),
      type: "prepare-regional-epoch",
      epochNumber,
    }, "regional-epoch-prepared");
  }

  public applyRegionalGrant(
    epochNumber: number,
    grantedOutletIds: readonly string[],
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-grant-applied" }>> {
    return this.request({
      ...this.createIdentity(),
      type: "apply-regional-grant",
      epochNumber,
      grantedOutletIds,
    }, "regional-grant-applied");
  }

  public finalizeRegionalEpoch(
    epochNumber: number,
    nextWarehouseCounts: Readonly<Record<string, number>>,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: "regional-epoch-finalized" }>> {
    return this.request({
      ...this.createIdentity(),
      type: "finalize-regional-epoch",
      epochNumber,
      nextWarehouseCounts,
    }, "regional-epoch-finalized");
  }

  public dispose(): void {
    this.rejectAll(new Error("Dense simulation worker disposed."));
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.runtimeAttachment.dispose();
    this.worker.terminate();
    this.identity = null;
  }

  private readonly handleMessage = (event: MessageEvent<DenseWorkerResponse>): void => {
    const response = event.data;
    const identity = this.identity;
    if (
      identity === null
      || response.sessionId !== identity.sessionId
      || response.topologyVersion !== identity.topologyVersion
    ) {
      return;
    }
    const pending = this.pending.get(response.sequence);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(response.sequence);
    pending.watchdog.complete();
    if (response.type === "protocol-error") {
      pending.reject(createDenseProtocolError(response));
      return;
    }
    if (
      response.protocolVersion !== DENSE_SIMULATION_PROTOCOL_VERSION
    ) {
      pending.reject(new Error("Dense worker response identity mismatch."));
      return;
    }
    pending.resolve(response);
  };

  private readonly handleError = (event: ErrorEvent): void => {
    this.rejectAll(new Error(`Dense simulation worker crashed: ${event.message || "Unknown error"}`));
  };

  private request<TType extends DenseWorkerResponse["type"]>(
    request: DenseWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<DenseWorkerResponse, { readonly type: TType }>> {
    return this.requestAny(request).then((response) => {
      if (response.type !== expectedType) {
        throw new Error(`Unexpected dense worker response "${response.type}".`);
      }
      return response as Extract<DenseWorkerResponse, { readonly type: TType }>;
    });
  }

  private requestAny(request: DenseWorkerRequest): Promise<DenseWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timeoutMs = request.type === "initialize-session"
        ? DENSE_INITIALIZE_TIMEOUT_MS
        : DENSE_RPC_TIMEOUT_MS;
      const createDiagnostic = (activeElapsedMs: number): Readonly<Record<string, unknown>> => ({
        operation: request.type,
        sessionId: request.sessionId,
        topologyVersion: request.topologyVersion,
        sequence: request.sequence,
        activeElapsedMs: Math.round(activeElapsedMs),
      });
      const watchdog = new ActiveTimeWatchdog({
        slowWarningMs: DENSE_RPC_SLOW_WARNING_MS,
        timeoutMs,
        initiallyActive: this.isPageActive(),
        onSlow: (activeElapsedMs) => {
          logger.warn("Dense worker RPC is slow.", createDiagnostic(activeElapsedMs));
        },
        onTimeout: (activeElapsedMs) => {
          const pending = this.pending.get(request.sequence);
          if (pending === undefined) return;
          this.pending.delete(request.sequence);
          const diagnostic = createDiagnostic(activeElapsedMs);
          logger.error("Dense worker RPC timed out.", diagnostic);
          pending.reject(new Error(
            `Dense worker request "${request.type}" timed out after ${Math.round(activeElapsedMs)}ms.`,
          ));
        },
      });
      this.pending.set(request.sequence, { resolve, reject, watchdog });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        watchdog.complete();
        this.pending.delete(request.sequence);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private createIdentity(): DenseProtocolIdentity {
    const identity = this.identity;
    if (identity === null) {
      throw new Error("Dense engine bridge is not initialized.");
    }
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    return {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: identity.sessionId,
      topologyVersion: identity.topologyVersion,
      sequence,
    };
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.watchdog.complete();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private isPageActive(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }
}

export function releaseDenseResponseBuffers(response: DenseWorkerResponse): ArrayBuffer[] {
  if (response.type === "topology-ready") {
    return [...collectDenseFrameTransferables(response.initialDelta)];
  }
  if (response.type === "frame-delta" || response.type === "presentation-checkpoint") {
    return [...collectDenseFrameTransferables(response.delta)];
  }
  if (response.type === "regional-epoch-prepared") {
    return response.intermediateDeltas.flatMap((delta) => [
      ...collectDenseFrameTransferables(delta),
    ]);
  }
  if (response.type === "regional-epoch-finalized") {
    return [...collectDenseFrameTransferables(response.delta)];
  }
  return [];
}

function createDenseProtocolError(
  response: Extract<DenseWorkerResponse, { readonly type: "protocol-error" }>,
): Error {
  return new Error(`Dense simulation protocol ${response.code}: ${response.message}`);
}
