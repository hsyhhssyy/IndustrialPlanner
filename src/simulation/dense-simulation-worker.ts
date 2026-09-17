import { createRegistryContract } from "@/registry";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";

import { DenseWorkerRuntime } from "./dense/dense-worker-runtime";
import { collectDenseFrameTransferables } from "./dense/dense-frame-delta";
import { type DenseWorkerRequest, type DenseWorkerResponse } from "./dense/dense-worker-protocol";

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
  // AI-REMOVED 2026-09-17:
  // Reason: Dense Worker 不再返回区域 Epoch 帧，区域合图使用普通帧与检查点响应。
  // Trigger: 用户要求 Dense 多基地使用单 Worker 与单共享仓库。
  // Evidence: DenseWorkerResponse 已移除 regional-epoch-* variants。
  // Replacement: 上方 frame-delta / presentation-checkpoint 分支。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // if (response.type === "regional-epoch-prepared") {
  //   return response.intermediateDeltas.flatMap((delta) => [
  //     ...collectDenseFrameTransferables(delta),
  //   ]);
  // }
  // if (response.type === "regional-epoch-finalized") {
  //   return [...collectDenseFrameTransferables(response.delta), response.bufferIds.buffer];
  // }
  return [];
}
