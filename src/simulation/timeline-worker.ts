import { createRegistryContract } from "@/registry";
import { TimelineWorkerRuntime } from "./timeline-worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
} from "./timeline-worker-protocol";

const registry = createRegistryContract();
const runtime = new TimelineWorkerRuntime(registry);
const workerScope = globalThis as unknown as {
  postMessage(response: TimelineWorkerResponse): void;
};

installWorkerEndpoint({
  workerKind: "timeline",
  handleMessage: (event) => {
    const response = runtime.handleRequest(event.data as TimelineWorkerRequest);
    workerScope.postMessage(response);
  },
});
