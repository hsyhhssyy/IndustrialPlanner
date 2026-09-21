import type { RegistryContract } from "@/domain/registry/registry-contract";

import { DenseFrameEmitter } from "./dense-frame-emitter";
// AI-REMOVED 2026-09-17:
// Reason: Dense Worker 不再为区域 Epoch 收集中间 FrameDelta。
// Trigger: 单复合 kernel 直接发布普通播放帧。
// Evidence: prepareRegionalEpoch 已归档。
// Replacement: DenseFrameEmitter.emitTick in advance
// Risk: Low。
// Human Review: Required
//
// Original code:
// import type { DenseFrameDelta } from "./dense-frame-delta";
import {
  DenseSimulationKernel,
  type DenseKernelCheckpoint,
} from "./dense-simulation-kernel";
import { compileDenseTopologyLayout, type DenseTopologyLayout } from "./dense-topology";
import type { CompiledSimulationTopology } from "../contracts";
import {
  DenseMessageSequenceGate,
  type DenseProtocolIdentity,
  type DenseWorkerCommand,
  type DenseWorkerRequest,
  type DenseWorkerResponse,
} from "./dense-worker-protocol";

interface DenseWorkerSession {
  readonly identity: Pick<DenseProtocolIdentity, "sessionId" | "topologyVersion">;
  readonly gate: DenseMessageSequenceGate;
  readonly kernel: DenseSimulationKernel;
  emitter: DenseFrameEmitter;
  readonly topology: CompiledSimulationTopology;
  readonly layout: DenseTopologyLayout;
  readonly checkpoints: Map<number, DenseKernelCheckpoint>;
  runningState: "start" | "pause" | "stop";
  simulationSpeed: number;
}

// AI-REMOVED 2026-09-04:
// Reason: Dense standard tick rate 改为 2 TPS 后，固定 20 tick 不再等于一秒。
// Trigger: ST2-RQ-024 要求所有 tick/second 换算基于 topology.standardTickRate。
// Evidence: checkpoint 判断现直接使用 session.topology.standardTickRate。
// Replacement: DenseWorkerRuntime.advance 中的 topology rate 判断。
// Risk: Low
// Human Review: Required
//
// Original code:
// const DENSE_CHECKPOINT_INTERVAL_TICKS = 20;
const DENSE_MAX_CHECKPOINTS = 900;

export class DenseWorkerRuntime {
  private session: DenseWorkerSession | null = null;

  public constructor(private readonly registry: RegistryContract) {}

  public handleRequest(request: DenseWorkerRequest): DenseWorkerResponse {
    try {
      if (request.type === "initialize-session") {
        return this.initialize(request);
      }

      const session = this.requireSession(request);
      session.gate.accept(request);
      switch (request.type) {
        case "advance-budget":
          return this.advance(session, request);
        case "command-batch":
          return this.applyCommands(session, request);
        case "request-presentation-checkpoint":
          return this.createCheckpoint(session, request);
        case "switch-presentation":
          return this.switchPresentation(session, request);
        case "ensure-buffered-through":
          return this.ensureBufferedThrough(session, request);
        case "release-buffers":
          return this.createCommandAck(session, request, request.sequence);
      }
    } catch (error) {
      return createProtocolError(request, error);
    }
  }

  public reset(): void {
    this.session = null;
  }

  private initialize(
    request: Extract<DenseWorkerRequest, { readonly type: "initialize-session" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "topology-ready" }> {
    const previousSession = this.session;
    if (request.migration !== undefined) {
      if (previousSession === null) {
        throw new Error("Dense topology migration requires an active previous session.");
      }
      if (request.migration.baseTickNumber !== previousSession.kernel.tickNumber) {
        throw new Error(
          `Dense topology migration anchor ${request.migration.baseTickNumber} does not match current tick ${previousSession.kernel.tickNumber}.`,
        );
      }
    }
    const identity = {
      sessionId: request.sessionId,
      topologyVersion: request.topologyVersion,
    } as const;
    const gate = new DenseMessageSequenceGate(identity);
    gate.accept(request);
    const layout = compileDenseTopologyLayout(request.topology, this.registry);
    const kernel = new DenseSimulationKernel(request.topology, layout, this.registry);
    if (request.migration !== undefined && previousSession !== null) {
      kernel.restoreMigratedRuntime(
        previousSession.kernel,
        request.migration.resetDeviceIds,
      );
      // AI-REMOVED 2026-09-20:
      // Reason: Dense migration 不再接受因当前基地变化产生的跨设备 ID 映射。
      // Trigger: ST2-RQ-036 以稳定规范执行身份和 switch-presentation 取代迁移补偿。
      // Evidence: createDenseRegionalDocument 对单/多基地均生成稳定基地作用域 ID。
      // Replacement: DenseWorkerRuntime.switchPresentation
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // request.migration.previousDeviceIdByNextDeviceId,
    }
    kernel.setPowerMode(request.powerMode);
    kernel.setPowerConsumptionOverride(request.powerConsumptionOverride);
    const emitter = new DenseFrameEmitter(
      request.topology,
      layout,
      identity,
      request.presentationDeviceIds,
      request.operatingStatusDeviceIds,
    );
    const initialDelta = request.migration === undefined
      ? emitter.emitInitial(kernel)
      : emitter.emitCheckpoint(kernel);
    this.session = {
      identity,
      gate,
      kernel,
      emitter,
      topology: request.topology,
      layout,
      checkpoints: new Map([[kernel.tickNumber, kernel.createCheckpoint()]]),
      runningState: request.migration === undefined
        ? "stop"
        : (previousSession?.runningState ?? "stop"),
      simulationSpeed: request.migration === undefined
        ? 1
        : (previousSession?.simulationSpeed ?? 1),
    };
    return {
      ...createResponseIdentity(request),
      type: "topology-ready",
      layout,
      initialDelta,
      runtimeRetainedStateCount: this.session.checkpoints.size,
    };
  }

  private advance(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "advance-budget" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "frame-delta" | "presentation-checkpoint" }> {
    if (!Number.isSafeInteger(request.targetTickNumber) || request.targetTickNumber < 0) {
      throw new Error(`Dense target tick must be a non-negative safe integer; received ${request.targetTickNumber}.`);
    }
    if (!Number.isFinite(request.wallTimeBudgetMs) || request.wallTimeBudgetMs < 0) {
      throw new Error(`Dense wall-time budget must be finite and non-negative; received ${request.wallTimeBudgetMs}.`);
    }
    if (request.targetTickNumber < session.kernel.tickNumber) {
      throw new Error(
        `Dense runtime cannot advance backwards from ${session.kernel.tickNumber} to ${request.targetTickNumber}.`,
      );
    }
    if (request.targetTickNumber === session.kernel.tickNumber) {
      return {
        ...createResponseIdentity(request),
        type: "presentation-checkpoint",
        delta: session.emitter.emitCheckpoint(session.kernel),
        bufferIds: new Uint32Array(),
        runtimeRetainedStateCount: session.checkpoints.size,
      };
    }

    const result = session.kernel.advanceToTick(request.targetTickNumber, (committed) => {
      if (committed.tickNumber % session.topology.standardTickRate === 0) {
        this.retainCheckpoint(session, session.kernel.createCheckpoint());
      }
    });
    if (result === null) {
      throw new Error("Dense runtime advance did not produce a committed tick.");
    }
    return {
      ...createResponseIdentity(request),
      type: "frame-delta",
      delta: session.emitter.emitTick(session.kernel, result),
      bufferIds: new Uint32Array(),
      runtimeRetainedStateCount: session.checkpoints.size,
    };
  }

  private applyCommands(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "command-batch" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "command-ack" }> {
    for (const command of request.commands) {
      this.applyCommand(session, command);
    }
    return this.createCommandAck(session, request, request.sequence);
  }

  /*
   * AI-REMOVED 2026-09-17:
   * Reason: Dense Worker 不再执行多 Worker 区域 Epoch、仓库授权与最终提交。
   * Trigger: 用户要求 Dense 区域模式使用单复合 kernel 和同一仓库。
   * Evidence: DenseWorkerRequest 已移除对应 RPC；区域模式通过普通 advance-budget 推进。
   * Replacement: DenseWorkerRuntime.advance
   * Risk: Low；Legacy Worker Runtime 保留自己的区域协议。
   * Human Review: Required
   *
   * Original code:
  private prepareRegionalEpoch(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "prepare-regional-epoch" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "regional-epoch-prepared" }> {
    const intermediateDeltas: DenseFrameDelta[] = [];
    const prepared = session.kernel.prepareRegionalEpoch(
      request.epochNumber,
      session.captureIntermediateRegionalFrames
        ? (result) => intermediateDeltas.push(session.emitter.emitTick(session.kernel, result))
        : undefined,
    );
    return {
      ...createResponseIdentity(request),
      type: "regional-epoch-prepared",
      epochNumber: request.epochNumber,
      ...prepared,
      intermediateDeltas,
    };
  }

  private applyRegionalGrant(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "apply-regional-grant" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "regional-grant-applied" }> {
    const applied = session.kernel.applyRegionalGrant(
      request.epochNumber,
      request.grantedOutletIds,
    );
    session.pendingRegionalGrant = applied;
    return {
      ...createResponseIdentity(request),
      type: "regional-grant-applied",
      epochNumber: request.epochNumber,
      tickNumber: applied.result.tickNumber,
      deposits: applied.deposits,
    };
  }

  private finalizeRegionalEpoch(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "finalize-regional-epoch" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "regional-epoch-finalized" }> {
    const applied = session.pendingRegionalGrant;
    const phaseTicks = resolveRecipePhaseTicks(session.topology.standardTickRate);
    if (
      applied === null
      || phaseTicks === null
      || applied.result.tickNumber !== 1 + request.epochNumber * phaseTicks
    ) {
      throw new Error(`Dense regional epoch ${request.epochNumber} has no applied grant.`);
    }
    session.kernel.finalizeRegionalEpoch(request.epochNumber, request.nextWarehouseCounts);
    const delta = session.emitter.emitTick(session.kernel, applied.result);
    session.pendingRegionalGrant = null;
    this.retainCheckpoint(session, session.kernel.createCheckpoint());
    return {
      ...createResponseIdentity(request),
      type: "regional-epoch-finalized",
      epochNumber: request.epochNumber,
      tickNumber: delta.tickNumber,
      delta,
      bufferIds: new Uint32Array(),
      runtimeRetainedStateCount: session.checkpoints.size,
    };
  }
   */

  private applyCommand(session: DenseWorkerSession, command: DenseWorkerCommand): void {
    switch (command.type) {
      case "start":
      case "resume":
        session.runningState = "start";
        return;
      case "pause":
        session.runningState = "pause";
        return;
      case "stop":
        session.runningState = "stop";
        return;
      case "reset":
        this.reset();
        return;
      case "set-speed":
        if (!Number.isFinite(command.simulationSpeed) || command.simulationSpeed < 0) {
          throw new Error(`Dense simulation speed is invalid: ${command.simulationSpeed}.`);
        }
        session.simulationSpeed = command.simulationSpeed;
        return;
      case "set-power-mode":
        session.kernel.setPowerMode(command.powerMode);
        this.invalidateBufferedFuture(session);
        return;
      case "set-power-consumption-override":
        session.kernel.setPowerConsumptionOverride(command.powerConsumptionOverride);
        this.invalidateBufferedFuture(session);
        return;
      case "patch-runtime-slot":
        session.kernel.patchRuntimeSlot(command.patch);
        this.invalidateBufferedFuture(session);
        return;
      case "reset-admission-counter":
        session.kernel.resetAdmissionCounter(command.reset);
        this.invalidateBufferedFuture(session);
        return;
    }
  }

  private createCheckpoint(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, {
      readonly type: "request-presentation-checkpoint" | "switch-presentation";
    }>,
  ): Extract<DenseWorkerResponse, { readonly type: "presentation-checkpoint" }> {
    if (!Number.isSafeInteger(request.tickNumber) || request.tickNumber < 0) {
      throw new Error(`Dense checkpoint tick is invalid: ${request.tickNumber}.`);
    }
    const presentationKernel = request.tickNumber === session.kernel.tickNumber
      ? session.kernel
      : this.rebuildKernelAtTick(session, request.tickNumber);
    return {
      ...createResponseIdentity(request),
      type: "presentation-checkpoint",
      delta: session.emitter.emitCheckpoint(presentationKernel),
      bufferIds: new Uint32Array(),
      runtimeRetainedStateCount: session.checkpoints.size,
    };
  }

  private switchPresentation(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "switch-presentation" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "presentation-checkpoint" }> {
    session.emitter = new DenseFrameEmitter(
      session.topology,
      session.layout,
      session.identity,
      request.presentationDeviceIds,
      request.operatingStatusDeviceIds,
    );
    return this.createCheckpoint(session, request);
  }

  private ensureBufferedThrough(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "ensure-buffered-through" }>,
  ): Extract<DenseWorkerResponse, { readonly type: "buffer-ready" }> {
    if (!Number.isSafeInteger(request.tickNumber) || request.tickNumber < 0) {
      throw new Error(`Dense buffer target tick is invalid: ${request.tickNumber}.`);
    }
    let bufferedThroughTickNumber = session.kernel.tickNumber;
    for (const tickNumber of session.checkpoints.keys()) {
      bufferedThroughTickNumber = Math.max(bufferedThroughTickNumber, tickNumber);
    }
    if (request.tickNumber > bufferedThroughTickNumber) {
      const bufferKernel = this.rebuildKernelAtTick(session, bufferedThroughTickNumber);
      bufferKernel.advanceToTick(request.tickNumber, (committed) => {
        if (committed.tickNumber % session.topology.standardTickRate === 0) {
          this.retainCheckpoint(session, bufferKernel.createCheckpoint());
        }
      });
      this.retainCheckpoint(session, bufferKernel.createCheckpoint());
      bufferedThroughTickNumber = request.tickNumber;
    }
    return {
      ...createResponseIdentity(request),
      type: "buffer-ready",
      bufferedThroughTickNumber,
      runtimeRetainedStateCount: session.checkpoints.size,
    };
  }

  private rebuildKernelAtTick(
    session: DenseWorkerSession,
    tickNumber: number,
  ): DenseSimulationKernel {
    let checkpoint = session.checkpoints.get(0);
    for (const [candidateTickNumber, candidate] of session.checkpoints) {
      if (
        candidateTickNumber <= tickNumber
        && (checkpoint === undefined || candidateTickNumber > checkpoint.tickNumber)
      ) {
        checkpoint = candidate;
      }
    }
    if (session.kernel.tickNumber <= tickNumber) {
      const current = session.kernel.createCheckpoint();
      if (checkpoint === undefined || current.tickNumber > checkpoint.tickNumber) {
        checkpoint = current;
      }
    }
    if (checkpoint === undefined) {
      throw new Error(`Dense checkpoint ${tickNumber} is outside retained history.`);
    }
    const kernel = new DenseSimulationKernel(session.topology, session.layout, this.registry);
    kernel.restoreCheckpoint(checkpoint);
    kernel.advanceToTick(tickNumber);
    return kernel;
  }

  private retainCheckpoint(
    session: DenseWorkerSession,
    checkpoint: DenseKernelCheckpoint,
  ): void {
    session.checkpoints.set(checkpoint.tickNumber, checkpoint);
    while (session.checkpoints.size > DENSE_MAX_CHECKPOINTS) {
      const oldestTickNumber = session.checkpoints.keys().next().value as number | undefined;
      if (oldestTickNumber === undefined) break;
      if (oldestTickNumber === 0 && session.checkpoints.size > 1) {
        const secondTickNumber = [...session.checkpoints.keys()][1];
        if (secondTickNumber === undefined) break;
        session.checkpoints.delete(secondTickNumber);
      } else {
        session.checkpoints.delete(oldestTickNumber);
      }
    }
  }

  private invalidateBufferedFuture(session: DenseWorkerSession): void {
    const currentTickNumber = session.kernel.tickNumber;
    for (const tickNumber of session.checkpoints.keys()) {
      if (tickNumber > currentTickNumber) {
        session.checkpoints.delete(tickNumber);
      }
    }
    session.checkpoints.set(currentTickNumber, session.kernel.createCheckpoint());
  }

  private createCommandAck(
    session: DenseWorkerSession,
    request: DenseWorkerRequest,
    acknowledgedRequestSequence: number,
  ): Extract<DenseWorkerResponse, { readonly type: "command-ack" }> {
    return {
      ...createResponseIdentity(request),
      type: "command-ack",
      acknowledgedRequestSequence,
      committedTickNumber: session.kernel.tickNumber,
    };
  }

  private requireSession(_request: DenseWorkerRequest): DenseWorkerSession {
    const session = this.session;
    if (session === null) {
      throw new Error("Dense worker session is not initialized.");
    }
    return session;
  }
}

function createResponseIdentity(request: DenseWorkerRequest): DenseProtocolIdentity {
  return {
    protocolVersion: request.protocolVersion,
    sessionId: request.sessionId,
    topologyVersion: request.topologyVersion,
    sequence: request.sequence,
  };
}

function createProtocolError(
  request: DenseWorkerRequest,
  error: unknown,
): Extract<DenseWorkerResponse, { readonly type: "protocol-error" }> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...createResponseIdentity(request),
    type: "protocol-error",
    code: classifyProtocolError(message),
    message,
    failedRequestSequence: request.sequence,
  };
}

function classifyProtocolError(
  message: string,
): Extract<DenseWorkerResponse, { readonly type: "protocol-error" }>["code"] {
  if (message.includes("protocol version")) return "protocol-version";
  if (message.includes("session mismatch") || message.includes("not initialized")) {
    return "session-mismatch";
  }
  if (message.includes("topology version")) return "topology-version";
  if (message.includes("sequence gap")) return "sequence-gap";
  if (message.includes("invalid") || message.includes("must be")) return "invalid-payload";
  return "runtime-failure";
}
