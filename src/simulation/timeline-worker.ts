import { createRegistryContract } from "@/registry";
import { TimelineWorkerRuntime } from "./timeline-worker-runtime";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
} from "./timeline-worker-protocol";

const registry = createRegistryContract();
const runtime = new TimelineWorkerRuntime(registry);
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TimelineWorkerRequest>) => void,
  ): void;
  postMessage(response: TimelineWorkerResponse): void;
};

workerScope.addEventListener("message", (event: MessageEvent<TimelineWorkerRequest>) => {
  const response = runtime.handleRequest(event.data);
  workerScope.postMessage(response);
});
