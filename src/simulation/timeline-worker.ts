import { createRegistryContract } from "@/registry";
import { TimelineWorkerRuntime } from "./legacy/timeline-worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type { TimelineWorkerRequest, TimelineWorkerResponse } from "./legacy/timeline-worker-protocol";

let runtime: TimelineWorkerRuntime | undefined;
const workerScope = globalThis as unknown as {
  postMessage(response: TimelineWorkerResponse): void;
};

installWorkerEndpoint({
  workerKind: "timeline",
  handleMessage: (event, registrySnapshot) => {
    runtime ??= new TimelineWorkerRuntime(createRegistryContract(registrySnapshot));
    const response = runtime.handleRequest(event.data as TimelineWorkerRequest);
    workerScope.postMessage(response);
  },
});
