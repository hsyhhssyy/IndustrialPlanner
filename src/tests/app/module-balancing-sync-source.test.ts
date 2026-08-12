import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { createModuleBalancingSyncSources } from "@/app/module-balancing-sync-sources";
import { emitStorageChange } from "@/shared/storage/storage-change-event";

describe("module balancing sync source", () => {
  it("forwards only local storage changes to upload observers", () => {
    const [source] = createModuleBalancingSyncSources({} as AppHost);
    const listener = vi.fn();
    const unsubscribe = source!.subscribe(listener);

    emitStorageChange({
      assetType: "custom-module",
      assetId: "module-1",
      origin: "remote-sync",
      timestamp: 1,
    });
    emitStorageChange({
      assetType: "custom-module",
      assetId: "module-1",
      origin: "local",
      timestamp: 2,
    });
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
