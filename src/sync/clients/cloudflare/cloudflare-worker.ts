/// <reference lib="webworker" />

import { handleCfRequest } from './cloudflare-worker-runtime';
import type {
  CfWorkerRequest,
  CfWorkerResponse,
} from './cloudflare-worker-protocol';

const workerScope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<CfWorkerRequest>) => void,
  ): void;
  postMessage(response: CfWorkerResponse): void;
};

workerScope.addEventListener('message', (event) => {
  void handleCfRequest(event.data).then((response) => {
    workerScope.postMessage(response);
  });
});
