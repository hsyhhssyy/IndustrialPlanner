import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "@/shared/storage";

import { V3_MIGRATION_STATE_LOCAL_STORAGE_KEY } from "./v2-migration-keys";

export interface V2MigrationCompletionSummary {
  readonly migratedMapCount: number;
  readonly migratedBlueprintCount: number;
  readonly migratedModuleCanvasCount: number;
  readonly migratedCustomModuleCount: number;
}

export interface V2MigrationState {
  readonly schemaVersion: 1;
  readonly completedAt: string | null;
  readonly summary: V2MigrationCompletionSummary | null;
}

export function readV2MigrationState(): V2MigrationState {
  return normalizeV2MigrationState(
    readFromLocalStorage<unknown>(V3_MIGRATION_STATE_LOCAL_STORAGE_KEY),
  );
}

export function writeV2MigrationCompletedState(
  summary: V2MigrationCompletionSummary,
): V2MigrationState {
  const state: V2MigrationState = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    summary,
  };

  return saveToLocalStorage<V2MigrationState>(V3_MIGRATION_STATE_LOCAL_STORAGE_KEY, state);
}

function normalizeV2MigrationState(value: unknown): V2MigrationState {
  if (!isRecord(value)) {
    return createEmptyV2MigrationState();
  }

  const completedAt = typeof value.completedAt === "string"
    && !Number.isNaN(Date.parse(value.completedAt))
      ? value.completedAt
      : null;
  const summary = normalizeV2MigrationCompletionSummary(value.summary);

  return {
    schemaVersion: 1,
    completedAt,
    summary,
  };
}

function normalizeV2MigrationCompletionSummary(
  value: unknown,
): V2MigrationCompletionSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    migratedMapCount: normalizeCount(value.migratedMapCount),
    migratedBlueprintCount: normalizeCount(value.migratedBlueprintCount),
    migratedModuleCanvasCount: normalizeCount(value.migratedModuleCanvasCount),
    migratedCustomModuleCount: normalizeCount(value.migratedCustomModuleCount),
  };
}

function createEmptyV2MigrationState(): V2MigrationState {
  return {
    schemaVersion: 1,
    completedAt: null,
    summary: null,
  };
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
