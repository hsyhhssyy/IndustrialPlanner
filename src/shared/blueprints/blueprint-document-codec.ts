import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";

export function normalizeBlueprintDocument(value: unknown): BlueprintDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.schemaVersion !== "number"
    || !isNonEmptyString(value.blueprintId)
    || !isNonEmptyString(value.version)
    || !isNonEmptyString(value.name)
    || typeof value.description !== "string"
    || !isNonEmptyString(value.baseId)
    || !isGridPoint(value.initialGridPoint)
    || !isRecord(value.entities)
    || !isStringArray(value.entityOrder)
    || !Array.isArray(value.slotLinks)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)
  ) {
    return null;
  }

  const migration = migrateBlueprintEntityDeviceIds(
    value.entities as BlueprintDocument["entities"],
    value.schemaVersion,
  );

  if (migration === null) {
    return null;
  }

  return {
    schemaVersion: migration.schemaVersion,
    blueprintId: value.blueprintId,
    version: value.version,
    name: value.name,
    description: value.description,
    baseId: value.baseId,
    initialGridPoint: value.initialGridPoint,
    entities: migration.entities,
    entityOrder: [...value.entityOrder],
    slotLinks: [...value.slotLinks] as BlueprintDocument["slotLinks"],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isGridPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
