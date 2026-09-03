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
  DenseFrameDeltaEncoder,
  DenseProjectionStore,
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
