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
export {
  DenseLocalRegionalBasePort,
  type DenseLocalRegionalBasePortOptions,
} from "./dense-regional-base-port";
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
