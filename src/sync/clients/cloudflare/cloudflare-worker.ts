/// <reference lib="webworker" />

import { handleCfRequest } from './cloudflare-worker-runtime';
import { installWorkerEndpoint } from '@/shared/worker/worker-endpoint';
import type {
  CfWorkerRequest,
  CfWorkerResponse,
} from './cloudflare-worker-protocol';

const workerScope = globalThis as unknown as {
  postMessage(response: CfWorkerResponse): void;
};

installWorkerEndpoint({
  workerKind: 'cloudflare',
  handleMessage: async (event) => {
    const response = await handleCfRequest(event.data as CfWorkerRequest);
    workerScope.postMessage(response);
  },
});
