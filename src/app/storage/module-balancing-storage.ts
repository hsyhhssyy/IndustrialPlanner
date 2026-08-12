import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingFolderReadWrite,
  ModuleBalancingStateReadWrite,
} from "@/app/state/state-impl";
import { createDefaultModuleBalancingState } from "@/app/state/state-impl";
import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "@/shared/storage/migration";
import type { IndexedDbStorageLocation } from "@/shared/storage/browser-storage";
// AI-REMOVED 2026-08-08:
// Reason: 模块墓碑已从全局 localStorage 迁入按 provider/target 隔离的 IndexedDB store。
// Trigger: 用户要求同步数据不得混入业务存储或跨同步目标共享。
// Evidence: 新实现只通过 sync-tombstone-storage 读写墓碑。
// Replacement: 下方 sync-tombstone-storage import。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage/browser-storage";
import {
  emitStorageChange,
  type StorageWriteOptions,
} from "@/shared/storage/storage-change-event";
import {
  clearActiveSyncTombstone,
  listActiveSyncTombstones,
  writeActiveSyncTombstone,
} from "@/shared/storage/sync-tombstone-storage";

const MODULE_BALANCING_STORE_LOCATION: IndexedDbStorageLocation = {
  databaseName: "v3-industrial-planner",
  storeName: "module-balancing-state",
  key: "v1",
};

const CURRENT_VERSION = 1;
// AI-REMOVED 2026-08-08:
// Reason: 模块墓碑不应跨 Cloudflare/WebDAV 目标共享，也不应留在全局 localStorage。
// Trigger: 用户要求同步属性和缓存全部收归对应同步存储。
// Evidence: 原 key 没有 provider、后端地址、owner 或空间名称维度。
// Replacement: src/shared/storage/sync-tombstone-storage.ts。
// Risk: Low；实验性旧墓碑不迁移。
// Human Review: Required
//
// Original code:
// const MODULE_BALANCING_TOMBSTONE_LOCAL_STORAGE_KEY = "v3-module-balancing-tombstones";
const MIGRATIONS: StorageMigration<ModuleBalancingStateReadWrite>[] = [
  {
    version: 1,
    migrate: (raw) => normalizeModuleBalancingState(raw),
  },
];

export async function loadModuleBalancingState(): Promise<ModuleBalancingStateReadWrite | null> {
  const state = await readFromIndexedDbWithMigration(
    MODULE_BALANCING_STORE_LOCATION,
    CURRENT_VERSION,
    MIGRATIONS,
    undefined,
  );

  return state === null ? null : normalizeModuleBalancingState(state);
}

export async function saveModuleBalancingState(
  state: ModuleBalancingStateReadWrite,
  options: StorageWriteOptions = {},
): Promise<void> {
  const previousState = await loadModuleBalancingState();
  const normalizedState = normalizeModuleBalancingState(state);

  if (previousState !== null) {
    await recordDeletedModuleBalancingEntries(previousState, normalizedState);
  }

  await saveToIndexedDbWithVersion(
    MODULE_BALANCING_STORE_LOCATION,
    CURRENT_VERSION,
    normalizedState,
  );
  emitStorageChange({
    assetType: "module-canvas",
    assetId: "all",
    origin: options.origin ?? "local",
    timestamp: Date.now(),
  });
  emitStorageChange({
    assetType: "custom-module",
    assetId: "all",
    origin: options.origin ?? "local",
    timestamp: Date.now(),
  });
}

export async function listModuleBalancingCustomModuleEntries(): Promise<Array<{
  readonly id: string;
  readonly value: ModuleBalancingCustomModuleReadWrite;
  readonly deletedAt: string | null;
}>> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const tombstones = await readModuleBalancingTombstones();

  return [
    ...state.customModules.map((value) => ({ id: value.id, value, deletedAt: null })),
    ...Object.entries(tombstones.customModules)
      .filter(([id]) => !state.customModules.some((module) => module.id === id))
      .map(([id, tombstone]) => ({ id, value: tombstone.value, deletedAt: tombstone.deletedAt })),
  ];
}

export async function writeModuleBalancingCustomModuleEntry(entry: {
  readonly id: string;
  readonly value: ModuleBalancingCustomModuleReadWrite;
  readonly deletedAt: string | null;
}, options: StorageWriteOptions = {}): Promise<void> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const nextState = cloneModuleBalancingState(state);
  const nextModule = normalizeModuleBalancingState({ customModules: [entry.value], canvases: state.canvases }).customModules[0];
  if (nextModule === undefined) {
    return;
  }

  if (entry.deletedAt === null) {
    nextState.customModules = upsertById(nextState.customModules, nextModule, (module) => module.id);
    await clearModuleBalancingTombstone("customModules", entry.id);
  } else {
    nextState.customModules = nextState.customModules.filter((module) => module.id !== entry.id);
    await writeModuleBalancingTombstone("customModules", entry.id, nextModule, entry.deletedAt);
  }

  await saveModuleBalancingState(nextState, options);
}

export async function listModuleBalancingFolderEntries(kind: "folders" | "canvasFolders"): Promise<Array<{
  readonly id: string;
  readonly value: ModuleBalancingFolderReadWrite;
  readonly deletedAt: string | null;
}>> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const activeFolders = kind === "folders" ? state.folders : state.canvasFolders;
  const tombstones = (await readModuleBalancingTombstones())[kind];

  return [
    ...activeFolders.map((value) => ({ id: value.id, value, deletedAt: null })),
    ...Object.entries(tombstones)
      .filter(([id]) => !activeFolders.some((folder) => folder.id === id))
      .map(([id, tombstone]) => ({ id, value: tombstone.value, deletedAt: tombstone.deletedAt })),
  ];
}

export async function writeModuleBalancingFolderEntry(
  kind: "folders" | "canvasFolders",
  entry: {
    readonly id: string;
    readonly value: ModuleBalancingFolderReadWrite;
    readonly deletedAt: string | null;
  },
  options: StorageWriteOptions = {},
): Promise<void> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const nextState = cloneModuleBalancingState(state);
  const nextFolder = normalizeFolders([entry.value])[0];
  if (nextFolder === undefined) {
    return;
  }

  if (entry.deletedAt === null) {
    nextState[kind] = upsertById(nextState[kind], nextFolder, (folder) => folder.id);
    await clearModuleBalancingTombstone(kind, entry.id);
  } else {
    nextState[kind] = nextState[kind].filter((folder) => folder.id !== entry.id);
    await writeModuleBalancingTombstone(kind, entry.id, nextFolder, entry.deletedAt);
  }

  await saveModuleBalancingState(nextState, options);
}

export async function listModuleBalancingCanvasEntries(): Promise<Array<{
  readonly id: string;
  readonly value: ModuleBalancingCanvasReadWrite;
  readonly deletedAt: string | null;
}>> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const tombstones = await readModuleBalancingTombstones();

  return [
    ...state.canvases.map((value) => ({ id: value.id, value, deletedAt: null })),
    ...Object.entries(tombstones.canvases)
      .filter(([id]) => !state.canvases.some((canvas) => canvas.id === id))
      .map(([id, tombstone]) => ({ id, value: tombstone.value, deletedAt: tombstone.deletedAt })),
  ];
}

export async function writeModuleBalancingCanvasEntry(entry: {
  readonly id: string;
  readonly value: ModuleBalancingCanvasReadWrite;
  readonly deletedAt: string | null;
}, options: StorageWriteOptions = {}): Promise<void> {
  const state = await loadModuleBalancingState() ?? createDefaultModuleBalancingState();
  const nextState = cloneModuleBalancingState(state);
  const nextCanvas = normalizeModuleBalancingState({ ...state, canvases: [entry.value] }).canvases[0];
  if (nextCanvas === undefined) {
    return;
  }

  if (entry.deletedAt === null) {
    nextState.canvases = upsertById(nextState.canvases, nextCanvas, (canvas) => canvas.id);
    nextState.activeCanvasId = nextState.activeCanvasId ?? nextCanvas.id;
    await clearModuleBalancingTombstone("canvases", entry.id);
  } else {
    nextState.canvases = nextState.canvases.filter((canvas) => canvas.id !== entry.id);
    nextState.activeCanvasId = nextState.activeCanvasId === entry.id
      ? nextState.canvases[0]?.id ?? null
      : nextState.activeCanvasId;
    await writeModuleBalancingTombstone("canvases", entry.id, nextCanvas, entry.deletedAt);
  }

  await saveModuleBalancingState(nextState, options);
}

export function normalizeModuleBalancingState(value: unknown): ModuleBalancingStateReadWrite {
  const fallback = createDefaultModuleBalancingState();
  if (!isRecord(value)) {
    return cloneModuleBalancingState(fallback);
  }

  const folders = normalizeFolders(value.folders);
  const canvasFolders = normalizeFolders(value.canvasFolders);
  const customModules = normalizeCustomModules(value.customModules, new Set(folders.map((folder) => folder.id)));
  const canvases = normalizeCanvases(value.canvases, new Set(canvasFolders.map((folder) => folder.id)));
  const safeCanvases = canvases.length > 0 ? canvases : fallback.canvases;
  const activeCanvasId = typeof value.activeCanvasId === "string" && safeCanvases.some((canvas) => canvas.id === value.activeCanvasId)
    ? value.activeCanvasId
    : safeCanvases[0]?.id ?? null;

  return {
    canvases: safeCanvases,
    canvasFolders,
    customModules,
    folders,
    activeCanvasId,
  };
}

export function cloneModuleBalancingState(
  state: ModuleBalancingStateReadWrite,
): ModuleBalancingStateReadWrite {
  return {
    canvases: state.canvases.map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      folderId: canvas.folderId,
      globalInputs: canvas.globalInputs.map((input) => ({ ...input })),
      stages: canvas.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        entries: stage.entries.map((entry) => ({ ...entry })),
      })),
      warehouseCapacity: canvas.warehouseCapacity,
    })),
    canvasFolders: state.canvasFolders.map((folder) => ({ ...folder })),
    customModules: state.customModules.map((module) => ({
      id: module.id,
      name: module.name,
      color: module.color,
      iconId: module.iconId,
      notes: module.notes,
      folderId: module.folderId,
      inputs: module.inputs.map((input) => ({ ...input })),
      outputs: module.outputs.map((output) => ({ ...output })),
      sourceType: "custom",
    })),
    folders: state.folders.map((folder) => ({ ...folder })),
    activeCanvasId: state.activeCanvasId,
  };
}

function normalizeCanvases(value: unknown, folderIds: ReadonlySet<string>): ModuleBalancingStateReadWrite["canvases"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((canvas) => {
    if (!isRecord(canvas)) {
      return [];
    }

    const id = normalizeNonEmptyString(canvas.id);
    if (id === null || seen.has(id)) {
      return [];
    }
    seen.add(id);

    return [{
      id,
      name: normalizeNonEmptyString(canvas.name) ?? "未命名画布",
      folderId: typeof canvas.folderId === "string" && folderIds.has(canvas.folderId) ? canvas.folderId : null,
      globalInputs: normalizePorts(canvas.globalInputs, true),
      stages: normalizeStages(canvas.stages),
      warehouseCapacity: normalizePositiveNumberOrNull(canvas.warehouseCapacity),
    }];
  });
}

function normalizeStages(value: unknown): ModuleBalancingStateReadWrite["canvases"][number]["stages"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((stage) => {
    if (!isRecord(stage)) {
      return [];
    }

    const id = normalizeNonEmptyString(stage.id);
    if (id === null || seen.has(id)) {
      return [];
    }
    seen.add(id);

    return [{
      id,
      name: normalizeNonEmptyString(stage.name) ?? "Stage",
      entries: Array.isArray(stage.entries)
        ? stage.entries.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const moduleId = normalizeNonEmptyString(entry.moduleId);
          const quantity = normalizePositiveNumber(entry.quantity);

          return moduleId === null || quantity === null ? [] : [{ moduleId, quantity }];
        })
        : [],
    }];
  });
}

function normalizeCustomModules(
  value: unknown,
  folderIds: ReadonlySet<string>,
): ModuleBalancingStateReadWrite["customModules"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((module) => {
    if (!isRecord(module) || module.sourceType !== "custom") {
      return [];
    }

    const id = normalizeNonEmptyString(module.id);
    const name = normalizeNonEmptyString(module.name);
    const iconId = normalizeNonEmptyString(module.iconId);
    if (id === null || name === null || iconId === null || seen.has(id)) {
      return [];
    }
    seen.add(id);

    return [{
      id,
      name,
      color: typeof module.color === "string" ? module.color : "#4f8cff",
      iconId,
      notes: typeof module.notes === "string" ? module.notes : "",
      folderId: typeof module.folderId === "string" && folderIds.has(module.folderId) ? module.folderId : null,
      inputs: normalizePorts(module.inputs),
      outputs: normalizePorts(module.outputs),
      sourceType: "custom",
    }];
  });
}

function normalizeFolders(value: unknown): ModuleBalancingStateReadWrite["folders"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((folder) => {
    if (!isRecord(folder)) {
      return [];
    }

    const id = normalizeNonEmptyString(folder.id);
    const name = normalizeNonEmptyString(folder.name);
    if (id === null || name === null || seen.has(id)) {
      return [];
    }
    seen.add(id);

    return [{ id, name }];
  });
}

function normalizePorts(value: unknown, allowInfinite = false): ModuleBalancingStateReadWrite["customModules"][number]["inputs"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((port) => {
    if (!isRecord(port)) {
      return [];
    }

    const itemId = normalizeNonEmptyString(port.itemId);
    const infinite = allowInfinite && port.infinite === true;
    const perMinute = infinite ? normalizeNonNegativeNumber(port.perMinute) : normalizePositiveNumber(port.perMinute);

    return itemId === null || perMinute === null
      ? []
      : [{ itemId, perMinute, ...(infinite ? { infinite } : {}) }];
  });
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizePositiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

interface ModuleBalancingTombstoneState {
  readonly customModules: Record<string, { readonly value: ModuleBalancingCustomModuleReadWrite; readonly deletedAt: string }>;
  readonly canvases: Record<string, { readonly value: ModuleBalancingCanvasReadWrite; readonly deletedAt: string }>;
  readonly folders: Record<string, { readonly value: ModuleBalancingFolderReadWrite; readonly deletedAt: string }>;
  readonly canvasFolders: Record<string, { readonly value: ModuleBalancingFolderReadWrite; readonly deletedAt: string }>;
}

async function recordDeletedModuleBalancingEntries(
  previousState: ModuleBalancingStateReadWrite,
  nextState: ModuleBalancingStateReadWrite,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const writes: Promise<void>[] = [];
  for (const module of previousState.customModules) {
    if (!nextState.customModules.some((candidate) => candidate.id === module.id)) {
      writes.push(writeModuleBalancingTombstone("customModules", module.id, module, timestamp));
    }
  }
  for (const canvas of previousState.canvases) {
    if (!nextState.canvases.some((candidate) => candidate.id === canvas.id)) {
      writes.push(writeModuleBalancingTombstone("canvases", canvas.id, canvas, timestamp));
    }
  }
  for (const folder of previousState.folders) {
    if (!nextState.folders.some((candidate) => candidate.id === folder.id)) {
      writes.push(writeModuleBalancingTombstone("folders", folder.id, folder, timestamp));
    }
  }
  for (const folder of previousState.canvasFolders) {
    if (!nextState.canvasFolders.some((candidate) => candidate.id === folder.id)) {
      writes.push(writeModuleBalancingTombstone("canvasFolders", folder.id, folder, timestamp));
    }
  }
  await Promise.all(writes);
}

async function readModuleBalancingTombstones(): Promise<ModuleBalancingTombstoneState> {
  const emptyState = createEmptyTombstoneState();
  const [customModules, canvases, folders, canvasFolders] = await Promise.all([
    listActiveSyncTombstones<ModuleBalancingCustomModuleReadWrite>("custom-modules"),
    listActiveSyncTombstones<ModuleBalancingCanvasReadWrite>("module-canvases"),
    listActiveSyncTombstones<ModuleBalancingFolderReadWrite>("custom-module-folders"),
    listActiveSyncTombstones<ModuleBalancingFolderReadWrite>("module-canvas-folders"),
  ]);

  return {
    ...emptyState,
    customModules: normalizeTombstoneList(customModules, (value) => normalizeModuleBalancingState({ customModules: [value] }).customModules[0]),
    canvases: normalizeTombstoneList(canvases, (value) => normalizeModuleBalancingState({ canvases: [value] }).canvases[0]),
    folders: normalizeTombstoneList(folders, (value) => normalizeFolders([value])[0]),
    canvasFolders: normalizeTombstoneList(canvasFolders, (value) => normalizeFolders([value])[0]),
  };
}

function createEmptyTombstoneState(): ModuleBalancingTombstoneState {
  return {
    customModules: {},
    canvases: {},
    folders: {},
    canvasFolders: {},
  };
}

function normalizeTombstoneList<TValue>(
  tombstones: readonly {
    readonly assetId: string;
    readonly value: TValue;
    readonly deletedAt: string;
  }[],
  normalizeValue: (value: unknown) => TValue | undefined,
): Record<string, { readonly value: TValue; readonly deletedAt: string }> {
  return Object.fromEntries(tombstones.flatMap((tombstone) => {
    const normalizedValue = normalizeValue(tombstone.value);
    return normalizedValue === undefined
      ? []
      : [[tombstone.assetId, {
          value: normalizedValue,
          deletedAt: tombstone.deletedAt,
        }]];
  }));
}

// AI-REMOVED 2026-08-08:
// Reason: 新墓碑 store 已返回结构化列表，不再读取全局 localStorage 的嵌套 record。
// Trigger: 模块删除状态需要按 provider 和远端目标隔离。
// Evidence: readModuleBalancingTombstones 现在调用 listActiveSyncTombstones。
// Replacement: 上方 normalizeTombstoneList。
// Risk: Low；旧实验性 localStorage 墓碑不迁移。
// Human Review: Required
//
// Original code:
// function normalizeTombstoneRecord<TValue>(
//   value: unknown,
//   normalizeValue: (value: unknown) => TValue | undefined,
// ): Record<string, { readonly value: TValue; readonly deletedAt: string }> {
//   if (!isRecord(value)) {
//     return {};
//   }
//
//   return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
//     if (!isRecord(entry) || typeof entry.deletedAt !== "string") {
//       return [];
//     }
//
//     const normalizedValue = normalizeValue(entry.value);
//     return normalizedValue === undefined ? [] : [[id, { value: normalizedValue, deletedAt: entry.deletedAt }]];
//   }));
// }

async function writeModuleBalancingTombstone<TKey extends keyof ModuleBalancingTombstoneState>(
  key: TKey,
  id: string,
  value: ModuleBalancingTombstoneState[TKey][string]["value"],
  deletedAt: string,
): Promise<void> {
  await writeActiveSyncTombstone({
    adapterId: resolveModuleBalancingAdapterId(key),
    assetId: id,
    value,
    deletedAt,
  });
}

async function clearModuleBalancingTombstone(
  key: keyof ModuleBalancingTombstoneState,
  id: string,
): Promise<void> {
  await clearActiveSyncTombstone(resolveModuleBalancingAdapterId(key), id);
}

function resolveModuleBalancingAdapterId(
  key: keyof ModuleBalancingTombstoneState,
): string {
  if (key === "customModules") return "custom-modules";
  if (key === "canvases") return "module-canvases";
  if (key === "folders") return "custom-module-folders";
  return "module-canvas-folders";
}

function upsertById<TValue>(
  values: readonly TValue[],
  value: TValue,
  getId: (value: TValue) => string,
): TValue[] {
  const id = getId(value);
  const index = values.findIndex((candidate) => getId(candidate) === id);
  if (index < 0) {
    return [...values, value];
  }

  return values.map((candidate, candidateIndex) => candidateIndex === index ? value : candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
