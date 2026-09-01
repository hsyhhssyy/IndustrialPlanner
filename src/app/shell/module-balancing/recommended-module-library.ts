import type {
  ModuleBalancingIOPort,
  ModuleBalancingRecommendedModule,
} from "@/app/toolbox-types";
import { migrateModuleIconItemIds } from "@/app/module-icon";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

const RECOMMENDED_MODULE_INDEX_PATH = "module-balancing/recommended-modules/index.json";

export interface RecommendedModuleLibrary {
  readonly version: string;
  readonly modules: readonly ModuleBalancingRecommendedModule[];
}

export async function readRecommendedModuleLibrary(): Promise<RecommendedModuleLibrary> {
  const response = await fetch(createPublicAssetUrl(RECOMMENDED_MODULE_INDEX_PATH));
  if (!response.ok) {
    throw new Error(`Failed to load recommended module library: ${response.status}`);
  }

  const library = normalizeRecommendedModuleLibrary(await response.json());
  if (library === null) {
    throw new Error("Invalid recommended module library payload.");
  }

  return library;
}

export function normalizeRecommendedModuleLibrary(value: unknown): RecommendedModuleLibrary | null {
  if (!isRecord(value) || typeof value.version !== "string" || !Array.isArray(value.modules)) {
    return null;
  }

  const seenModuleIds = new Set<string>();
  const modules = value.modules.flatMap((module) => {
    const normalized = normalizeRecommendedModule(module);
    if (normalized === null || seenModuleIds.has(normalized.id)) {
      return [];
    }
    seenModuleIds.add(normalized.id);
    return [normalized];
  });

  if (modules.length !== value.modules.length) {
    return null;
  }

  return {
    version: value.version,
    modules,
  };
}

function normalizeRecommendedModule(value: unknown): ModuleBalancingRecommendedModule | null {
  if (!isRecord(value) || value.sourceType !== "recommended") {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const name = normalizeNonEmptyString(value.name);
  const inputs = normalizePorts(value.inputs);
  const outputs = normalizePorts(value.outputs);
  const iconItemIds = inputs === null || outputs === null
    ? null
    : migrateModuleIconItemIds(
      value.iconItemIds,
      value.iconId,
      inputs.map((port) => port.itemId),
      outputs.map((port) => port.itemId),
    );
  if (
    id === null
    || name === null
    || iconItemIds === null
    || inputs === null
    || outputs === null
    || (inputs.length === 0 && outputs.length === 0)
  ) {
    return null;
  }

  return {
    id,
    name,
    color: normalizeNonEmptyString(value.color) ?? "#4f8cff",
    iconItemIds,
    notes: typeof value.notes === "string" ? value.notes : "",
    inputs,
    outputs,
    sourceType: "recommended",
  };
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
    const perMinute = typeof port.perMinute === "number" ? port.perMinute : Number.NaN;
    if (itemId === null || !Number.isFinite(perMinute) || perMinute <= 0) {
      return [];
    }

    return [{ itemId, perMinute }];
  });

  return ports.length === value.length ? ports : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
