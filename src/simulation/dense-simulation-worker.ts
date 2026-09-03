import { createRegistryContract } from "@/registry";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";

import {
  DenseWorkerRuntime,
  collectDenseFrameTransferables,
  type DenseWorkerRequest,
  type DenseWorkerResponse,
} from "./dense";

const runtime = new DenseWorkerRuntime(createRegistryContract());
const workerScope = globalThis as unknown as {
  postMessage(response: DenseWorkerResponse, transfer: Transferable[]): void;
};

installWorkerEndpoint({
  workerKind: "simulation",
  handleMessage: (event) => {
    const response = runtime.handleRequest(event.data as DenseWorkerRequest);
    workerScope.postMessage(response, collectResponseTransferables(response));
  },
});

function collectResponseTransferables(response: DenseWorkerResponse): Transferable[] {
  if (response.type === "topology-ready") {
    return [...collectDenseFrameTransferables(response.initialDelta)];
  }
  if (response.type === "frame-delta" || response.type === "presentation-checkpoint") {
    return [...collectDenseFrameTransferables(response.delta), response.bufferIds.buffer];
  }
  if (response.type === "regional-epoch-prepared") {
    return response.intermediateDeltas.flatMap((delta) => [
      ...collectDenseFrameTransferables(delta),
    ]);
  }
  if (response.type === "regional-epoch-finalized") {
    return [...collectDenseFrameTransferables(response.delta), response.bufferIds.buffer];
  }
  return [];
}
