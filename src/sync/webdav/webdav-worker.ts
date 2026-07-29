/// <reference lib="webworker" />

import { WebDavWorkerRuntime } from "./webdav-worker-runtime";
import type {
  WebDavWorkerRequest,
  WebDavWorkerResponse,
} from "./webdav-worker-protocol";

const runtime = new WebDavWorkerRuntime();
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WebDavWorkerRequest>) => void,
  ): void;
  postMessage(response: WebDavWorkerResponse): void;
};

workerScope.addEventListener("message", (event) => {
  void runtime.handleRequest(event.data).then((response) => {
    workerScope.postMessage(response);
  });
});
