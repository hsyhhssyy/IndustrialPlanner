import type {
  ModuleBalancingCanvas,
  ModuleBalancingIOPort,
  ModuleBalancingStage,
} from "@/app/toolbox-types";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

const RECOMMENDED_CANVAS_ROOT = "module-balancing/recommended-canvases";
const RECOMMENDED_CANVAS_INDEX_PATH = `${RECOMMENDED_CANVAS_ROOT}/index.json`;

export interface RecommendedCanvasIndex {
  readonly version: string;
  readonly canvases: readonly string[];
}

export interface RecommendedCanvasRecord extends ModuleBalancingCanvas {
  readonly sourcePath: string;
}

export interface RecommendedCanvasLibrary {
  readonly version: string;
  readonly canvases: readonly RecommendedCanvasRecord[];
}

export async function readRecommendedCanvasLibrary(): Promise<RecommendedCanvasLibrary> {
  const indexResponse = await fetch(createPublicAssetUrl(RECOMMENDED_CANVAS_INDEX_PATH));
  if (!indexResponse.ok) {
    throw new Error(`Failed to load recommended canvas index: ${indexResponse.status}`);
  }

  const index = normalizeRecommendedCanvasIndex(await indexResponse.json());
  if (index === null) {
    throw new Error("Invalid recommended canvas index payload.");
  }

  const canvases = await Promise.all(index.canvases.map(async (fileName) => {
    const sourcePath = `${fileName}.json`;
    const response = await fetch(createPublicAssetUrl(`${RECOMMENDED_CANVAS_ROOT}/${sourcePath}`));
    if (!response.ok) {
      throw new Error(`Failed to load recommended canvas file: ${response.status}`);
    }

    const canvas = normalizeRecommendedCanvas(await response.json());
    if (canvas === null) {
      throw new Error(`Invalid recommended canvas document: ${sourcePath}`);
    }

    return {
      ...canvas,
      sourcePath,
    };
  }));
  const canvasIds = new Set(canvases.map((canvas) => canvas.id));
  if (canvasIds.size !== canvases.length) {
    throw new Error("Recommended canvas ids must be unique.");
  }

  return {
    version: index.version,
    canvases,
  };
}

export function normalizeRecommendedCanvasIndex(value: unknown): RecommendedCanvasIndex | null {
  if (!isRecord(value) || !isNonEmptyString(value.version) || !Array.isArray(value.canvases)) {
    return null;
  }

  const canvases = value.canvases.filter(isSafeAssetName);
  if (canvases.length !== value.canvases.length || new Set(canvases).size !== canvases.length) {
    return null;
  }

  return {
    version: value.version.trim(),
    canvases,
  };
}

export function normalizeRecommendedCanvas(value: unknown): ModuleBalancingCanvas | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const name = normalizeNonEmptyString(value.name);
  const globalInputs = normalizePorts(value.globalInputs);
  const stages = normalizeStages(value.stages);
  const warehouseCapacity = value.warehouseCapacity === null
    ? null
    : normalizePositiveNumber(value.warehouseCapacity);
  if (
    id === null
    || name === null
    || globalInputs === null
    || stages === null
    || warehouseCapacity === undefined
  ) {
    return null;
  }

  return {
    id,
    name,
    folderId: null,
    globalInputs,
    stages,
    warehouseCapacity,
  };
}

function normalizeStages(value: unknown): ModuleBalancingStage[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const seenStageIds = new Set<string>();
  const stages = value.flatMap((stage) => {
    if (!isRecord(stage)) {
      return [];
    }

    const id = normalizeNonEmptyString(stage.id);
    const name = normalizeNonEmptyString(stage.name);
    if (id === null || name === null || seenStageIds.has(id) || !Array.isArray(stage.entries)) {
      return [];
    }

    const entries = stage.entries.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const moduleId = normalizeNonEmptyString(entry.moduleId);
      const quantity = normalizePositiveNumber(entry.quantity);
      return moduleId === null || quantity === undefined ? [] : [{ moduleId, quantity }];
    });
    if (entries.length !== stage.entries.length) {
      return [];
    }

    seenStageIds.add(id);
    return [{ id, name, entries }];
  });

  return stages.length === value.length ? stages : null;
}

function normalizePorts(value: unknown): ModuleBalancingIOPort[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ports = value.flatMap((port) => {
    if (!isRecord(port)) {
      return [];
    }

    const itemId = normalizeNonEmptyString(port.itemId);
    const infinite = port.infinite === true;
    const perMinute = infinite
      ? port.perMinute === undefined ? 0 : normalizeNonNegativeNumber(port.perMinute)
      : normalizePositiveNumber(port.perMinute);
    return itemId === null || perMinute === undefined
      ? []
      : [{ itemId, perMinute, ...(infinite ? { infinite: true } : {}) }];
  });

  return ports.length === value.length ? ports : null;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function isSafeAssetName(value: unknown): value is string {
  return isNonEmptyString(value) && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
