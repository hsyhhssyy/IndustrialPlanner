import type { ModuleBalancingIOPort } from "@/app/toolbox-types";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

const VERSION_RESOURCE_ROOT = "module-balancing/version-resources";
const VERSION_RESOURCE_INDEX_PATH = `${VERSION_RESOURCE_ROOT}/index.json`;

export interface VersionResourceIndex {
  readonly version: string;
  readonly resources: readonly string[];
}

export interface VersionResourcePreset {
  readonly id: string;
  readonly name: string;
  readonly regionTag?: string;
  readonly inputs: readonly ModuleBalancingIOPort[];
  readonly sourcePath: string;
}

export interface VersionResourceLibrary {
  readonly version: string;
  readonly resources: readonly VersionResourcePreset[];
}

export async function readVersionResourceLibrary(): Promise<VersionResourceLibrary> {
  const indexResponse = await fetch(createPublicAssetUrl(VERSION_RESOURCE_INDEX_PATH));
  if (!indexResponse.ok) {
    throw new Error(`Failed to load version resource index: ${indexResponse.status}`);
  }

  const index = normalizeVersionResourceIndex(await indexResponse.json());
  if (index === null) {
    throw new Error("Invalid version resource index payload.");
  }

  const resources = await Promise.all(index.resources.map(async (fileName) => {
    const sourcePath = `${fileName}.json`;
    const response = await fetch(createPublicAssetUrl(`${VERSION_RESOURCE_ROOT}/${sourcePath}`));
    if (!response.ok) {
      throw new Error(`Failed to load version resource file: ${response.status}`);
    }

    const preset = normalizeVersionResourcePreset(await response.json());
    if (preset === null) {
      throw new Error(`Invalid version resource document: ${sourcePath}`);
    }

    return {
      ...preset,
      sourcePath,
    };
  }));
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length) {
    throw new Error("Version resource ids must be unique.");
  }

  return {
    version: index.version,
    resources,
  };
}

export function normalizeVersionResourceIndex(value: unknown): VersionResourceIndex | null {
  if (!isRecord(value) || !isNonEmptyString(value.version) || !Array.isArray(value.resources)) {
    return null;
  }

  const resources = value.resources.filter(isSafeAssetName);
  if (resources.length !== value.resources.length || new Set(resources).size !== resources.length) {
    return null;
  }

  return {
    version: value.version.trim(),
    resources,
  };
}

export function normalizeVersionResourcePreset(
  value: unknown,
): Omit<VersionResourcePreset, "sourcePath"> | null {
  if (!isRecord(value) || !Array.isArray(value.inputs)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const name = normalizeNonEmptyString(value.name);
  const regionTag = value.regionTag === undefined
    ? undefined
    : normalizeNonEmptyString(value.regionTag);
  const inputs = value.inputs.flatMap((input) => {
    const normalized = normalizeVersionResourceInput(input);
    return normalized === null ? [] : [normalized];
  });
  if (
    id === null
    || name === null
    || regionTag === null
    || inputs.length === 0
    || inputs.length !== value.inputs.length
    || new Set(inputs.map((input) => input.itemId)).size !== inputs.length
  ) {
    return null;
  }

  return {
    id,
    name,
    ...(regionTag === undefined ? {} : { regionTag }),
    inputs,
  };
}

export function applyVersionResourcePreset(
  currentInputs: readonly ModuleBalancingIOPort[],
  preset: Pick<VersionResourcePreset, "inputs">,
): ModuleBalancingIOPort[] {
  const presetInputByItemId = new Map(preset.inputs.map((input) => [input.itemId, input]));
  const appliedItemIds = new Set<string>();
  const nextInputs: ModuleBalancingIOPort[] = [];

  for (const currentInput of currentInputs) {
    const presetInput = presetInputByItemId.get(currentInput.itemId);
    if (presetInput === undefined) {
      nextInputs.push(cloneInput(currentInput));
      continue;
    }

    if (!appliedItemIds.has(currentInput.itemId)) {
      nextInputs.push(cloneInput(presetInput));
      appliedItemIds.add(currentInput.itemId);
    }
  }

  for (const presetInput of preset.inputs) {
    if (!appliedItemIds.has(presetInput.itemId)) {
      nextInputs.push(cloneInput(presetInput));
    }
  }

  return nextInputs;
}

function normalizeVersionResourceInput(value: unknown): ModuleBalancingIOPort | null {
  if (!isRecord(value) || (value.infinite !== undefined && typeof value.infinite !== "boolean")) {
    return null;
  }

  const itemId = normalizeNonEmptyString(value.itemId);
  if (itemId === null) {
    return null;
  }

  if (value.infinite === true) {
    const perMinute = value.perMinute === undefined ? 0 : normalizeNonNegativeNumber(value.perMinute);
    return perMinute === null ? null : { itemId, perMinute, infinite: true };
  }

  const perMinute = normalizePositiveNumber(value.perMinute);
  return perMinute === null ? null : { itemId, perMinute };
}

function cloneInput(input: ModuleBalancingIOPort): ModuleBalancingIOPort {
  return {
    itemId: input.itemId,
    perMinute: input.perMinute,
    ...(input.infinite === true ? { infinite: true } : {}),
  };
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
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
