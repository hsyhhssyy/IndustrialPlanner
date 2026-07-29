import type {
  SyncAssetEntry,
  SyncAssetSource,
  SyncContract,
  SyncRemoteDeviceInfo,
} from "@/domain/sync";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import {
  ensureLocalSyncOwnerState,
} from "@/shared/storage/sync-owner-storage";
import {
  listBlueprintStorageEntries,
  upsertBlueprintStorageEntry,
  type BlueprintFolderRecord,
  type BlueprintRecord,
} from "@/shared/storage/blueprint-storage";
import {
  loadPlannerState,
  normalizePlannerPersistedState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import {
  listWorldDocuments,
  normalizeWorldDocument,
  writeWorldDocument,
} from "@/shared/storage/world-document-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  type WebDavSyncAdapter,
} from "./engine/webdav-sync-adapters";
import {
  createWebDavSyncService,
  type WebDavSyncService,
} from "./engine/webdav-sync-service";
import {
  readWebDavSyncSettings,
  subscribeToWebDavSyncSettingsChanges,
  writeWebDavSyncSettings,
} from "./storage/webdav-sync-settings";
import { SyncStateImpl } from "./sync-state-impl";
import type { WebDavStorageClient } from "./webdav/webdav-client";
import { createWebDavWorkerStorageClient } from "./webdav/webdav-worker-client";

export interface SyncHostOptions {
  readonly assetSources?: readonly SyncAssetSource[];
  readonly readDebugEnabled: () => boolean;
}

export interface SyncHost extends SyncContract {
  dispose(): void;
}

export function createSyncHost(
  workspace: WorkspaceContract,
  options: SyncHostOptions,
): SyncHost {
  const state = new SyncStateImpl();
  const disposers: Array<() => void> = [];
  let remoteApplyDepth = 0;
  let localNotificationScheduled = false;

  const withRemoteApply = async <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
    remoteApplyDepth += 1;
    try {
      return await task();
    } finally {
      remoteApplyDepth -= 1;
    }
  };
  const notifyLocalChange = () => {
    if (remoteApplyDepth > 0 || localNotificationScheduled) {
      return;
    }

    localNotificationScheduled = true;
    globalThis.queueMicrotask(() => {
      localNotificationScheduled = false;
      if (remoteApplyDepth === 0) {
        service.notifyLocalChange();
      }
    });
  };

  const externalSources = options.assetSources ?? [];
  const adapters: WebDavSyncAdapter[] = [
    createFullNoRevisionAdapter<PlannerPersistedState>({
      id: "production-planning",
      remotePath: "assets/planner-state.json",
      readLocal: async () => await loadPlannerState(),
      writeLocal: async (value) => await withRemoteApply(async () => {
        await savePlannerState(value);
      }),
      normalizeRemote: normalizePlannerPersistedState,
      resolveConflict: () => "use-remote",
    }),
    createFullWithRevisionAdapter<BlueprintRecord>({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (blueprintId) => `assets/blueprints/${blueprintId}.json`,
      listLocal: async () => (await listBlueprintStorageEntries({ includeDeleted: true }))
        .flatMap((entry) => entry.kind === "blueprint"
          ? [{ id: entry.blueprintId, value: entry, deletedAt: entry.deletedAt }]
          : []),
      writeLocal: async (entry) => await withRemoteApply(async () => {
        await upsertBlueprintStorageEntry({
          ...entry.value,
          deletedAt: entry.deletedAt,
        });
      }),
    }),
    createFullWithRevisionAdapter<BlueprintFolderRecord>({
      id: "blueprint-folders",
      indexPath: "assets/blueprint-folders/index.json",
      entryPath: (folderId) => `assets/blueprint-folders/${folderId}.json`,
      listLocal: async () => (await listBlueprintStorageEntries({ includeDeleted: true }))
        .flatMap((entry) => entry.kind === "folder"
          ? [{ id: entry.folderId, value: entry, deletedAt: entry.deletedAt }]
          : []),
      writeLocal: async (entry) => await withRemoteApply(async () => {
        await upsertBlueprintStorageEntry({
          ...entry.value,
          deletedAt: entry.deletedAt,
        });
      }),
    }),
    ...externalSources.map((source) => createAdapterFromSource(
      source,
      withRemoteApply,
    )),
    createWorldDocumentAdapter(workspace, state, withRemoteApply),
  ];

  state.setSettings(readWebDavSyncSettings());
  const service: WebDavSyncService = createWebDavSyncService({
    readSettings: readWebDavSyncSettings,
    createClient: (settings) => createWebDavWorkerStorageClient({
      baseUrl: settings.url,
      username: settings.username,
      password: settings.password,
      readDebugEnabled: options.readDebugEnabled,
    }),
    adapters,
    beforeSync: async (client) => {
      await ensureWebDavDirectoryTree(client, externalSources);
      await registerCurrentDevice(client);
      state.setRemoteDevices(await listRemoteDevices(client));
    },
    afterSync: async (client) => {
      state.setRemoteDevices(await listRemoteDevices(client));
    },
    onStatusChange: state.setStatus,
  });

  const actions: SyncContract["actions"] = {
    updateSettings: (patch) => {
      writeWebDavSyncSettings({
        ...readWebDavSyncSettings(),
        ...patch,
      });
    },
    syncNow: async () => {
      await service.syncNow("manual");
    },
    resolveConflict: (resolution) => {
      if (resolution === "pause") {
        writeWebDavSyncSettings({
          ...readWebDavSyncSettings(),
          enabled: false,
        });
      }
      state.resolveConflict(resolution);
    },
  };
  const host: SyncHost = {
    state,
    actions,
    queries: {},
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      state.clearConflict();
      service.stop();
      if (workspace.sync === host) {
        workspace.sync = null;
      }
    },
  };

  workspace.sync = host;
  disposers.push(subscribeToStorageChanges((event) => {
    if (
      event.assetType === "world-document"
      || event.assetType === "production-planning"
      || event.assetType === "blueprint"
      || event.assetType === "blueprint-folder"
    ) {
      notifyLocalChange();
    }
  }));
  for (const source of externalSources) {
    disposers.push(source.subscribe(notifyLocalChange));
  }
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    disposers.push(editorDocument.subscribe(notifyLocalChange));
  }
  disposers.push(subscribeToWebDavSyncSettingsChanges((settings) => {
    state.setSettings(settings);
    void service.syncNow("settings-change");
  }));
  service.start();

  return host;
}

function createAdapterFromSource(
  source: SyncAssetSource,
  withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
): WebDavSyncAdapter {
  const sharedOptions = {
    id: source.id,
    indexPath: source.indexPath,
    listLocal: source.listLocal,
    writeLocal: async (entry: SyncAssetEntry) => await withRemoteApply(async () => {
      await source.writeLocal(entry);
    }),
    normalizeRemote: source.normalizeRemote,
  };

  if (source.mode === "patch-with-revision") {
    return createPatchCollectionWithRevisionAdapter({
      ...sharedOptions,
      directoryPath: source.remotePath,
    });
  }

  return createFullWithRevisionAdapter({
    ...sharedOptions,
    entryPath: source.remotePath,
  });
}

function createWorldDocumentAdapter(
  workspace: WorkspaceContract,
  state: SyncStateImpl,
  withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
): WebDavSyncAdapter {
  return createPatchCollectionWithRevisionAdapter<WorldDocument>({
    id: "world-documents",
    indexPath: "documents/index.json",
    directoryPath: (documentKey) => `documents/${encodeURIComponent(documentKey)}`,
    listLocal: async () => {
      const documentsByKey = new Map(
        (await listWorldDocuments()).map((document) => [document.documentKey, document]),
      );
      const currentDocument = workspace.editor?.document.getSnapshot();
      if (currentDocument !== undefined) {
        documentsByKey.set(currentDocument.documentKey, currentDocument);
      }

      return Array.from(documentsByKey.values()).map((document) => ({
        id: document.documentKey,
        value: document,
        deletedAt: null,
      }));
    },
    writeLocal: async (entry) => await withRemoteApply(async () => {
      await writeWorldDocument(entry.value);
      const editor = workspace.editor;
      if (
        editor !== null
        && editor.document.getSnapshot().documentKey === entry.value.documentKey
      ) {
        editor.actions.applySynchronizedDocument(entry.value);
      }
    }),
    normalizeRemote: normalizeWorldDocument,
    resolveConflict: (conflict) => state.requestConflict(
      conflict,
      resolveRemoteDeviceLabel(state.remoteDevices),
    ),
  });
}

async function ensureWebDavDirectoryTree(
  client: WebDavStorageClient,
  externalSources: readonly SyncAssetSource[],
): Promise<void> {
  const directoryPaths = new Set([
    "",
    "devices",
    "assets",
    "assets/blueprints",
    "assets/blueprint-folders",
    "documents",
  ]);

  for (const source of externalSources) {
    addPathAncestors(directoryPaths, source.indexPath);
  }
  for (const path of directoryPaths) {
    await client.makeDirectory(path);
  }
}

function addPathAncestors(paths: Set<string>, filePath: string): void {
  const segments = filePath.split("/").filter(Boolean);
  segments.pop();
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    paths.add(current);
  }
}

async function registerCurrentDevice(client: WebDavStorageClient): Promise<void> {
  const now = new Date().toISOString();
  const ownerState = await ensureLocalSyncOwnerState({ now });
  const path = `devices/${ownerState.deviceId}.json`;
  const existing = await readRemoteDeviceInfo(client, path);
  const nextDevice: SyncRemoteDeviceInfo = {
    deviceId: ownerState.deviceId,
    label: existing?.label ?? createDefaultDeviceLabel(now),
    firstSeen: existing?.firstSeen ?? now,
    lastActive: now,
  };

  await client.writeTextFile(path, JSON.stringify(nextDevice));
}

async function listRemoteDevices(
  client: WebDavStorageClient,
): Promise<SyncRemoteDeviceInfo[]> {
  const entries = await client.listDirectory("devices");
  const devices: SyncRemoteDeviceInfo[] = [];

  for (const entry of entries) {
    if (entry.type !== "file" || !entry.basename.endsWith(".json")) {
      continue;
    }

    const device = await readRemoteDeviceInfo(client, `devices/${entry.basename}`);
    if (device !== null) {
      devices.push(device);
    }
  }

  return devices;
}

async function readRemoteDeviceInfo(
  client: WebDavStorageClient,
  path: string,
): Promise<SyncRemoteDeviceInfo | null> {
  const file = await client.readTextFile(path);
  if (file === null) {
    return null;
  }

  try {
    return normalizeRemoteDeviceInfo(JSON.parse(file.content));
  } catch {
    return null;
  }
}

function normalizeRemoteDeviceInfo(value: unknown): SyncRemoteDeviceInfo | null {
  if (
    !isRecord(value)
    || typeof value.deviceId !== "string"
    || typeof value.label !== "string"
    || typeof value.firstSeen !== "string"
    || typeof value.lastActive !== "string"
  ) {
    return null;
  }

  return {
    deviceId: value.deviceId,
    label: value.label,
    firstSeen: value.firstSeen,
    lastActive: value.lastActive,
  };
}

function resolveRemoteDeviceLabel(
  devices: readonly SyncRemoteDeviceInfo[],
): string {
  return devices[0]?.label ?? "远端设备";
}

function createDefaultDeviceLabel(now: string): string {
  const navigatorValue = typeof navigator === "undefined" ? null : navigator;
  const browser = navigatorValue?.userAgent.includes("Firefox") ? "Firefox"
    : navigatorValue?.userAgent.includes("Edg/") ? "Edge"
      : navigatorValue?.userAgent.includes("Chrome") ? "Chrome"
        : "Browser";
  const platform = navigatorValue?.platform || "Unknown OS";

  return `${browser} on ${platform} (${now.slice(0, 10)})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
