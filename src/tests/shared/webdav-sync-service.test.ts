// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWebDavSyncService,
} from "@/sync";
import type { WebDavStorageClient } from "@/sync";
import type {
  WebDavSyncAdapter,
  WebDavSyncAdapterResult,
} from "@/sync";

describe("webdav-sync-service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips sync while disabled", async () => {
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: false, url: "", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
    });

    await service.syncNow("manual");

    expect(adapter.sync).not.toHaveBeenCalled();
    expect(service.getStatus().phase).toBe("idle");
  });

  it("runs adapters when enabled", async () => {
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
    });

    const status = await service.syncNow("manual");

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(status.lastUploadAt).not.toBeNull();
  });

  it("does not show save feedback for periodic downloads or empty periodic passes", async () => {
    const observedSaveStates: string[] = [];
    const adapter = createAdapter();
    adapter.sync
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      })
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "idle",
        changedAssetIds: [],
      });
    const service = createWebDavSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
      }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      onStatusChange: (status) => {
        observedSaveStates.push(status.saveState);
      },
    });

    await service.syncNow("interval");
    await service.syncNow("interval");

    expect(observedSaveStates).not.toContain("pending");
    expect(observedSaveStates).not.toContain("saving");
    expect(service.getStatus().saveState).toBe("idle");
  });

  it("reports conflicts", async () => {
    const onConflict = vi.fn();
    const adapter: WebDavSyncAdapter = {
      id: "conflicting-adapter",
      mode: "full-no-revision",
      sync: vi.fn(async (): Promise<WebDavSyncAdapterResult> => ({
        adapterId: "conflicting-adapter",
        mode: "full-no-revision",
        status: "conflict",
        changedAssetIds: ["single"],
      })),
    };
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      onConflict,
    });

    const status = await service.syncNow("manual");

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(status.phase).toBe("error");
    expect(status.lastError).toBe("WebDAV sync conflict");
  });

  it("retries transient sync failures", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    adapter.sync
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      });
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      retryDelaysMs: [10],
    });

    const syncPromise = service.syncNow("manual");
    await vi.advanceTimersByTimeAsync(10);
    const status = await syncPromise;

    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(status.phase).toBe("idle");
    expect(status.lastError).toBeNull();
  });

  it("runs before and after hooks around adapters", async () => {
    const calls: string[] = [];
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      beforeSync: () => { calls.push("before"); },
      afterSync: () => { calls.push("after"); },
    });

    await service.syncNow("manual");

    expect(calls).toEqual(["before", "after"]);
  });

  it("debounces local changes", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();
    service.notifyLocalChange();
    service.notifyLocalChange();
    expect(service.getStatus().saveState).toBe("pending");
    expect(service.getStatus().pendingLocalChangeCount).toBe(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(adapter.sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.sync).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("idle");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("keeps a failed save visible until a later sync succeeds", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();
    adapter.sync.mockRejectedValueOnce(new Error("server unavailable"));

    service.notifyLocalChange();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("error");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(1);
    expect(service.getStatus().saveError).toBe("server unavailable");

    let releaseSuccessfulSync!: () => void;
    const successfulSyncGate = new Promise<void>((resolve) => {
      releaseSuccessfulSync = resolve;
    });
    adapter.sync.mockImplementationOnce(async () => {
      await successfulSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });

    const successfulSync = service.syncNow("manual");
    expect(service.getStatus().saveState).toBe("error");
    releaseSuccessfulSync();
    await successfulSync;

    expect(service.getStatus().saveState).toBe("idle");
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    expect(service.getStatus().saveError).toBeNull();
    service.stop();
  });

  it("does not acknowledge a newer local change with an older in-flight snapshot", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      retryDelaysMs: [],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    adapter.sync.mockClear();

    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    adapter.sync.mockImplementationOnce(async () => {
      await firstSaveGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });

    service.notifyLocalChange();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    service.notifyLocalChange();
    releaseFirstSave();
    await vi.waitFor(() => {
      expect(service.getStatus().pendingLocalChangeCount).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(service.getStatus().saveState).toBe("idle");
    });
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("clears pending save feedback when WebDAV is disabled", async () => {
    let enabled = true;
    const adapter = createAdapter();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    service.notifyLocalChange();
    expect(service.getStatus().saveState).toBe("pending");

    enabled = false;
    await service.syncNow("settings-change");

    expect(service.getStatus().saveState).toBe("idle");
    expect(service.getStatus().pendingLocalChangeCount).toBe(0);
    service.stop();
  });

  it("queues a new pass when a local change arrives during an active sync", async () => {
    let releaseFirstSync!: () => void;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementationOnce(async () => {
      await firstSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "uploaded",
        changedAssetIds: ["single"],
      };
    });
    const dispose = vi.fn();
    const service = createWebDavSyncService({
      readSettings: () => ({ enabled: true, url: "https://dav.example.test", username: "", password: "" }),
      createClient: () => ({ dispose } as unknown as WebDavStorageClient),
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });
    void service.syncNow("local-change");
    releaseFirstSync();

    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(2);
    });
    expect(dispose).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("does not chain periodic passes behind a long active sync", async () => {
    let releaseFirstSync!: () => void;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    const adapter = createAdapter();
    adapter.sync.mockImplementationOnce(async () => {
      await firstSyncGate;
      return {
        adapterId: "adapter",
        mode: "full-no-revision",
        status: "downloaded",
        changedAssetIds: ["single"],
      };
    });
    const service = createWebDavSyncService({
      readSettings: () => ({
        enabled: true,
        url: "https://dav.example.test",
        username: "",
        password: "",
      }),
      createClient: () => ({} as WebDavStorageClient),
      adapters: [adapter],
      intervalMs: 60_000,
    });

    service.start();
    await vi.waitFor(() => {
      expect(adapter.sync).toHaveBeenCalledTimes(1);
    });

    await service.syncNow("interval");
    releaseFirstSync();
    await vi.waitFor(() => {
      expect(service.getStatus().phase).toBe("idle");
    });

    expect(adapter.sync).toHaveBeenCalledTimes(1);
    service.stop();
  });
});

function createAdapter(): WebDavSyncAdapter & { readonly sync: ReturnType<typeof vi.fn> } {
  return {
    id: "adapter",
    mode: "full-no-revision",
    sync: vi.fn(async (): Promise<WebDavSyncAdapterResult> => ({
      adapterId: "adapter",
      mode: "full-no-revision",
      status: "uploaded",
      changedAssetIds: ["single"],
    })),
  };
}
