// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  CloudflareV2WorkerClient,
  createCloudflareSyncRemote,
} from "@/sync/clients/cloudflare";
import type {
  CfV2WorkerRequest,
  CfV2WorkerResponse,
} from "@/sync/clients/cloudflare/cloudflare-v2-worker-protocol";
import type { SyncRemoteCollection } from "@/sync/clients/remote-types";

class FakeWorker {
  public readonly posted: unknown[] = [];
  public readonly terminate = vi.fn();
  private readonly messageListeners = new Set<(event: MessageEvent<CfV2WorkerResponse>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "message") {
      this.messageListeners.add(
        listener as unknown as (event: MessageEvent<CfV2WorkerResponse>) => void,
      );
    } else if (type === "error") {
      this.errorListeners.add(listener as unknown as (event: ErrorEvent) => void);
    }
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "message") {
      this.messageListeners.delete(
        listener as unknown as (event: MessageEvent<CfV2WorkerResponse>) => void,
      );
    } else if (type === "error") {
      this.errorListeners.delete(listener as unknown as (event: ErrorEvent) => void);
    }
  }

  public postMessage(value: unknown): void {
    this.posted.push(value);
  }

  public respond(requestId: number, result: unknown): void {
    const event = {
      data: { requestId, ok: true, result },
    } as MessageEvent<CfV2WorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  public fail(requestId: number, status: number): void {
    const event = {
      data: {
        requestId,
        ok: false,
        error: {
          name: "CfV2HttpError",
          message: `HTTP ${status}`,
          status,
          code: "unauthorized",
        },
      },
    } as MessageEvent<CfV2WorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  public crash(message = "worker crashed"): void {
    const event = { message } as ErrorEvent;
    for (const listener of this.errorListeners) {
      listener(event);
    }
  }
}

describe("cloudflare-v2-worker-client", () => {
  it("keeps an in-flight request alive while the tab is hidden and a session remote is disposed", async () => {
    const worker = new FakeWorker();
    const client = new CloudflareV2WorkerClient({
      workerFactory: () => worker as unknown as Worker,
    });
    const remote = createCloudflareSyncRemote({
      apiBase: "https://sync.example.test",
      spaceId: "background-upload",
      workerClient: client,
    });

    const collection: SyncRemoteCollection = {
      adapterId: "planner",
      name: "planner",
      mode: "full-no-revision",
      assetType: "planner-state",
      assetIdCodec: {
        toRemoteAssetId: (assetId) => assetId,
        toAdapterAssetId: (assetId) => assetId,
      },
      hashAlgorithm: "sha256-canonical-json-v1",
      stateKey: "planner",
    };
    const sessionPromise = remote.beginSession({
      reason: "local-change",
      collections: [collection],
    });
    const businessRequest = worker.posted.find((value): value is CfV2WorkerRequest =>
      typeof value === "object"
      && value !== null
      && "requestId" in value
    );
    expect(businessRequest?.operation.type).toBe("recover-pending-upload");

    worker.respond(businessRequest!.requestId, { recovered: false, commit: null });
    const session = await sessionPromise;
    const batch = session.beginWriteBatch();
    batch.putAsset({
      collection,
      assetId: "single",
      value: { value: 42 },
      contentHash: "sha256:adapter-hash",
      baseRevision: 0,
      baseContentHash: null,
    });
    const commitPromise = batch.commit();
    await Promise.resolve();
    const stateRequest = worker.posted.find((value): value is CfV2WorkerRequest =>
      typeof value === "object"
      && value !== null
      && "operation" in value
      && (value as CfV2WorkerRequest).operation.type === "state-read-applied-revision"
    );
    expect(stateRequest).toBeDefined();
    worker.respond(stateRequest!.requestId, "0");
    let uploadRequest: CfV2WorkerRequest | undefined;
    await vi.waitFor(() => {
      uploadRequest = worker.posted.find((value): value is CfV2WorkerRequest =>
        typeof value === "object"
        && value !== null
        && "operation" in value
        && (value as CfV2WorkerRequest).operation.type === "commit-batch"
      );
      expect(uploadRequest).toBeDefined();
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    remote.dispose?.();

    expect(worker.terminate).not.toHaveBeenCalled();
    worker.respond(uploadRequest!.requestId, {
      revision: "opaque-revision-42",
      recovered: false,
      applied: [{
        clientMutationId: (
          uploadRequest!.operation as Extract<
            CfV2WorkerRequest["operation"],
            { readonly type: "commit-batch" }
          >
        ).mutations[0]!.clientMutationId,
        adapterId: "planner",
        adapterAssetId: "single",
        assetType: "planner-state",
        assetId: "single",
        revision: 42,
        contentHash: "sha256:protocol-hash",
        deletedAt: null,
        committedAt: "2026-08-12T00:00:00.000Z",
      }],
    });
    await expect(commitPromise).resolves.toMatchObject({
      globalCursor: expect.any(Number),
      writes: [expect.objectContaining({ assetId: "single", revision: 42 })],
    });
    session.dispose?.();
    expect(worker.terminate).not.toHaveBeenCalled();

    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("recreates the Worker after a crash so the next request can recover persisted work", async () => {
    const workers: FakeWorker[] = [];
    const client = new CloudflareV2WorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const config = {
      apiBase: "https://sync.example.test",
      spaceId: "worker-restart",
      maxConcurrentRequests: 2,
      requestTimeoutMs: 30_000,
    };

    const interrupted = client.request(config, { type: "recover-pending-upload" });
    expect(workers).toHaveLength(1);
    workers[0]!.crash("synthetic crash");
    await expect(interrupted).rejects.toThrow("synthetic crash");

    const recovered = client.request(config, { type: "recover-pending-upload" });
    expect(workers).toHaveLength(2);
    const request = workers[1]!.posted.find((value): value is CfV2WorkerRequest =>
      typeof value === "object" && value !== null && "requestId" in value
    );
    workers[1]!.respond(request!.requestId, { recovered: true, commit: null });
    await expect(recovered).resolves.toEqual({ recovered: true, commit: null });

    client.dispose();
  });

  it("reports a 401 response so the main thread can clear an expired account session", async () => {
    const worker = new FakeWorker();
    const onAuthenticationFailure = vi.fn();
    const client = new CloudflareV2WorkerClient({
      workerFactory: () => worker as unknown as Worker,
      onAuthenticationFailure,
    });
    const requestPromise = client.request({
      apiBase: "https://sync.example.test",
      spaceId: "account-space",
      accessToken: "expired-token",
      maxConcurrentRequests: 1,
      requestTimeoutMs: 30_000,
    }, { type: "load-plan" });
    const request = worker.posted.find((value): value is CfV2WorkerRequest =>
      typeof value === "object" && value !== null && "requestId" in value
    );

    worker.fail(request!.requestId, 401);

    expect(onAuthenticationFailure).toHaveBeenCalledTimes(1);
    await expect(requestPromise).rejects.toMatchObject({ status: 401 });
    client.dispose();
  });
});
