// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listModuleBalancingCustomModuleEntries,
  loadModuleBalancingState,
  saveModuleBalancingState,
  writeModuleBalancingCustomModuleEntry,
} from "@/app/storage/module-balancing-storage";
import { createDefaultModuleBalancingState } from "@/app/state/state-impl";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("module-balancing-storage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("persists module balancing state in IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const state = createDefaultModuleBalancingState();
    state.customModules.push({
      id: "module-a",
      name: "模块 A",
      color: "#4f8cff",
      iconId: "device-a",
      notes: "",
      folderId: null,
      inputs: [{ itemId: "item-a", perMinute: 1 }],
      outputs: [{ itemId: "item-b", perMinute: 2 }],
      sourceType: "custom",
    });

    await saveModuleBalancingState(state);

    await expect(loadModuleBalancingState()).resolves.toMatchObject({
      customModules: [{ id: "module-a", name: "模块 A" }],
    });
  });

  it("keeps custom module tombstones for WebDAV deletion sync", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const state = createDefaultModuleBalancingState();
    state.customModules.push({
      id: "module-a",
      name: "模块 A",
      color: "#4f8cff",
      iconId: "device-a",
      notes: "",
      folderId: null,
      inputs: [{ itemId: "item-a", perMinute: 1 }],
      outputs: [{ itemId: "item-b", perMinute: 2 }],
      sourceType: "custom",
    });

    await saveModuleBalancingState(state);
    await saveModuleBalancingState({
      ...state,
      customModules: [],
    });

    await expect(listModuleBalancingCustomModuleEntries()).resolves.toMatchObject([
      { id: "module-a", deletedAt: expect.any(String) },
    ]);

    await writeModuleBalancingCustomModuleEntry({
      id: "module-a",
      value: {
        id: "module-a",
        name: "模块 A restored",
        color: "#4f8cff",
        iconId: "device-a",
        notes: "",
        folderId: null,
        inputs: [{ itemId: "item-a", perMinute: 1 }],
        outputs: [{ itemId: "item-b", perMinute: 2 }],
        sourceType: "custom",
      },
      deletedAt: null,
    });

    await expect(listModuleBalancingCustomModuleEntries()).resolves.toMatchObject([
      { id: "module-a", deletedAt: null, value: { name: "模块 A restored" } },
    ]);
  });
});