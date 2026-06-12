import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import {
  convertLegacyBlueprintJson,
  convertLegacyV2LayoutToWorldDocument,
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  normalizeLegacyV2BlueprintSnapshotsStorage,
  normalizeLegacyV2LayoutsByBaseStorage,
  readFromLocalStorage,
  replaceWorldDocuments,
  saveBlueprintDocument,
  upsertBlueprintFolder,
  writeEditorPersistState,
} from "@/shared/storage";

import {
  V2_ACTIVE_BASE_LOCAL_STORAGE_KEY,
  V2_LAYOUTS_BY_BASE_LOCAL_STORAGE_KEY,
  V2_LEGACY_USER_BLUEPRINTS_LOCAL_STORAGE_KEY,
  V2_USER_BLUEPRINTS_LOCAL_STORAGE_KEY,
  V3_MIGRATED_BLUEPRINT_FOLDER_ID,
  V3_MIGRATION_ID_PREFIX,
} from "./v2-migration-keys";
import { migrateV2ModuleBalancingState } from "./v2-module-balancing-migration";
import {
  type V2MigrationCompletionSummary,
  writeV2MigrationCompletedState,
} from "./v2-migration-state";
import { cleanupDiscardableV2LocalStorageBeforeV3Boot } from "./v2-storage-cleanup";

export interface V2MigrationExecutorResult extends V2MigrationCompletionSummary {
  readonly loadedBaseId: string | null;
}

export async function executeV2Migration(
  appHost: AppHost,
): Promise<V2MigrationExecutorResult> {
  cleanupDiscardableV2LocalStorageBeforeV3Boot();

  const migratedWorldDocuments = createMigratedWorldDocuments();
  const didReplaceWorldDocuments = await replaceWorldDocuments(migratedWorldDocuments);

  if (!didReplaceWorldDocuments) {
    throw new Error("Failed to replace v3 world documents.");
  }

  writeEditorPersistState({
    lastDocumentId: resolveLastMigratedDocumentId(migratedWorldDocuments),
    latestDocumentIdByBaseId: Object.fromEntries(
      migratedWorldDocuments.map((document) => [document.baseId, document.documentKey]),
    ),
  });

  const migratedBlueprintCount = await migrateUserBlueprints();
  const moduleResult = migrateV2ModuleBalancingState(
    appHost.internalState.workbench.toolbox.moduleBalancing,
  );

  runInAction(() => {
    Object.assign(
      appHost.internalState.workbench.toolbox.moduleBalancing,
      moduleResult.state,
    );
  });

  const loadedBaseId = await loadMigratedActiveBase(appHost, migratedWorldDocuments);
  const summary: V2MigrationCompletionSummary = {
    migratedMapCount: migratedWorldDocuments.length,
    migratedBlueprintCount,
    migratedModuleCanvasCount: moduleResult.migratedCanvasCount,
    migratedCustomModuleCount: moduleResult.migratedCustomModuleCount,
  };

  writeV2MigrationCompletedState(summary);

  return {
    ...summary,
    loadedBaseId,
  };
}

function createMigratedWorldDocuments() {
  const layoutsByBase = normalizeLegacyV2LayoutsByBaseStorage(
    readFromLocalStorage<unknown>(V2_LAYOUTS_BY_BASE_LOCAL_STORAGE_KEY),
  );

  return Object.values(layoutsByBase)
    .sort((left, right) => left.baseId.localeCompare(right.baseId))
    .flatMap((layout) => {
      const document = convertLegacyV2LayoutToWorldDocument(layout, {
        documentKey: createMigratedWorldDocumentKey(layout.baseId),
        blueprintId: `${V3_MIGRATION_ID_PREFIX}map-blueprint:${stableKeyPart(layout.baseId)}`,
        entityIdPrefix: `v2map_${stableKeyPart(layout.baseId)}`,
        name: `迁移地图 - ${layout.baseId}`,
      });

      return document === null ? [] : [document];
    });
}

async function migrateUserBlueprints(): Promise<number> {
  const folder = await upsertBlueprintFolder({
    folderId: V3_MIGRATED_BLUEPRINT_FOLDER_ID,
    name: "迁移的蓝图",
    parentFolderId: null,
  });

  if (folder === null) {
    throw new Error("Failed to create migrated blueprint folder.");
  }

  const snapshots = readLegacyUserBlueprintSnapshots();
  const usedBlueprintIds = new Set<string>();
  let migratedCount = 0;

  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const blueprintId = createMigratedBlueprintId(snapshot.id, snapshotIndex, usedBlueprintIds);
    const blueprint = convertLegacyBlueprintJson(
      createLegacyBlueprintJsonFromV2BlueprintSnapshot(snapshot),
      {
        blueprintId,
        entityIdPrefix: `v2bp_${stableKeyPart(blueprintId)}`,
      },
    );

    if (blueprint === null) {
      continue;
    }

    const savedRecord = await saveBlueprintDocument(blueprint, {
      parentFolderId: folder.folderId,
    });

    if (savedRecord !== null) {
      migratedCount += 1;
    }
  }

  return migratedCount;
}

function readLegacyUserBlueprintSnapshots() {
  const snapshots = normalizeLegacyV2BlueprintSnapshotsStorage(
    readFromLocalStorage<unknown>(V2_USER_BLUEPRINTS_LOCAL_STORAGE_KEY),
  );

  if (snapshots.length > 0) {
    return snapshots;
  }

  return normalizeLegacyV2BlueprintSnapshotsStorage(
    readFromLocalStorage<unknown>(V2_LEGACY_USER_BLUEPRINTS_LOCAL_STORAGE_KEY),
  );
}

async function loadMigratedActiveBase(
  appHost: AppHost,
  migratedWorldDocuments: readonly { baseId: string; documentKey: string }[],
): Promise<string | null> {
  const editor = appHost.workspace.editor;
  const activeBaseId = resolveMigratedActiveBaseId(migratedWorldDocuments);

  if (editor === null || activeBaseId === null) {
    return null;
  }

  const didLoad = await editor.actions.loadLatestBaseDocument(activeBaseId);

  return didLoad ? activeBaseId : null;
}

function resolveMigratedActiveBaseId(
  migratedWorldDocuments: readonly { baseId: string }[],
): string | null {
  const activeBaseId = normalizeOptionalString(
    readFromLocalStorage<unknown>(V2_ACTIVE_BASE_LOCAL_STORAGE_KEY),
  );

  if (
    activeBaseId !== null
    && migratedWorldDocuments.some((document) => document.baseId === activeBaseId)
  ) {
    return activeBaseId;
  }

  return migratedWorldDocuments[0]?.baseId ?? null;
}

function resolveLastMigratedDocumentId(
  migratedWorldDocuments: readonly { baseId: string; documentKey: string }[],
): string | null {
  const activeBaseId = resolveMigratedActiveBaseId(migratedWorldDocuments);

  if (activeBaseId !== null) {
    return migratedWorldDocuments.find((document) => document.baseId === activeBaseId)?.documentKey ?? null;
  }

  return migratedWorldDocuments[0]?.documentKey ?? null;
}

function createMigratedWorldDocumentKey(baseId: string): string {
  return `${V3_MIGRATION_ID_PREFIX}map:${stableKeyPart(baseId)}`;
}

function createMigratedBlueprintId(
  legacyBlueprintId: string,
  snapshotIndex: number,
  usedBlueprintIds: Set<string>,
): string {
  const baseId = `${V3_MIGRATION_ID_PREFIX}blueprint:${stableKeyPart(legacyBlueprintId)}`;

  if (!usedBlueprintIds.has(baseId)) {
    usedBlueprintIds.add(baseId);

    return baseId;
  }

  const indexedId = `${baseId}:${snapshotIndex}`;
  usedBlueprintIds.add(indexedId);

  return indexedId;
}

function stableKeyPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");

  return normalized === "" ? "unknown" : normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
