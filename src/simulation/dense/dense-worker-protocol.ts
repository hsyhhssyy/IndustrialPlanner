import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";

import type { CompiledSimulationTopology } from "../types";
import type {
  RegionWarehouseDeposit,
  RegionalWarehouseOutletTable,
} from "../regional/types";
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
  | { readonly type: "set-power-mode"; readonly powerMode: "real" | "infinite" }
  | {
      readonly type: "set-power-consumption-override";
      readonly powerConsumptionOverride: number | undefined;
      // AI-REMOVED 2026-09-03:
      // Reason: regional 初始化配置被误加到了电力覆写命令，命令运行期不应改变会话分片模式。
      // Trigger: dense regional Worker 协议 TypeScript 检查发现 initialize-session 缺少 regional 字段。
      // Evidence: DenseWorkerRuntime.initialize 读取 request.regional，而该字段只存在于错误的 command 分支。
      // Replacement: DenseWorkerRequest.initialize-session.regional。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // readonly regional?: {
      //   readonly baseId: string;
      //   readonly table: RegionalWarehouseOutletTable;
      //   readonly initialWarehouseCounts: Readonly<Record<string, number>>;
      //   readonly captureIntermediateFrames: boolean;
      // };
    }
  | { readonly type: "patch-runtime-slot"; readonly patch: SimulationRuntimeSlotPatch }
  | { readonly type: "reset-admission-counter"; readonly reset: SimulationAdmissionCounterReset };

export type DenseWorkerRequest =
  | (DenseProtocolIdentity & {
      readonly type: "initialize-session";
      readonly topology: CompiledSimulationTopology;
      readonly perfEnabled: boolean;
      readonly debugDataEnabled: boolean;
      readonly powerMode: "real" | "infinite";
      readonly powerConsumptionOverride: number | undefined;
      readonly regional?: {
        readonly baseId: string;
        readonly table: RegionalWarehouseOutletTable;
        readonly initialWarehouseCounts: Readonly<Record<string, number>>;
        readonly captureIntermediateFrames: boolean;
      };
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
    })
  | (DenseProtocolIdentity & {
      readonly type: "prepare-regional-epoch";
      readonly epochNumber: number;
    })
  | (DenseProtocolIdentity & {
      readonly type: "apply-regional-grant";
      readonly epochNumber: number;
      readonly grantedOutletIds: readonly string[];
    })
  | (DenseProtocolIdentity & {
      readonly type: "finalize-regional-epoch";
      readonly epochNumber: number;
      readonly nextWarehouseCounts: Readonly<Record<string, number>>;
    });

export type DenseWorkerResponse =
  | (DenseProtocolIdentity & {
      readonly type: "topology-ready";
      readonly layout: DenseTopologyLayout;
      readonly initialDelta: DenseFrameDelta;
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
      readonly type: "regional-epoch-prepared";
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly demandedOutletIds: readonly string[];
      readonly intermediateDeltas: readonly DenseFrameDelta[];
    })
  | (DenseProtocolIdentity & {
      readonly type: "regional-grant-applied";
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly deposits: readonly RegionWarehouseDeposit[];
    })
  | (DenseProtocolIdentity & {
      readonly type: "regional-epoch-finalized";
      readonly epochNumber: number;
      readonly tickNumber: number;
      readonly delta: DenseFrameDelta;
      readonly bufferIds: Uint32Array;
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
    layout.deviceTransportComponentIndexes,
    layout.nodeDeviceIndexes,
    layout.nodeSlotOffsets,
    layout.nodeSlotIndexes,
    layout.nodeWarehouseSinkFlags,
    layout.slotNodeIndexes,
    layout.slotCanonicalIndexes,
    layout.slotStorageIndexes,
    layout.storageSlotViewOffsets,
    layout.storageSlotViewIndexes,
    layout.slotCapacityGroupIndexes,
    layout.capacityGroupSlotOffsets,
    layout.capacityGroupSlotIndexes,
    layout.capacityGroupLimits,
    layout.slotTransportComponentIndexes,
    layout.slotCapacities,
    layout.slotDomainFlags,
    layout.slotLockItemIndexes,
    layout.slotInitialItemIndexes,
    layout.slotInitialCounts,
    layout.slotInitialFlags,
    layout.itemDomainFlags,
    layout.edgeSourceNodeIndexes,
    layout.edgeTargetNodeIndexes,
    layout.edgeAcceptKinds,
    layout.edgeAcceptValues,
    layout.edgeExcludedItemOffsets,
    layout.edgeExcludedItemIndexes,
    layout.edgeSourceRoutingGroupIndexes,
    layout.edgeSourceRoutingPortIndexes,
    layout.edgeTargetRoutingGroupIndexes,
    layout.edgeTargetRoutingPortIndexes,
    layout.routingGroupPortOffsets,
    layout.routingGroupConnectedFlags,
    layout.componentDeviceOffsets,
    layout.componentDeviceIndexes,
    layout.componentSlotOffsets,
    layout.componentSlotIndexes,
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
