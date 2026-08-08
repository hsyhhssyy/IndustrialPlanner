// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  createWebDavWorkerStorageClient,
  type WebDavWorkerRequestActivity,
} from "@/sync";

interface PostedWorkerRequest {
  readonly requestId?: number;
  readonly type?: string;
}

class FakeWorker {
  public readonly postedRequests: PostedWorkerRequest[] = [];
  public readonly terminate = vi.fn();

  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "message") {
      this.messageListeners.add(
        listener as unknown as (event: MessageEvent) => void,
      );
    } else if (type === "error") {
      this.errorListeners.add(
        listener as unknown as (event: ErrorEvent) => void,
      );
    }
  }

  public postMessage(request: PostedWorkerRequest): void {
    this.postedRequests.push(request);
  }

  public respond(requestId: number): void {
    const event = {
      data: {
        requestId,
        ok: true,
        result: null,
      },
    } as MessageEvent;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

describe("webdav-worker-client", () => {
  it("bootstraps first and never exceeds the business request concurrency limit", async () => {
    const worker = new FakeWorker();
    const activities: WebDavWorkerRequestActivity[] = [];
    const client = createWebDavWorkerStorageClient({
      baseUrl: "https://dav.example.test",
      maxConcurrentRequests: 2,
      onRequestActivityChange: (activity) => {
        activities.push(activity);
      },
      workerFactory: () => worker as unknown as Worker,
    });

    const requests = [
      client.readTextFile("one.json"),
      client.readTextFile("two.json"),
      client.readTextFile("three.json"),
      client.readTextFile("four.json"),
    ];

    expect(worker.postedRequests[0]?.type).toBe("industrial-planner/worker-bootstrap");
    const readBusinessRequests = () => worker.postedRequests.filter(
      (request): request is PostedWorkerRequest & { readonly requestId: number } =>
        typeof request.requestId === "number",
    );
    expect(readBusinessRequests()).toHaveLength(2);
    expect(activities.at(-1)).toEqual({
      activeRequestCount: 2,
      queuedRequestCount: 2,
    });

    worker.respond(readBusinessRequests()[0]!.requestId);
    await Promise.resolve();
    expect(readBusinessRequests()).toHaveLength(3);

    worker.respond(readBusinessRequests()[1]!.requestId);
    await Promise.resolve();
    expect(readBusinessRequests()).toHaveLength(4);

    worker.respond(readBusinessRequests()[2]!.requestId);
    worker.respond(readBusinessRequests()[3]!.requestId);
    await expect(Promise.all(requests)).resolves.toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(Math.max(...activities.map((activity) =>
      activity.activeRequestCount
    ))).toBe(2);
    expect(activities.at(-1)).toEqual({
      activeRequestCount: 0,
      queuedRequestCount: 0,
    });

    client.dispose?.();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
