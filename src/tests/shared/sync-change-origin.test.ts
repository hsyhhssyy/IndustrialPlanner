import { afterEach, describe, expect, it, vi } from "vitest";

import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import {
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync change origin", () => {
  it("preserves snapshot origins from the write boundary", () => {
    const store = createSnapshotStore({ value: 0 });
    const origins: string[] = [];
    const unsubscribe = store.subscribe((_snapshot, context) => {
      origins.push(context.origin);
    });

    store.setSnapshot({ value: 1 });
    store.setSnapshot({ value: 2 }, { origin: "remote-sync" });
    unsubscribe();

    expect(origins).toEqual(["initial", "local", "remote-sync"]);
  });

  it("preserves local and remote-sync origins for persisted assets", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const origins: string[] = [];
    const unsubscribe = subscribeToStorageChanges((event) => {
      if (event.assetType === "production-planning") {
        origins.push(event.origin);
      }
    });
    const state: PlannerPersistedState = {
      targets: [],
      supplies: [],
      displayMode: "item",
      viewMode: "tree",
      recipeChoices: {},
      recipeChoicesDemandSignature: null,
      sourceConfig: {
        waterPolicy: "use-byproduct",
        acidPolicy: "use-byproduct",
        sewagePolicy: "external-supply",
        waterPurifierPolicy: "disabled",
        includeDeviceMinimumConsumption: "fractional",
      },
      session: {
        activeScreen: "input",
        flowViewport: { x: 0, y: 0, scale: 1 },
        treeScrollTop: 0,
        processExpandedItems: [],
        processViewport: { x: 0, y: 0, scale: 1 },
      },
    };

    try {
      await savePlannerState(state);
      await savePlannerState(state, { origin: "remote-sync" });
    } finally {
      unsubscribe();
    }

    expect(origins).toEqual(["local", "remote-sync"]);
  });
});
