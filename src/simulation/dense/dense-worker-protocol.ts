import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";

import type { CompiledSimulationTopology } from "../types";
import type { DenseFrameDelta } from "./dense-frame-delta";
import {
  DENSE_SIMULATION_PROTOCOL_VERSION,
  type DenseTopologyLayout,
} from "./dense-topology";

export interface DenseProtocolIdentity {
  readonly protocolVersion: typeof DENSE_SIMULATION_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly topologyVersion: number;
  readonly sequence: number;
}

export type DenseWorkerCommand =
  | { readonly type: "start" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "stop" }
  | { readonly type: "reset" }
  | { readonly type: "set-speed"; readonly simulationSpeed: number }
  | { readonly type: "patch-runtime-slot"; readonly patch: SimulationRuntimeSlotPatch }
  | { readonly type: "reset-admission-counter"; readonly reset: SimulationAdmissionCounterReset };

export type DenseWorkerRequest =
  | (DenseProtocolIdentity & {
      readonly type: "initialize-session";
      readonly topology: CompiledSimulationTopology;
      readonly perfEnabled: boolean;
      readonly debugDataEnabled: boolean;
    })
  | (DenseProtocolIdentity & {
      readonly type: "command-batch";
      readonly commands: readonly DenseWorkerCommand[];
    })
  | (DenseProtocolIdentity & {
      readonly type: "advance-budget";
      readonly targetTickNumber: number;
      readonly wallTimeBudgetMs: number;
    })
  | (DenseProtocolIdentity & {
      readonly type: "request-presentation-checkpoint";
      readonly tickNumber: number;
    })
  | (DenseProtocolIdentity & {
      readonly type: "release-buffers";
      readonly bufferIds: Uint32Array;
    });

export type DenseWorkerResponse =
  | (DenseProtocolIdentity & {
      readonly type: "topology-ready";
      readonly layout: DenseTopologyLayout;
    })
  | (DenseProtocolIdentity & {
      readonly type: "frame-delta";
      readonly delta: DenseFrameDelta;
      readonly bufferIds: Uint32Array;
    })
  | (DenseProtocolIdentity & {
      readonly type: "presentation-checkpoint";
      readonly delta: DenseFrameDelta;
      readonly bufferIds: Uint32Array;
    })
  | (DenseProtocolIdentity & {
      readonly type: "command-ack";
      readonly acknowledgedRequestSequence: number;
      readonly committedTickNumber: number;
    })
  | (DenseProtocolIdentity & {
      readonly type: "protocol-error";
      readonly code:
        | "protocol-version"
        | "session-mismatch"
        | "topology-version"
        | "sequence-gap"
        | "invalid-payload"
        | "runtime-failure";
      readonly message: string;
      readonly failedRequestSequence: number | null;
    });

export class DenseMessageSequenceGate {
  private nextSequence = 1;

  public constructor(private readonly expected: {
    readonly sessionId: string;
    readonly topologyVersion: number;
  }) {
    assertDenseSessionIdentity(expected);
  }

  public get expectedSequence(): number {
    return this.nextSequence;
  }

  public accept(message: DenseProtocolIdentity): void {
    if (message.protocolVersion !== DENSE_SIMULATION_PROTOCOL_VERSION) {
      throw new Error(
        `Dense protocol version mismatch: expected ${DENSE_SIMULATION_PROTOCOL_VERSION}, received ${message.protocolVersion}.`,
      );
    }
    if (message.sessionId !== this.expected.sessionId) {
      throw new Error(
        `Dense protocol session mismatch: expected "${this.expected.sessionId}", received "${message.sessionId}".`,
      );
    }
    if (message.topologyVersion !== this.expected.topologyVersion) {
      throw new Error(
        `Dense protocol topology version mismatch: expected ${this.expected.topologyVersion}, received ${message.topologyVersion}.`,
      );
    }
    if (message.sequence !== this.nextSequence) {
      throw new Error(
        `Dense protocol sequence gap: expected ${this.nextSequence}, received ${message.sequence}.`,
      );
    }
    this.nextSequence += 1;
  }
}

export function collectDenseTopologyTransferables(
  layout: DenseTopologyLayout,
): readonly ArrayBuffer[] {
  return [
    layout.deviceNodeOffsets,
    layout.deviceNodeIndexes,
    layout.nodeDeviceIndexes,
    layout.slotNodeIndexes,
    layout.slotCanonicalIndexes,
    layout.slotCapacities,
    layout.slotInitialItemIndexes,
    layout.slotInitialCounts,
    layout.slotInitialFlags,
    layout.edgeSourceNodeIndexes,
    layout.edgeTargetNodeIndexes,
    layout.componentDeviceOffsets,
    layout.componentDeviceIndexes,
  ].map((view) => requireTransferableArrayBuffer(view));
}

function assertDenseSessionIdentity(identity: {
  readonly sessionId: string;
  readonly topologyVersion: number;
}): void {
  if (identity.sessionId.length === 0) {
    throw new Error("Dense protocol session id cannot be empty.");
  }
  if (!Number.isSafeInteger(identity.topologyVersion) || identity.topologyVersion < 1) {
    throw new Error(
      `Dense protocol topology version must be a positive safe integer; received ${identity.topologyVersion}.`,
    );
  }
}

function requireTransferableArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error("Dense simulation protocol does not support SharedArrayBuffer.");
  }
  return view.buffer;
}
