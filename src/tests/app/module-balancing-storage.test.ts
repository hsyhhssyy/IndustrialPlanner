// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listModuleBalancingCustomModuleEntries,
  loadModuleBalancingState,
  normalizeModuleBalancingState,
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

  it("migrates legacy single icons to an item array", () => {
    const state = normalizeModuleBalancingState({
      customModules: [{
        id: "module-legacy",
        name: "Legacy",
        color: "#4f8cff",
        iconId: "grinder_1",
        notes: "",
        inputs: [{ itemId: "item-a", perMinute: 1 }],
        outputs: [{ itemId: "item-b", perMinute: 2 }],
        sourceType: "custom",
      }],
    });

    expect(state.customModules[0]).toMatchObject({
      schemaVersion: 2,
      iconItemIds: ["item-b"],
    });
  });

  it("does not interpret a future custom module schema", () => {
    const state = normalizeModuleBalancingState({
      customModules: [{
        schemaVersion: 3,
        id: "module-future",
        name: "Future",
        color: "#4f8cff",
        iconItemIds: ["item-a"],
        notes: "",
        inputs: [],
        outputs: [{ itemId: "item-a", perMinute: 2 }],
        sourceType: "custom",
      }],
    });

    expect(state.customModules).toEqual([]);
  });

  it("persists module balancing state in IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const state = createDefaultModuleBalancingState();
    state.customModules.push({
      schemaVersion: 2,
      id: "module-a",
      name: "模块 A",
      color: "#4f8cff",
      iconItemIds: ["item-a", "item-b"],
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
    localStorage.setItem("v3-sync-provider", "webdav");

    const state = createDefaultModuleBalancingState();
    state.customModules.push({
      schemaVersion: 2,
      id: "module-a",
      name: "模块 A",
      color: "#4f8cff",
      iconItemIds: ["item-a", "item-b"],
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
        schemaVersion: 2,
        id: "module-a",
        name: "模块 A restored",
        color: "#4f8cff",
        iconItemIds: ["item-a", "item-b"],
        notes: "",
        folderId: null,
        inputs: [{ itemId: "item-a", perMinute: 1 }],
        outputs: [{ itemId: "item-b", perMinute: 2 }],
        sourceType: "custom",
      },
      deletedAt: null,
    });

    await expect(listModuleBalancingCustomModuleEntries()).resolves.toMatchObject([
      {
        id: "module-a",
        deletedAt: null,
        value: { name: "模块 A restored", iconItemIds: ["item-a", "item-b"] },
      },
    ]);
  });
});
