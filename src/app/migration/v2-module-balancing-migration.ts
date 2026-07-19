import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingIOPortReadWrite,
  ModuleBalancingStageModuleEntryReadWrite,
  ModuleBalancingStageReadWrite,
  ModuleBalancingStateReadWrite,
} from "@/app/state/state-impl";
import { readFromLocalStorage } from "@/shared/storage";

import {
  V2_MODULE_BALANCING_CANVASES_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_MODULES_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_SELECTED_CANVAS_ID_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_SELECTED_STAGE_ID_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_STAGES_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_SYSTEM_INPUTS_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_WAREHOUSE_ENABLED_LOCAL_STORAGE_KEY,
  V2_MODULE_BALANCING_WAREHOUSE_MAX_LOCAL_STORAGE_KEY,
  V3_MIGRATION_ID_PREFIX,
} from "./v2-migration-keys";

const LEGACY_SYSTEM_RECIPE_MODULE_ID_PREFIX = "system_recipe:";
const DEFAULT_MIGRATED_MODULE_ICON_ID = "grinder_1";
const DEFAULT_WAREHOUSE_CAPACITY = 68000;
const MODULE_COLOR_BY_LEGACY_KEY: Readonly<Record<string, string>> = {
  teal: "#47c1a8",
  blue: "#5aa4ff",
  amber: "#e6b24a",
  coral: "#ef7d6e",
  violet: "#a788ff",
  lime: "#9bc95b",
};

interface LegacyBalanceRateRow {
  readonly id: string;
  readonly itemId: string;
  readonly ratePerMinute: number;
}

interface LegacyBalanceModule {
  readonly id: string;
  readonly name: string;
  readonly colorKey: string;
  readonly inputs: readonly LegacyBalanceRateRow[];
  readonly outputs: readonly LegacyBalanceRateRow[];
}

interface LegacyStageModuleInstance {
  readonly id: string;
  readonly moduleId: string;
  readonly count: number;
}

interface LegacyBalanceStage {
  readonly id: string;
  readonly name: string;
  readonly instances: readonly LegacyStageModuleInstance[];
}

interface LegacyBalanceCanvas {
  readonly id: string;
  readonly name: string;
  readonly systemInputs: readonly LegacyBalanceRateRow[];
  readonly stages: readonly LegacyBalanceStage[];
  readonly selectedStageId: string;
}

export interface V2ModuleBalancingMigrationResult {
  readonly state: ModuleBalancingStateReadWrite;
  readonly migratedCanvasCount: number;
  readonly migratedCustomModuleCount: number;
}

export function migrateV2ModuleBalancingState(
  currentState: ModuleBalancingStateReadWrite,
): V2ModuleBalancingMigrationResult {
  const legacyModules = normalizeLegacyBalanceModules(
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_MODULES_LOCAL_STORAGE_KEY),
  );
  const legacyCanvases = readLegacyBalanceCanvases();
  const selectedCanvasId = normalizeOptionalString(
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_SELECTED_CANVAS_ID_LOCAL_STORAGE_KEY),
  );
  const warehouseCapacity = readLegacyWarehouseCapacity();
  const migratedCustomModules = legacyModules.map(convertLegacyCustomModule);
  const migratedCanvases = legacyCanvases.map((canvas) => convertLegacyCanvas(canvas, warehouseCapacity));
  const retainedCustomModules = currentState.customModules
    .filter((module) => !module.id.startsWith(V3_MIGRATION_ID_PREFIX))
    .map(cloneCustomModule);
  const retainedCanvases = currentState.canvases
    .filter((canvas) => !canvas.id.startsWith(V3_MIGRATION_ID_PREFIX))
    .map(cloneCanvas);
  const mappedSelectedCanvasId = selectedCanvasId === null
    ? null
    : createMigratedCanvasId(selectedCanvasId);
  const canvases = [...retainedCanvases, ...migratedCanvases];
  const activeCanvasId =
    mappedSelectedCanvasId !== null && canvases.some((canvas) => canvas.id === mappedSelectedCanvasId)
      ? mappedSelectedCanvasId
      : currentState.activeCanvasId !== null
        && retainedCanvases.some((canvas) => canvas.id === currentState.activeCanvasId)
        ? currentState.activeCanvasId
        : migratedCanvases[0]?.id ?? retainedCanvases[0]?.id ?? null;

  return {
    state: {
      canvases,
      customModules: [...retainedCustomModules, ...migratedCustomModules],
      activeCanvasId,
    },
    migratedCanvasCount: migratedCanvases.length,
    migratedCustomModuleCount: migratedCustomModules.length,
  };
}

export function hasV2ModuleBalancingData(): boolean {
  return (
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_MODULES_LOCAL_STORAGE_KEY) !== null
    || readFromLocalStorage<unknown>(V2_MODULE_BALANCING_CANVASES_LOCAL_STORAGE_KEY) !== null
    || readFromLocalStorage<unknown>(V2_MODULE_BALANCING_STAGES_LOCAL_STORAGE_KEY) !== null
    || readFromLocalStorage<unknown>(V2_MODULE_BALANCING_SYSTEM_INPUTS_LOCAL_STORAGE_KEY) !== null
  );
}

function readLegacyBalanceCanvases(): LegacyBalanceCanvas[] {
  const canvases = normalizeLegacyBalanceCanvases(
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_CANVASES_LOCAL_STORAGE_KEY),
  );

  if (canvases.length > 0) {
    return canvases;
  }

  const fallbackStages = normalizeLegacyBalanceStages(
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_STAGES_LOCAL_STORAGE_KEY),
  );
  const fallbackInputs = normalizeLegacyBalanceRateRows(
    readFromLocalStorage<unknown>(V2_MODULE_BALANCING_SYSTEM_INPUTS_LOCAL_STORAGE_KEY),
  );

  if (fallbackStages.length === 0 && fallbackInputs.length === 0) {
    return [];
  }

  return [{
    id: "legacy-single-canvas",
    name: "迁移的配平画布",
    systemInputs: fallbackInputs,
    stages: fallbackStages,
    selectedStageId: normalizeOptionalString(
      readFromLocalStorage<unknown>(V2_MODULE_BALANCING_SELECTED_STAGE_ID_LOCAL_STORAGE_KEY),
    ) ?? fallbackStages[0]?.id ?? "",
  }];
}

function readLegacyWarehouseCapacity(): number | null {
  const enabled = readFromLocalStorage<unknown>(V2_MODULE_BALANCING_WAREHOUSE_ENABLED_LOCAL_STORAGE_KEY);
  const isEnabled = enabled === null || enabled === true || enabled === "true";

  if (!isEnabled) {
    return null;
  }

  const rawMax = readFromLocalStorage<unknown>(V2_MODULE_BALANCING_WAREHOUSE_MAX_LOCAL_STORAGE_KEY);
  const parsedMax = typeof rawMax === "number"
    ? rawMax
    : typeof rawMax === "string"
      ? Number.parseFloat(rawMax)
      : Number.NaN;

  return Number.isFinite(parsedMax) && parsedMax > 0
    ? Math.round(parsedMax)
    : DEFAULT_WAREHOUSE_CAPACITY;
}

function convertLegacyCustomModule(
  legacyModule: LegacyBalanceModule,
): ModuleBalancingCustomModuleReadWrite {
  const inputs = legacyModule.inputs.map(convertLegacyRateRow);
  const outputs = legacyModule.outputs.map(convertLegacyRateRow);

  return {
    id: createMigratedCustomModuleId(legacyModule.id),
    name: legacyModule.name,
    color: MODULE_COLOR_BY_LEGACY_KEY[legacyModule.colorKey] ?? "#4f8cff",
    iconId: outputs[0]?.itemId ?? inputs[0]?.itemId ?? DEFAULT_MIGRATED_MODULE_ICON_ID,
    notes: "",
    inputs,
    outputs,
    sourceType: "custom",
  };
}

function convertLegacyCanvas(
  legacyCanvas: LegacyBalanceCanvas,
  warehouseCapacity: number | null,
): ModuleBalancingCanvasReadWrite {
  return {
    id: createMigratedCanvasId(legacyCanvas.id),
    name: legacyCanvas.name,
    globalInputs: legacyCanvas.systemInputs.map(convertLegacyRateRow),
    stages: legacyCanvas.stages.map((stage) => convertLegacyStage(stage, legacyCanvas.id)),
    warehouseCapacity,
  };
}

function convertLegacyStage(
  legacyStage: LegacyBalanceStage,
  legacyCanvasId: string,
): ModuleBalancingStageReadWrite {
  return {
    id: `${V3_MIGRATION_ID_PREFIX}stage:${stableKeyPart(legacyCanvasId)}:${stableKeyPart(legacyStage.id)}`,
    name: legacyStage.name,
    entries: legacyStage.instances.map(convertLegacyStageInstance),
  };
}

function convertLegacyStageInstance(
  legacyInstance: LegacyStageModuleInstance,
): ModuleBalancingStageModuleEntryReadWrite {
  return {
    moduleId: convertLegacyModuleId(legacyInstance.moduleId),
    quantity: roundToTwoDecimals(Math.max(0, legacyInstance.count)),
  };
}

function convertLegacyRateRow(
  legacyRateRow: LegacyBalanceRateRow,
): ModuleBalancingIOPortReadWrite {
  return {
    itemId: legacyRateRow.itemId,
    perMinute: roundToTwoDecimals(Math.max(0, legacyRateRow.ratePerMinute)),
  };
}

function convertLegacyModuleId(moduleId: string): string {
  return moduleId.startsWith(LEGACY_SYSTEM_RECIPE_MODULE_ID_PREFIX)
    ? moduleId.slice(LEGACY_SYSTEM_RECIPE_MODULE_ID_PREFIX.length)
    : createMigratedCustomModuleId(moduleId);
}

function createMigratedCustomModuleId(moduleId: string): string {
  return `${V3_MIGRATION_ID_PREFIX}module:${stableKeyPart(moduleId)}`;
}

function createMigratedCanvasId(canvasId: string): string {
  return `${V3_MIGRATION_ID_PREFIX}canvas:${stableKeyPart(canvasId)}`;
}

function normalizeLegacyBalanceModules(value: unknown): LegacyBalanceModule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    return [{
      id: normalizeOptionalString(entry.id) ?? `legacy-module-${index}`,
      name: normalizeOptionalString(entry.name) ?? `迁移模块 ${index + 1}`,
      colorKey: normalizeOptionalString(entry.colorKey) ?? "",
      inputs: normalizeLegacyBalanceRateRows(entry.inputs),
      outputs: normalizeLegacyBalanceRateRows(entry.outputs),
    }];
  });
}

function normalizeLegacyBalanceCanvases(value: unknown): LegacyBalanceCanvas[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const stages = normalizeLegacyBalanceStages(entry.stages);

    return [{
      id: normalizeOptionalString(entry.id) ?? `legacy-canvas-${index}`,
      name: normalizeOptionalString(entry.name) ?? `迁移画布 ${index + 1}`,
      systemInputs: normalizeLegacyBalanceRateRows(entry.systemInputs),
      stages,
      selectedStageId: normalizeOptionalString(entry.selectedStageId) ?? stages[0]?.id ?? "",
    }];
  });
}

function normalizeLegacyBalanceStages(value: unknown): LegacyBalanceStage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    return [{
      id: normalizeOptionalString(entry.id) ?? `legacy-stage-${index}`,
      name: normalizeOptionalString(entry.name) ?? `阶段 ${index + 1}`,
      instances: normalizeLegacyStageModuleInstances(entry.instances),
    }];
  });
}

function normalizeLegacyStageModuleInstances(value: unknown): LegacyStageModuleInstance[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const moduleId = normalizeOptionalString(entry.moduleId);
    if (moduleId === null) {
      return [];
    }

    return [{
      id: normalizeOptionalString(entry.id) ?? `legacy-instance-${index}`,
      moduleId,
      count: normalizeNonNegativeNumber(entry.count),
    }];
  });
}

function normalizeLegacyBalanceRateRows(value: unknown): LegacyBalanceRateRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const itemId = normalizeOptionalString(entry.itemId);
    if (itemId === null) {
      return [];
    }

    return [{
      id: normalizeOptionalString(entry.id) ?? `legacy-rate-${index}`,
      itemId,
      ratePerMinute: normalizeNonNegativeNumber(entry.ratePerMinute),
    }];
  });
}

function cloneCustomModule(
  customModule: ModuleBalancingCustomModuleReadWrite,
): ModuleBalancingCustomModuleReadWrite {
  return {
    id: customModule.id,
    name: customModule.name,
    color: customModule.color,
    iconId: customModule.iconId,
    notes: customModule.notes,
    inputs: customModule.inputs.map((port) => ({ ...port })),
    outputs: customModule.outputs.map((port) => ({ ...port })),
    sourceType: "custom",
  };
}

function cloneCanvas(
  canvas: ModuleBalancingCanvasReadWrite,
): ModuleBalancingCanvasReadWrite {
  return {
    id: canvas.id,
    name: canvas.name,
    globalInputs: canvas.globalInputs.map((port) => ({ ...port })),
    stages: canvas.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      entries: stage.entries.map((entry) => ({ ...entry })),
    })),
    warehouseCapacity: canvas.warehouseCapacity,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value)
      : Number.NaN;

  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function stableKeyPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");

  return normalized === "" ? "unknown" : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
