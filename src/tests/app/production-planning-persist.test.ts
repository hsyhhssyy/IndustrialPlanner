import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultPlannerSessionState,
  loadPlannerState,
  normalizePlannerPersistedState,
  normalizePlannerSessionState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import { saveToIndexedDbWithVersion } from "@/shared/storage/migration";
import type { IndexedDbStorageLocation } from "@/shared/storage/browser-storage";
import { createProductionPlanningDemandSignature } from "@/app/shell/production-planning/production-planning-persist";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

const PLANNER_STORE_LOCATION: IndexedDbStorageLocation = {
  databaseName: "v3-industrial-planner",
  storeName: "planner-state",
  key: "v3",
};

function createPlannerState(patch: Partial<PlannerPersistedState> = {}): PlannerPersistedState {
  return {
    targets: [{ id: "target-1", itemId: "item_iron_plate", perMinute: 60 }],
    supplies: [],
    displayMode: "item",
    viewMode: "tree",
    recipeChoices: {},
    recipeChoicesDemandSignature: null,
    sourceConfig: {
      waterPolicy: "use-byproduct",
      acidPolicy: "use-byproduct",
      sewagePolicy: "external-supply",
    },
    session: createDefaultPlannerSessionState(),
    ...patch,
  };
}

describe("production planning persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists and reloads planner session state", async () => {
    const state = createPlannerState({
      viewMode: "flow",
      session: {
        activeScreen: "result",
        flowViewport: { x: 120, y: -64, scale: 1.75 },
        treeScrollTop: 360,
      },
    });

    await savePlannerState(state);

    await expect(loadPlannerState()).resolves.toEqual(state);
  });

  it("persists infinite external supply rows", async () => {
    const state = createPlannerState({
      supplies: [{ id: "supply-1", itemId: "item_iron_nugget", perMinute: 60, isInfinite: true }],
    });

    await savePlannerState(state);

    await expect(loadPlannerState()).resolves.toEqual(state);
  });

  it("adds default session state when migrating legacy planner data", async () => {
    const legacyState = {
      targets: [{ id: "target-1", itemId: "item_iron_plate", perMinute: 60 }],
      supplies: [],
      displayMode: "device",
      viewMode: "flow",
      recipeChoices: { item_iron_plate: "recipe-1" },
      sourceConfig: {
        waterPolicy: "dump-byproduct",
        acidPolicy: "use-byproduct",
        sewagePolicy: "self-produce",
      },
    };

    await saveToIndexedDbWithVersion(PLANNER_STORE_LOCATION, 1, legacyState);

    const loaded = await loadPlannerState();

    expect(loaded).toEqual({
      ...legacyState,
      recipeChoicesDemandSignature: null,
      session: createDefaultPlannerSessionState(),
    });
  });

  it("normalizes invalid session values", () => {
    expect(normalizePlannerSessionState({
      activeScreen: "unknown",
      flowViewport: { x: Number.NaN, y: "bad", scale: -1 },
      treeScrollTop: -20,
    })).toEqual(createDefaultPlannerSessionState());
  });

  it("normalizes legacy persisted state without a session field", () => {
    const normalized = normalizePlannerPersistedState({
      targets: [{ id: "target-1", itemId: "item_iron_plate", perMinute: 60 }],
      supplies: [],
      displayMode: "item",
      viewMode: "tree",
      recipeChoices: {},
      sourceConfig: {
        waterPolicy: "use-byproduct",
        acidPolicy: "use-byproduct",
        sewagePolicy: "external-supply",
      },
    });

    expect(normalized?.session).toEqual(createDefaultPlannerSessionState());
    expect(normalized?.recipeChoicesDemandSignature).toBeNull();
  });

  it("creates stable demand signatures without row ids", () => {
    const sourceConfig = {
      waterPolicy: "use-byproduct" as const,
      acidPolicy: "use-byproduct" as const,
      sewagePolicy: "external-supply" as const,
    };

    expect(createProductionPlanningDemandSignature({
      targets: [
        { id: "target-a", itemId: "item_carbon_mtl", perMinute: 60 },
      ],
      supplies: [
        { id: "supply-a", itemId: "item_iron_nugget", perMinute: 30, isInfinite: true },
      ],
      sourceConfig,
    })).toBe(createProductionPlanningDemandSignature({
      targets: [
        { id: "target-b", itemId: "item_carbon_mtl", perMinute: 60 },
      ],
      supplies: [
        { id: "supply-b", itemId: "item_iron_nugget", perMinute: 30, isInfinite: true },
      ],
      sourceConfig,
    }));
  });
});
