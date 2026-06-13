import {
  convertLegacyBlueprintJson,
  type LegacyBlueprintJson,
} from "./legacy-blueprint-import";
import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";

const LEGACY_BLUEPRINT_SCHEMA = "industrial-planner-blueprint";

export interface LegacyV2DeviceSnapshot {
  readonly instanceId?: string;
  readonly blueprintInstanceId?: string;
  readonly typeId: string;
  readonly rotation: GridRotation;
  readonly origin: GridPoint;
  readonly config: Record<string, unknown>;
}

export interface LegacyV2LayoutLinkSnapshot {
  readonly kind: "dark_pipe";
  readonly sourceInstanceId: string;
  readonly targetInstanceId: string;
}

export interface LegacyV2BlueprintLinkSnapshot {
  readonly kind: "dark_pipe";
  readonly sourceBlueprintInstanceId: string;
  readonly targetBlueprintInstanceId: string;
}

export interface LegacyV2LayoutSnapshot {
  readonly baseId: string;
  readonly devices: readonly LegacyV2DeviceSnapshot[];
  readonly links: readonly LegacyV2LayoutLinkSnapshot[];
}

export interface LegacyV2BlueprintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly version?: string;
  readonly blueprintVersion?: string;
  readonly baseId: string;
  readonly devices: readonly LegacyV2DeviceSnapshot[];
  readonly links: readonly LegacyV2BlueprintLinkSnapshot[];
}

export function normalizeLegacyV2LayoutsByBaseStorage(
  value: unknown,
): Record<string, LegacyV2LayoutSnapshot> {
  const layoutsByBaseValue = isRecord(value) && isRecord(value.layoutsByBase)
    ? value.layoutsByBase
    : value;

  if (!isRecord(layoutsByBaseValue)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(layoutsByBaseValue).flatMap(([baseId, layout]) => {
      const normalizedLayout = normalizeLegacyV2Layout(layout, baseId);

      return normalizedLayout === null ? [] : [[normalizedLayout.baseId, normalizedLayout]];
    }),
  );
}

export function normalizeLegacyV2BlueprintSnapshotsStorage(
  value: unknown,
): LegacyV2BlueprintSnapshot[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.blueprints)
      ? value.blueprints
      : [];

  return list.flatMap((entry, index) => {
    const snapshot = normalizeLegacyV2BlueprintSnapshot(entry, index);

    return snapshot === null ? [] : [snapshot];
  });
}

export function filterLegacyV2LayoutBaseBuiltinEntities(
  layout: LegacyV2LayoutSnapshot,
  baseDefinitions: readonly BaseDefinition[],
): LegacyV2LayoutSnapshot {
  const baseDefinition = baseDefinitions.find((definition) =>
    definition.id === layout.baseId,
  );
  const builtinEntities = baseDefinition?.builtinEntities ?? [];

  if (builtinEntities.length === 0) {
    return layout;
  }

  const builtinSignatures = new Set(
    builtinEntities.map((entity) => createPlacementSignature({
      typeId: entity.definitionId,
      origin: entity.position,
      rotation: entity.rotation,
    })),
  );
  const removedInstanceIds = new Set<string>();
  const devices = layout.devices.filter((device) => {
    const shouldRemove = builtinSignatures.has(createPlacementSignature(device));

    if (shouldRemove && device.instanceId !== undefined) {
      removedInstanceIds.add(device.instanceId);
    }

    return !shouldRemove;
  });

  if (devices.length === layout.devices.length) {
    return layout;
  }

  return {
    ...layout,
    devices,
    links: layout.links.filter((link) =>
      !removedInstanceIds.has(link.sourceInstanceId)
      && !removedInstanceIds.has(link.targetInstanceId),
    ),
  };
}

export function createLegacyBlueprintJsonFromV2Layout(
  layout: LegacyV2LayoutSnapshot,
  options: {
    name?: string;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): LegacyBlueprintJson {
  const createdAt = normalizeTimestamp(options.createdAt) ?? new Date().toISOString();

  return {
    schema: LEGACY_BLUEPRINT_SCHEMA,
    id: `v2-layout:${layout.baseId}`,
    name: options.name ?? `v2 迁移地图 ${layout.baseId}`,
    createdAt,
    updatedAt: normalizeTimestamp(options.updatedAt) ?? createdAt,
    baseId: layout.baseId,
    devices: layout.devices.map((device, index) => ({
      blueprintInstanceId: normalizeOptionalString(device.instanceId) ?? `layout-device-${index}`,
      typeId: device.typeId,
      rotation: device.rotation,
      origin: device.origin,
      config: cloneJsonRecord(device.config),
    })),
    links: layout.links.map((link) => ({
      kind: "dark_pipe" as const,
      sourceBlueprintInstanceId: link.sourceInstanceId,
      targetBlueprintInstanceId: link.targetInstanceId,
    })),
  };
}

export function createLegacyBlueprintJsonFromV2BlueprintSnapshot(
  snapshot: LegacyV2BlueprintSnapshot,
): LegacyBlueprintJson {
  return {
    schema: LEGACY_BLUEPRINT_SCHEMA,
    id: snapshot.id,
    version: snapshot.version,
    blueprintVersion: snapshot.blueprintVersion,
    name: snapshot.name,
    description: snapshot.description,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt ?? snapshot.createdAt,
    baseId: snapshot.baseId,
    devices: snapshot.devices.map((device, index) => ({
      blueprintInstanceId: normalizeOptionalString(device.blueprintInstanceId)
        ?? normalizeOptionalString(device.instanceId)
        ?? `blueprint-device-${index}`,
      typeId: device.typeId,
      rotation: device.rotation,
      origin: device.origin,
      config: cloneJsonRecord(device.config),
    })),
    links: snapshot.links.map((link) => ({
      kind: "dark_pipe" as const,
      sourceBlueprintInstanceId: link.sourceBlueprintInstanceId,
      targetBlueprintInstanceId: link.targetBlueprintInstanceId,
    })),
  };
}

export function convertLegacyV2LayoutToBlueprintDocument(
  layout: LegacyV2LayoutSnapshot,
  options: {
    blueprintId?: string;
    entityIdPrefix?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): BlueprintDocument | null {
  const legacyBlueprint = createLegacyBlueprintJsonFromV2Layout(layout, {
    name: options.name,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
  });

  return convertLegacyBlueprintJson(legacyBlueprint, {
    blueprintId: options.blueprintId,
    entityIdPrefix: options.entityIdPrefix,
  });
}

export function convertLegacyV2LayoutToWorldDocument(
  layout: LegacyV2LayoutSnapshot,
  options: {
    documentKey?: string;
    blueprintId?: string;
    entityIdPrefix?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): WorldDocument | null {
  const blueprint = convertLegacyV2LayoutToBlueprintDocument(layout, options);

  if (blueprint === null) {
    return null;
  }

  return createWorldDocumentFromMigratedBlueprint(blueprint, {
    documentKey: options.documentKey ?? `v2-migration-map:${layout.baseId}`,
    name: options.name ?? `v2 迁移地图 ${layout.baseId}`,
  });
}

function createPlacementSignature(options: {
  readonly typeId: string;
  readonly origin: GridPoint;
  readonly rotation: GridRotation;
}): string {
  return `${options.typeId}:${options.origin.x}:${options.origin.y}:${options.rotation}`;
}

export function createWorldDocumentFromMigratedBlueprint(
  blueprint: BlueprintDocument,
  options: {
    documentKey: string;
    name: string;
  },
): WorldDocument {
  const baseDocument = createWorldDocument({ baseId: blueprint.baseId });
  const timestamp = new Date().toISOString();

  return {
    ...baseDocument,
    documentKey: options.documentKey,
    baseId: blueprint.baseId,
    meta: {
      id: `world:${options.documentKey}`,
      name: options.name,
      createdAt: blueprint.createdAt,
      updatedAt: timestamp,
    },
    entities: cloneJsonRecord(blueprint.entities) as WorldDocument["entities"],
    entityOrder: [...blueprint.entityOrder],
    slotLinks: cloneJsonArray(blueprint.slotLinks) as WorldDocument["slotLinks"],
    documentSettings: {
      ...baseDocument.documentSettings,
      viewport: {
        ...baseDocument.documentSettings.viewport,
        center: {
          x: blueprint.initialGridPoint.x,
          y: blueprint.initialGridPoint.y,
        },
      },
    },
  };
}

function normalizeLegacyV2Layout(
  value: unknown,
  fallbackBaseId: string,
): LegacyV2LayoutSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const baseId = normalizeOptionalString(value.baseId) ?? normalizeOptionalString(fallbackBaseId);
  if (baseId === null || !Array.isArray(value.devices)) {
    return null;
  }

  const devices = normalizeLegacyV2Devices(value.devices, "layout");
  if (devices.length === 0) {
    return null;
  }

  return {
    baseId,
    devices,
    links: normalizeLegacyV2LayoutLinks(value.links),
  };
}

function normalizeLegacyV2BlueprintSnapshot(
  value: unknown,
  fallbackIndex: number,
): LegacyV2BlueprintSnapshot | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.devices)
    || !isNonEmptyString(value.baseId)
  ) {
    return null;
  }

  const devices = normalizeLegacyV2Devices(value.devices, "blueprint");
  if (devices.length === 0) {
    return null;
  }

  const createdAt = normalizeTimestamp(value.createdAt) ?? new Date().toISOString();

  return {
    id: normalizeOptionalString(value.id) ?? `legacy-v2-blueprint-${fallbackIndex}`,
    name: normalizeOptionalString(value.name) ?? `v2 蓝图 ${fallbackIndex + 1}`,
    description: normalizeOptionalString(value.description) ?? undefined,
    createdAt,
    updatedAt: normalizeTimestamp(value.updatedAt) ?? createdAt,
    version: normalizeOptionalString(value.version) ?? undefined,
    blueprintVersion: normalizeOptionalStringOrNumber(value.blueprintVersion),
    baseId: value.baseId,
    devices,
    links: normalizeLegacyV2BlueprintLinks(value.links),
  };
}

function normalizeLegacyV2Devices(
  value: unknown,
  source: "layout" | "blueprint",
): LegacyV2DeviceSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry)
      || !isNonEmptyString(entry.typeId)
      || !isGridRotation(entry.rotation)
      || !isGridPoint(entry.origin)
    ) {
      return [];
    }

    const config = isRecord(entry.config) ? cloneJsonRecord(entry.config) : {};
    const instanceId = normalizeOptionalString(entry.instanceId) ?? undefined;
    const blueprintInstanceId =
      normalizeOptionalString(entry.blueprintInstanceId)
      ?? (source === "blueprint" ? `blueprint-device-${index}` : undefined);

    return [{
      instanceId,
      blueprintInstanceId,
      typeId: entry.typeId,
      rotation: entry.rotation,
      origin: {
        x: entry.origin.x,
        y: entry.origin.y,
      },
      config,
    }];
  });
}

function normalizeLegacyV2LayoutLinks(value: unknown): LegacyV2LayoutLinkSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !isRecord(entry)
      || entry.kind !== "dark_pipe"
      || !isNonEmptyString(entry.sourceInstanceId)
      || !isNonEmptyString(entry.targetInstanceId)
    ) {
      return [];
    }

    return [{
      kind: "dark_pipe" as const,
      sourceInstanceId: entry.sourceInstanceId,
      targetInstanceId: entry.targetInstanceId,
    }];
  });
}

function normalizeLegacyV2BlueprintLinks(value: unknown): LegacyV2BlueprintLinkSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !isRecord(entry)
      || entry.kind !== "dark_pipe"
      || !isNonEmptyString(entry.sourceBlueprintInstanceId)
      || !isNonEmptyString(entry.targetBlueprintInstanceId)
    ) {
      return [];
    }

    return [{
      kind: "dark_pipe" as const,
      sourceBlueprintInstanceId: entry.sourceBlueprintInstanceId,
      targetBlueprintInstanceId: entry.targetBlueprintInstanceId,
    }];
  });
}

function cloneJsonRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneJsonArray(value: readonly unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(value)) as unknown[];
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalStringOrNumber(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function isGridPoint(value: unknown): value is GridPoint {
  return (
    isRecord(value)
    && typeof value.x === "number"
    && Number.isFinite(value.x)
    && typeof value.y === "number"
    && Number.isFinite(value.y)
  );
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
