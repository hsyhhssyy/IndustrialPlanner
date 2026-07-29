import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "./migration";
import type { IndexedDbStorageLocation } from "./browser-storage";
import { emitStorageChange } from "./storage-change-event";

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
  processExpandedItems: string[];
  processViewport: PlannerFlowViewportState;
}

export interface PlannerPersistedState {
  targets: Array<{ id: string; itemId: string; perMinute: number; isInfinite?: boolean }>;
  supplies: Array<{ id: string; itemId: string; perMinute: number; isInfinite?: boolean }>;
  displayMode: "item" | "device";
  viewMode: "tree" | "flow" | "process";
  recipeChoices: Record<string, string>;
  recipeChoicesDemandSignature: string | null;
  sourceConfig: {
    waterPolicy: "use-byproduct" | "dump-byproduct";
    acidPolicy: "use-byproduct" | "dump-byproduct";
    sewagePolicy: "external-supply" | "self-produce";
    waterPurifierPolicy: "disabled" | "use-when-available";
    includeDeviceMinimumConsumption: "none" | "fractional" | "ceil";
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
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

export function createDefaultPlannerSessionState(): PlannerSessionState {
  return {
    activeScreen: "input",
    flowViewport: { ...DEFAULT_PLANNER_FLOW_VIEWPORT_STATE },
    treeScrollTop: 0,
    processExpandedItems: [],
    processViewport: { ...DEFAULT_PLANNER_FLOW_VIEWPORT_STATE },
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
    processExpandedItems: isRecord(value.processExpandedItems) && Array.isArray(value.processExpandedItems)
      ? value.processExpandedItems.filter((v): v is string => typeof v === "string")
      : [],
    processViewport: normalizeProcessViewport(value.processViewport),
  };
}

function normalizeProcessViewport(value: unknown): PlannerFlowViewportState {
  if (!isRecord(value)) {
    return { ...DEFAULT_PLANNER_FLOW_VIEWPORT_STATE };
  }
  const defaultViewport = DEFAULT_PLANNER_FLOW_VIEWPORT_STATE;
  return {
    x: normalizeFiniteNumber(value.x, defaultViewport.x),
    y: normalizeFiniteNumber(value.y, defaultViewport.y),
    scale: normalizePositiveNumber(value.scale, defaultViewport.scale),
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
    viewMode: normalizePersistedViewMode(value.viewMode),
    recipeChoices: normalizeRecipeChoices(value.recipeChoices),
    recipeChoicesDemandSignature: typeof value.recipeChoicesDemandSignature === "string"
      ? value.recipeChoicesDemandSignature
      : null,
    sourceConfig: {
      waterPolicy: sourceConfig.waterPolicy === "dump-byproduct" ? "dump-byproduct" : DEFAULT_PLANNER_SOURCE_CONFIG.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy === "dump-byproduct" ? "dump-byproduct" : DEFAULT_PLANNER_SOURCE_CONFIG.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy === "self-produce" ? "self-produce" : DEFAULT_PLANNER_SOURCE_CONFIG.sewagePolicy,
      waterPurifierPolicy: sourceConfig.waterPurifierPolicy === "use-when-available"
        ? "use-when-available"
        : DEFAULT_PLANNER_SOURCE_CONFIG.waterPurifierPolicy,
      includeDeviceMinimumConsumption: normalizeDeviceMinimumConsumptionMode(sourceConfig.includeDeviceMinimumConsumption),
    },
    session: normalizePlannerSessionState(value.session),
  };
}

function normalizeDeviceMinimumConsumptionMode(
  value: unknown,
): PlannerPersistedState["sourceConfig"]["includeDeviceMinimumConsumption"] {
  if (value === "none" || value === "fractional" || value === "ceil") {
    return value;
  }

  // 兼容旧版布尔值：true=小数计算，false=不计算。
  if (value === false) {
    return "none";
  }

  return DEFAULT_PLANNER_SOURCE_CONFIG.includeDeviceMinimumConsumption;
}

// ── 数据库定位 ──

const PLANNER_STORE_LOCATION: IndexedDbStorageLocation = {
  databaseName: "v3-industrial-planner",
  storeName: "planner-state",
  key: "v3",
};

const CURRENT_VERSION = 3;
const MIGRATIONS: StorageMigration<PlannerPersistedState>[] = [
  {
    version: 2,
    migrate: (raw) => normalizePlannerPersistedState(raw),
  },
  {
    version: 3,
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
  emitStorageChange({
    assetType: "production-planning",
    assetId: "v3",
    timestamp: Date.now(),
  });
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

function normalizePersistedViewMode(value: unknown): "tree" | "flow" | "process" {
  if (value === "flow") return "flow";
  if (value === "process") return "process";
  return "tree";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
