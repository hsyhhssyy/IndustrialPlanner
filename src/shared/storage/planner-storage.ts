import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "./migration";
import type { IndexedDbStorageLocation } from "./browser-storage";

// ── 持久化状态结构 ──

export interface PlannerFlowViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface PlannerSessionState {
  activeScreen: "input" | "result";
  flowViewport: PlannerFlowViewportState;
  treeScrollTop: number;
}

export interface PlannerPersistedState {
  targets: Array<{ id: string; itemId: string; perMinute: number; isInfinite?: boolean }>;
  supplies: Array<{ id: string; itemId: string; perMinute: number; isInfinite?: boolean }>;
  displayMode: "item" | "device";
  viewMode: "tree" | "flow";
  recipeChoices: Record<string, string>;
  sourceConfig: {
    waterPolicy: "use-byproduct" | "dump-byproduct";
    acidPolicy: "use-byproduct" | "dump-byproduct";
    sewagePolicy: "external-supply" | "self-produce";
  };
  session: PlannerSessionState;
}

export const DEFAULT_PLANNER_FLOW_VIEWPORT_STATE: PlannerFlowViewportState = {
  x: 22,
  y: 22,
  scale: 1,
};

const DEFAULT_PLANNER_SOURCE_CONFIG: PlannerPersistedState["sourceConfig"] = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
};

export function createDefaultPlannerSessionState(): PlannerSessionState {
  return {
    activeScreen: "input",
    flowViewport: { ...DEFAULT_PLANNER_FLOW_VIEWPORT_STATE },
    treeScrollTop: 0,
  };
}

export function normalizePlannerSessionState(value: unknown): PlannerSessionState {
  if (!isRecord(value)) {
    return createDefaultPlannerSessionState();
  }

  const flowViewport = isRecord(value.flowViewport)
    ? value.flowViewport
    : {};
  const defaultFlowViewport = DEFAULT_PLANNER_FLOW_VIEWPORT_STATE;

  return {
    activeScreen: value.activeScreen === "result" ? "result" : "input",
    flowViewport: {
      x: normalizeFiniteNumber(flowViewport.x, defaultFlowViewport.x),
      y: normalizeFiniteNumber(flowViewport.y, defaultFlowViewport.y),
      scale: normalizePositiveNumber(flowViewport.scale, defaultFlowViewport.scale),
    },
    treeScrollTop: Math.max(0, normalizeFiniteNumber(value.treeScrollTop, 0)),
  };
}

export function normalizePlannerPersistedState(value: unknown): PlannerPersistedState | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceConfig = isRecord(value.sourceConfig)
    ? value.sourceConfig
    : {};

  return {
    targets: normalizePorts(value.targets),
    supplies: normalizePorts(value.supplies),
    displayMode: value.displayMode === "device" ? "device" : "item",
    viewMode: value.viewMode === "flow" ? "flow" : "tree",
    recipeChoices: normalizeRecipeChoices(value.recipeChoices),
    sourceConfig: {
      waterPolicy: sourceConfig.waterPolicy === "dump-byproduct" ? "dump-byproduct" : DEFAULT_PLANNER_SOURCE_CONFIG.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy === "dump-byproduct" ? "dump-byproduct" : DEFAULT_PLANNER_SOURCE_CONFIG.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy === "self-produce" ? "self-produce" : DEFAULT_PLANNER_SOURCE_CONFIG.sewagePolicy,
    },
    session: normalizePlannerSessionState(value.session),
  };
}

// ── 数据库定位 ──

const PLANNER_STORE_LOCATION: IndexedDbStorageLocation = {
  databaseName: "industrial-planner",
  storeName: "planner-state",
  key: "v2",
};

const CURRENT_VERSION = 2;
const MIGRATIONS: StorageMigration<PlannerPersistedState>[] = [
  {
    version: 2,
    migrate: (raw) => normalizePlannerPersistedState(raw),
  },
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
  const state = await readFromIndexedDbWithMigration(
    PLANNER_STORE_LOCATION,
    CURRENT_VERSION,
    MIGRATIONS,
    undefined,
  );

  return normalizePlannerPersistedState(state);
}

function normalizePorts(value: unknown): PlannerPersistedState["targets"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((port) => {
    if (!isRecord(port)) {
      return [];
    }

    const id = typeof port.id === "string" ? port.id : "";
    const itemId = typeof port.itemId === "string" ? port.itemId : "";
    const perMinute = normalizeFiniteNumber(port.perMinute, 0);
    const isInfinite = port.isInfinite === true;

    if (!id || !itemId || perMinute <= 0) {
      return [];
    }

    return [{ id, itemId, perMinute, ...(isInfinite ? { isInfinite } : {}) }];
  });
}

function normalizeRecipeChoices(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [itemId, recipeId] of Object.entries(value)) {
    if (typeof recipeId === "string") {
      result[itemId] = recipeId;
    }
  }

  return result;
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const normalized = normalizeFiniteNumber(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
