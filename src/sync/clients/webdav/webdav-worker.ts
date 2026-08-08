/// <reference lib="webworker" />

import { WebDavWorkerRuntime } from "./webdav-worker-runtime";
import { installWorkerEndpoint } from "@/shared/worker/worker-endpoint";
import type {
  WebDavWorkerRequest,
  WebDavWorkerResponse,
} from "./webdav-worker-protocol";

const runtime = new WebDavWorkerRuntime();
const workerScope = globalThis as unknown as {
  postMessage(response: WebDavWorkerResponse): void;
};

installWorkerEndpoint({
  workerKind: "webdav",
  handleMessage: async (event) => {
    const response = await runtime.handleRequest(event.data as WebDavWorkerRequest);
    workerScope.postMessage(response);
  },
});
