// @vitest-environment jsdom

/**
 * 验证 sync-provider 持久化不变式。
 *
 * 核心约定：WebDAV 删除数据时通过 writeSyncProvider("none") 将 provider 切为
 * "none"，使后续 readSyncProvider() 返回 "none"，sync-host 据此派生 enabled=false。
 * 此测试确保任何改动不会破坏这条读写路径。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readSyncProvider,
  SYNC_PROVIDER_STORAGE_KEY,
  writeSyncProvider,
} from "@/sync/sync-providers";
import {
  readActiveSyncProvider,
  SYNC_PROVIDER_ACTIVATION_STORAGE_KEY,
} from "@/shared/storage/sync-provider-activation";

describe("sync-provider persistence", () => {
  const originalGetItem = localStorage.getItem;
  const originalSetItem = localStorage.setItem;

  beforeEach(() => {
    localStorage.removeItem(SYNC_PROVIDER_STORAGE_KEY);
    localStorage.removeItem(SYNC_PROVIDER_ACTIVATION_STORAGE_KEY);
  });

  afterEach(() => {
    // 恢复 localStorage 的原始实现，避免影响其他测试
    localStorage.getItem = originalGetItem;
    localStorage.setItem = originalSetItem;
  });

  it("writeSyncProvider → readSyncProvider round-trip", () => {
    writeSyncProvider("webdav");
    expect(readSyncProvider()).toBe("webdav");
    expect(readActiveSyncProvider()).toBeNull();
    expect(localStorage.getItem(SYNC_PROVIDER_STORAGE_KEY)).toBe("webdav");

    writeSyncProvider("none");
    expect(readSyncProvider()).toBe("none");
    expect(localStorage.getItem(SYNC_PROVIDER_STORAGE_KEY)).toBe("none");
  });

  it("readSyncProvider defaults to 'none' when key is missing", () => {
    localStorage.removeItem(SYNC_PROVIDER_STORAGE_KEY);
    expect(readSyncProvider()).toBe("none");
  });

  it("readSyncProvider defaults to 'none' when localStorage.get throws", () => {
    localStorage.getItem = () => {
      throw new Error("storage unavailable");
    };
    expect(readSyncProvider()).toBe("none");
  });

  it("writeSyncProvider is silent when localStorage.set throws", () => {
    localStorage.setItem = () => {
      throw new Error("storage unavailable");
    };
    // 不应抛出异常
    expect(() => writeSyncProvider("webdav")).not.toThrow();
  });

  it("WebDAV 删除后 provider 必须为 none 的核心不变式", () => {
    // 模拟删除流程后的状态：
    // 1. 先把 provider 写入 none
    writeSyncProvider("none");
    // 2. 读回必须是 none（否则 sync-host 的 deriveEnabled 会误判）
    expect(readSyncProvider()).toBe("none");
    // 3. 不是 webdav
    expect(readSyncProvider()).not.toBe("webdav");
  });
});
