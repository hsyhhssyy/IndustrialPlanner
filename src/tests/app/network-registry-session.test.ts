// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomRegistrySession, loadReadonlyNetworkRegistry } from "@/app/custom-registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createNetworkRegistryContract, createRegistryContract } from "@/registry";
import { NETWORK_REGISTRY_SETTINGS_STORAGE_KEY } from "@/shared/storage/network-registry-settings";
import {
  activateSyncProvider,
  readSelectedSyncProvider,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";

function createHarness() {
  const builtinRegistry = createRegistryContract();
  const first = { ...builtinRegistry };
  const second = { ...builtinRegistry };
  const fetchRegistry = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchRegistry);
  const compile = vi.fn((input: unknown): RegistryContract => {
    if (input === "first") return first;
    if (input === "second") return second;
    throw new Error("entities[0].footprint");
  });
  const apply = vi.fn<(registry: RegistryContract) => Promise<void>>().mockResolvedValue(undefined);
  const newSession = () => createCustomRegistrySession({
    builtinRegistry,
    compile,
    apply,
    pageUrl: "https://planner.example.test/workbench/",
  });
  return { builtinRegistry, first, second, fetchRegistry, compile, apply, newSession };
}

function registryResponse(source: string): Response {
  return Response.json(source);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("网络 Registry 会话", () => {
  it("当页保留成功来源，重新打开时只请求已提交地址", async () => {
    const { builtinRegistry, first, second, fetchRegistry, apply, newSession } = createHarness();
    const firstSession = newSession();
    await firstSession.setEnabled(true);
    fetchRegistry.mockResolvedValueOnce(registryResponse("first"));
    await firstSession.submitUrl("./first.json");
    expect(fetchRegistry.mock.calls[0]?.[0]).toEqual(new URL("https://planner.example.test/workbench/first.json"));
    expect(apply).toHaveBeenCalledExactlyOnceWith(first);

    fetchRegistry.mockResolvedValueOnce(registryResponse("invalid"));
    await firstSession.submitUrl("./next.json");
    expect(firstSession.getState()).toMatchObject({
      url: "./next.json",
      activeUrl: "./first.json",
      error: { url: "./next.json", message: "entities[0].footprint" },
    });
    expect(apply).toHaveBeenCalledTimes(1);
    firstSession.dispose();

    const secondSession = newSession();
    fetchRegistry.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(secondSession.initialize()).resolves.toBe(builtinRegistry);
    expect(secondSession.getState()).toMatchObject({
      activeUrl: null,
      error: { url: "./next.json", message: "HTTP 503" },
    });
    fetchRegistry.mockResolvedValueOnce(registryResponse("second"));
    await secondSession.refresh();
    expect(apply).toHaveBeenLastCalledWith(second);
    expect(secondSession.getState()).toMatchObject({ activeUrl: "./next.json", error: null });
    expect(fetchRegistry).toHaveBeenCalledTimes(4);
    secondSession.dispose();
  });

  it("丢弃过期请求并在关闭时撤去当前定义", async () => {
    const { builtinRegistry, second, fetchRegistry, compile, apply, newSession } = createHarness();
    const session = newSession();
    await session.setEnabled(true);
    let finishOldRequest = (_response: Response) => {};
    fetchRegistry.mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve; }));
    const staleRequest = session.submitUrl("./slow.json");
    const staleSignal = fetchRegistry.mock.calls[0]?.[1]?.signal;
    fetchRegistry.mockResolvedValueOnce(registryResponse("second"));
    await session.submitUrl("./fast.json");
    finishOldRequest(registryResponse("first"));
    await staleRequest;

    expect(staleSignal?.aborted).toBe(true);
    expect(compile).toHaveBeenCalledExactlyOnceWith("second");
    expect(apply).toHaveBeenCalledExactlyOnceWith(second);
    expect(session.getState().activeUrl).toBe("./fast.json");
    await session.setEnabled(false);
    expect(apply).toHaveBeenLastCalledWith(builtinRegistry);
    expect(session.getState()).toMatchObject({ enabled: false, activeUrl: null, error: null });
    session.dispose();
  });

  it("嵌入模式按当前 URL 构建只读快照，下一次加载失败时回退", async () => {
    localStorage.setItem(NETWORK_REGISTRY_SETTINGS_STORAGE_KEY, JSON.stringify({
      enabled: true, url: "/external-data/default.json",
    }));
    const builtinRegistry = createRegistryContract();
    const options = {
      builtinRegistry,
      compile: createNetworkRegistryContract,
      pageUrl: "https://planner.example.test/?embed",
    };
    const source = {
      formatVersion: 1, entities: [], recipes: [],
      items: [{ uuid: "cab0deed-1111-4111-8111-123456789abc", name: "Test Charge Tile", phase: "solid" }],
    };
    const fetchRegistry = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(source))
      .mockResolvedValueOnce(Response.json({ ...source, items: [source.items[0], source.items[0]] }));
    vi.stubGlobal("fetch", fetchRegistry);

    const active = await loadReadonlyNetworkRegistry(options, new AbortController().signal);
    expect(Object.values(active.customContent.names)).toContain("Test Charge Tile");
    await expect(loadReadonlyNetworkRegistry(options, new AbortController().signal)).resolves.toBe(builtinRegistry);
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
  });

  it("启用期间禁止自动同步激活，关闭后保留无", async () => {
    const { newSession } = createHarness();
    expect(requestSyncProvider("webdav")).toBe(true);
    expect(activateSyncProvider("webdav", "example")).toBe(true);
    const session = newSession();
    await session.setEnabled(true);
    expect(readSelectedSyncProvider()).toBe("none");
    expect(requestSyncProvider("cloudflare")).toBe(false);
    expect(activateSyncProvider("webdav", "example")).toBe(false);

    await session.setEnabled(false);
    expect(readSelectedSyncProvider()).toBe("none");
    expect(requestSyncProvider("webdav")).toBe(true);
    session.dispose();
  });
});
