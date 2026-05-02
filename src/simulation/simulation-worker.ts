import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

const runtime = new SimulationWorkerRuntime();
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SimulationWorkerRequest>) => void,
  ): void;
  postMessage(response: SimulationWorkerResponse): void;
};

workerScope.addEventListener("message", (event: MessageEvent<SimulationWorkerRequest>) => {
  const response: SimulationWorkerResponse = runtime.handleRequest(event.data);
  workerScope.postMessage(response);
});
