import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "./migration";
import type { IndexedDbStorageLocation } from "./browser-storage";

// ── 持久化状态结构 ──

export interface PlannerPersistedState {
  targets: Array<{ id: string; itemId: string; perMinute: number }>;
  supplies: Array<{ id: string; itemId: string; perMinute: number }>;
  displayMode: "item" | "device";
  viewMode: "tree" | "flow";
  recipeChoices: Record<string, string>;
  sourceConfig: {
    waterPolicy: "use-byproduct" | "dump-byproduct";
    acidPolicy: "use-byproduct" | "dump-byproduct";
    sewagePolicy: "external-supply" | "self-produce";
  };
}

// ── 数据库定位 ──

const PLANNER_STORE_LOCATION: IndexedDbStorageLocation = {
  databaseName: "industrial-planner",
  storeName: "planner-state",
  key: "v2",
};

const CURRENT_VERSION = 1;
const MIGRATIONS: StorageMigration<PlannerPersistedState>[] = [
  // 预留未来迁移步骤
];

// ── Public API ──

export async function savePlannerState(
  state: PlannerPersistedState,
): Promise<void> {
  await saveToIndexedDbWithVersion(
    PLANNER_STORE_LOCATION,
    CURRENT_VERSION,
    state,
  );
}

export async function loadPlannerState(): Promise<PlannerPersistedState | null> {
  return readFromIndexedDbWithMigration(
    PLANNER_STORE_LOCATION,
    CURRENT_VERSION,
    MIGRATIONS,
    undefined,
  );
}
