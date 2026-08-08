import { createRegistryContract } from "@/registry";
import { SimulationWorkerRuntime } from "./worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type {
  SimulationWorkerErrorNotification,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

const registry = createRegistryContract();
const runtime = new SimulationWorkerRuntime(registry);
const workerScope = globalThis as unknown as {
  postMessage(response: SimulationWorkerResponse | SimulationWorkerErrorNotification): void;
};

// 异步路径（setTimeout 回调中的 fillOneTick/advanceToTick）错误时主动推送到主线程
runtime.setOnError((error, tickNumber) => {
  workerScope.postMessage({
    type: "worker-error",
    error,
    tickNumber,
  });
});

installWorkerEndpoint({
  workerKind: "simulation",
  handleMessage: (event) => {
    const response = runtime.handleRequest(event.data as SimulationWorkerRequest);
    workerScope.postMessage(response);
  },
});
