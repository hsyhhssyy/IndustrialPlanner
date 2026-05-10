import {
  BLUEPRINT_VERSION,
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";

const LEGACY_BLUEPRINT_SCHEMA = "industrial-planner-blueprint";
const LEGACY_BLUEPRINT_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;
const LEGACY_BLUEPRINT_HASH_SEEDS = [
  0x811c9dc5,
  0x811c9dc7,
  0x811c9dcb,
  0x811c9dd1,
];
const LEGACY_DEVICE_REMAPPERS: Readonly<Record<string, {
  readonly definitionId: string;
  readonly rotationOffset: GridRotation;
}>> = {
  belt_turn_cw_1x1: {
    definitionId: "belt_turn_ccw_1x1",
    rotationOffset: 0,
  },
  belt_turn_ccw_1x1: {
    definitionId: "belt_turn_cw_1x1",
    rotationOffset: 270,
  },
  pipe_turn_cw_1x1: {
    definitionId: "pipe_turn_ccw_1x1",
    rotationOffset: 0,
  },
  pipe_turn_ccw_1x1: {
    definitionId: "pipe_turn_cw_1x1",
    rotationOffset: 270,
  },
};

export interface LegacyBlueprintJson {
  readonly schema: string;
  readonly id?: string;
  readonly version?: string | number;
  readonly blueprintVersion?: string | number;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly baseId: string;
  readonly devices: readonly LegacyBlueprintDeviceJson[];
  readonly links?: readonly LegacyBlueprintLinkJson[];
}

export interface LegacyBlueprintDeviceJson {
  readonly typeId: string;
  readonly rotation: GridRotation;
  readonly origin: GridPoint;
  readonly config?: Record<string, unknown>;
}

export interface LegacyBlueprintLinkJson {
  readonly kind: "dark_pipe";
  readonly sourceBlueprintInstanceId: string;
  readonly targetBlueprintInstanceId: string;
}

export interface ConvertLegacyBlueprintOptions {
  readonly blueprintId?: string;
  readonly entityIdPrefix?: string;
  readonly initialGridPoint?: GridPoint;
  readonly version?: string;
}

export function convertLegacyBlueprintJson(
  value: unknown,
  options: ConvertLegacyBlueprintOptions = {},
): BlueprintDocument | null {
  const legacyBlueprint = normalizeLegacyBlueprintJson(value);

  if (legacyBlueprint === null || (legacyBlueprint.links?.length ?? 0) > 0) {
    return null;
  }

  const blueprintId = resolveBlueprintId(legacyBlueprint, options);
  const entityIdPrefix = resolveEntityIdPrefix(blueprintId, options.entityIdPrefix);
  const entities: BlueprintDocument["entities"] = {};
  const entityOrder: string[] = [];

  for (const [deviceIndex, device] of legacyBlueprint.devices.entries()) {
    const entityId = `${entityIdPrefix}_${String(deviceIndex + 1).padStart(4, "0")}`;
    const normalizedDevice = remapLegacyDevice(device);

    entities[entityId] = {
      id: entityId,
      definitionId: normalizedDevice.typeId,
      position: {
        x: normalizedDevice.origin.x,
        y: normalizedDevice.origin.y,
      },
      rotation: normalizedDevice.rotation,
      config: cloneJsonRecord(normalizedDevice.config ?? {}),
      tags: [],
    };
    entityOrder.push(entityId);
  }

  return createBlueprintDocument({
    blueprintId,
    version: normalizeOptionalString(options.version) ?? BLUEPRINT_VERSION,
    name: legacyBlueprint.name,
    description: legacyBlueprint.description,
    baseId: legacyBlueprint.baseId,
    initialGridPoint: options.initialGridPoint ?? resolveLegacyInitialGridPoint(legacyBlueprint.devices),
    entities,
    entityOrder,
    slotLinks: [],
    createdAt: legacyBlueprint.createdAt,
    updatedAt: legacyBlueprint.updatedAt ?? legacyBlueprint.createdAt,
  });
}

export function normalizeLegacyBlueprintJson(value: unknown): LegacyBlueprintJson | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schema !== LEGACY_BLUEPRINT_SCHEMA
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.baseId)
    || !Array.isArray(value.devices)
    || value.devices.length === 0
  ) {
    return null;
  }

  const devices = value.devices
    .map((device) => normalizeLegacyBlueprintDevice(device))
    .flatMap((device) => (device === null ? [] : [device]));

  if (devices.length !== value.devices.length) {
    return null;
  }

  const linksValue = value.links;
  const links = linksValue === undefined
    ? []
    : Array.isArray(linksValue)
      ? linksValue
        .map((link) => normalizeLegacyBlueprintLink(link))
        .flatMap((link) => (link === null ? [] : [link]))
      : null;

  if (links === null) {
    return null;
  }

  if (Array.isArray(linksValue) && links.length !== linksValue.length) {
    return null;
  }

  return {
    schema: LEGACY_BLUEPRINT_SCHEMA,
    id: normalizeOptionalString(value.id) ?? undefined,
    version: normalizeOptionalStringOrNumber(value.version),
    blueprintVersion: normalizeOptionalStringOrNumber(value.blueprintVersion),
    name: value.name.trim(),
    description: normalizeOptionalString(value.description) ?? undefined,
    createdAt: value.createdAt,
    updatedAt: normalizeOptionalString(value.updatedAt) ?? undefined,
    baseId: value.baseId,
    devices,
    links,
  };
}

function normalizeLegacyBlueprintDevice(
  value: unknown,
): LegacyBlueprintDeviceJson | null {
  if (!isRecord(value) || !isNonEmptyString(value.typeId) || !isGridPoint(value.origin)) {
    return null;
  }

  if (!isGridRotation(value.rotation)) {
    return null;
  }

  const configValue = value.config;

  if (configValue !== undefined && !isRecord(configValue)) {
    return null;
  }

  return {
    typeId: value.typeId,
    rotation: value.rotation,
    origin: {
      x: value.origin.x,
      y: value.origin.y,
    },
    config: configValue === undefined ? undefined : cloneJsonRecord(configValue),
  };
}

function normalizeLegacyBlueprintLink(
  value: unknown,
): LegacyBlueprintLinkJson | null {
  if (
    !isRecord(value)
    || value.kind !== "dark_pipe"
    || !isNonEmptyString(value.sourceBlueprintInstanceId)
    || !isNonEmptyString(value.targetBlueprintInstanceId)
  ) {
    return null;
  }

  return {
    kind: "dark_pipe",
    sourceBlueprintInstanceId: value.sourceBlueprintInstanceId,
    targetBlueprintInstanceId: value.targetBlueprintInstanceId,
  };
}

function remapLegacyDevice(
  device: LegacyBlueprintDeviceJson,
): LegacyBlueprintDeviceJson {
  const remapper = LEGACY_DEVICE_REMAPPERS[device.typeId];

  if (remapper === undefined) {
    return device;
  }

  return {
    ...device,
    typeId: remapper.definitionId,
    rotation: rotateGridRotation(device.rotation, remapper.rotationOffset),
  };
}

function resolveBlueprintId(
  legacyBlueprint: LegacyBlueprintJson,
  options: ConvertLegacyBlueprintOptions,
): string {
  const explicitBlueprintId = normalizeOptionalString(options.blueprintId);

  if (explicitBlueprintId !== null) {
    return explicitBlueprintId;
  }

  const legacyBlueprintId = normalizeOptionalString(legacyBlueprint.id);
  const matchedLegacyBlueprintId = legacyBlueprintId?.match(LEGACY_BLUEPRINT_ID_PATTERN)?.[1]?.toLowerCase();

  if (matchedLegacyBlueprintId !== undefined) {
    return matchedLegacyBlueprintId;
  }

  return createDeterministicUuid(JSON.stringify({
    name: legacyBlueprint.name,
    createdAt: legacyBlueprint.createdAt,
    baseId: legacyBlueprint.baseId,
    devices: legacyBlueprint.devices,
  }));
}

function resolveEntityIdPrefix(
  blueprintId: string,
  explicitPrefix: string | undefined,
): string {
  const normalizedExplicitPrefix = normalizeOptionalString(explicitPrefix);

  if (normalizedExplicitPrefix !== null) {
    return normalizedExplicitPrefix;
  }

  return `legacy_${blueprintId.replace(/-/g, "").slice(0, 8)}`;
}

function resolveLegacyInitialGridPoint(
  devices: readonly LegacyBlueprintDeviceJson[],
): GridPoint {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const device of devices) {
    minX = Math.min(minX, device.origin.x);
    minY = Math.min(minY, device.origin.y);
    maxX = Math.max(maxX, device.origin.x);
    maxY = Math.max(maxY, device.origin.y);
  }

  // 旧版公开蓝图只暴露设备 origin，不带占地包围盒；默认用 origin 包围盒中心作为放置锚点。
  return {
    x: Math.round(minX + (maxX - minX + 1) / 2),
    y: Math.round(minY + (maxY - minY + 1) / 2),
  };
}

function createDeterministicUuid(input: string): string {
  const inputBytes = new TextEncoder().encode(input);
  const bytes = new Uint8Array(16);

  LEGACY_BLUEPRINT_HASH_SEEDS.forEach((seed, seedIndex) => {
    const hash = fnv1a32(inputBytes, seed);
    const offset = seedIndex * 4;

    bytes[offset] = (hash >>> 24) & 0xff;
    bytes[offset + 1] = (hash >>> 16) & 0xff;
    bytes[offset + 2] = (hash >>> 8) & 0xff;
    bytes[offset + 3] = hash & 0xff;
  });

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

function fnv1a32(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

function formatUuidBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function cloneJsonRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function rotateGridRotation(
  rotation: GridRotation,
  offset: GridRotation,
): GridRotation {
  const nextRotation = (rotation + offset) % 360;

  switch (nextRotation) {
    case 0:
    case 90:
    case 180:
    case 270:
      return nextRotation;
    default:
      return 0;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function isGridPoint(value: unknown): value is GridPoint {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isGridRotation(value: unknown): value is GridRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
