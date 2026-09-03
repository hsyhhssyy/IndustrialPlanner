import type { RegistryContract } from "@/domain/registry/registry-contract";

import { DenseFrameEmitter } from "./dense-frame-emitter";
import type { DenseFrameDelta } from "./dense-frame-delta";
import {
  DenseSimulationKernel,
  type DenseKernelCheckpoint,
  type DenseRegionalGrantResult,
} from "./dense-simulation-kernel";
import {
  compileDenseTopologyLayout,
  type DenseTopologyLayout,
} from "./dense-topology";
import type { CompiledSimulationTopology } from "../types";
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
  readonly emitter: DenseFrameEmitter;
  readonly topology: CompiledSimulationTopology;
  readonly layout: DenseTopologyLayout;
  readonly checkpoints: Map<number, DenseKernelCheckpoint>;
  readonly captureIntermediateRegionalFrames: boolean;
  runningState: "start" | "pause" | "stop";
  simulationSpeed: number;
  pendingRegionalGrant: DenseRegionalGrantResult | null;
}

const DENSE_CHECKPOINT_INTERVAL_TICKS = 20;
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
        case "release-buffers":
          return this.createCommandAck(session, request, request.sequence);
        case "prepare-regional-epoch":
          return this.prepareRegionalEpoch(session, request);
        case "apply-regional-grant":
          return this.applyRegionalGrant(session, request);
        case "finalize-regional-epoch":
          return this.finalizeRegionalEpoch(session, request);
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
    const identity = {
      sessionId: request.sessionId,
      topologyVersion: request.topologyVersion,
    } as const;
    const gate = new DenseMessageSequenceGate(identity);
    gate.accept(request);
    const layout = compileDenseTopologyLayout(request.topology, this.registry);
    const kernel = new DenseSimulationKernel(
      request.topology,
      layout,
      this.registry,
      request.regional,
    );
    kernel.setPowerMode(request.powerMode);
    kernel.setPowerConsumptionOverride(request.powerConsumptionOverride);
    const emitter = new DenseFrameEmitter(request.topology, layout, identity);
    const initialDelta = emitter.emitInitial(kernel);
    this.session = {
      identity,
      gate,
      kernel,
      emitter,
      topology: request.topology,
      layout,
      checkpoints: new Map([[0, kernel.createCheckpoint()]]),
      captureIntermediateRegionalFrames:
        request.regional?.captureIntermediateFrames ?? false,
      runningState: "stop",
      simulationSpeed: 1,
      pendingRegionalGrant: null,
    };
    return {
      ...createResponseIdentity(request),
      type: "topology-ready",
      layout,
      initialDelta,
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
      };
    }

    const result = session.kernel.advanceToTick(request.targetTickNumber, (committed) => {
      if (committed.tickNumber % DENSE_CHECKPOINT_INTERVAL_TICKS === 0) {
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
    if (applied === null || applied.result.tickNumber !== 1 + request.epochNumber * 10) {
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
    };
  }

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
        return;
      case "set-power-consumption-override":
        session.kernel.setPowerConsumptionOverride(command.powerConsumptionOverride);
        return;
      case "patch-runtime-slot":
        session.kernel.patchRuntimeSlot(command.patch);
        return;
      case "reset-admission-counter":
        session.kernel.resetAdmissionCounter(command.reset);
        return;
    }
  }

  private createCheckpoint(
    session: DenseWorkerSession,
    request: Extract<DenseWorkerRequest, { readonly type: "request-presentation-checkpoint" }>,
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

  private requireSession(request: DenseWorkerRequest): DenseWorkerSession {
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
