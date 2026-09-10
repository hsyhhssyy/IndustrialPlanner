export {
  DENSE_INDEX_NONE,
  DENSE_SIMULATION_PROTOCOL_VERSION,
  compileDenseTopologyLayout,
  createDenseTopologyDictionary,
  createDenseTopologyLookup,
  type DenseTopologyDictionary,
  type DenseTopologyLayout,
  type DenseTopologyLookup,
} from "./dense-topology";
export { DenseIndexSet } from "./dense-index-set";
export { DenseRuntimeState } from "./dense-runtime-state";
export {
  DenseSimulationKernel,
  type DenseKernelTickResult,
  type DenseKernelTransferBatch,
} from "./dense-simulation-kernel";
export { DenseFrameEmitter } from "./dense-frame-emitter";
// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 两个 Host 共用契约与投影，旧入口混合查询、Worker bridge 和 legacy 控制状态。
// Replacement: src/tests/simulation/dense-regional-base-port.ts
// Risk: 异步生命周期和查询语义需由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export {
//   DenseLocalRegionalBasePort,
//   type DenseLocalRegionalBasePortOptions,
// } from "./dense-regional-base-port";

export {
  DenseRegionalSimulationSession,
  type DenseRegionalBaseInput,
  type DenseRegionalCommittedEpoch,
} from "./dense-regional-session";
export { DenseWorkerRuntime } from "./dense-worker-runtime";
export {
  createDenseEngineBridge,
  releaseDenseResponseBuffers,
  type DenseEngineBridge,
  type DenseEngineSessionIdentity,
} from "./dense-engine-bridge";
export {
  DenseFrameDeltaEncoder,
  DenseProjectionStore,
  FRAME_STATUS_INITIAL,
  FRAME_STATUS_RUNNING,
  WAREHOUSE_CLEARED,
  WAREHOUSE_PATCHED,
  WAREHOUSE_UNCHANGED,
  collectDenseFrameTransferables,
  type DenseFrameDelta,
  type DenseProjectionReadModel,
} from "./dense-frame-delta";
export {
  DenseMessageSequenceGate,
  collectDenseTopologyTransferables,
  type DenseProtocolIdentity,
  type DenseWorkerCommand,
  type DenseWorkerRequest,
  type DenseWorkerResponse,
} from "./dense-worker-protocol";

export { createDenseSimulationHost } from "./host";
