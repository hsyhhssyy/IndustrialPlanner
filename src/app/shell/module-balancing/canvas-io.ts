import type {
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingFolder,
  ModuleBalancingIOPort,
  ModuleBalancingStage,
  ModuleBalancingStageModuleEntry,
} from "@/app/toolbox-types";
import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingFolderReadWrite,
} from "@/app/state/state-impl";
import {
  createModuleBalancingId,
} from "@/app/shell/module-balancing/module-balancing-model";
import {
  migrateModuleBalancingCustomModuleIconItemIds,
  MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION,
} from "@/app/module-balancing-schema";

// ── 导出数据结构 ──

const CANVAS_EXPORT_VERSION = 2;
const LEGACY_CANVAS_EXPORT_VERSION = 1;

export interface CanvasExportData {
  readonly version: typeof CANVAS_EXPORT_VERSION;
  readonly canvas: {
    readonly name: string;
    readonly folderId: string | null;
    readonly globalInputs: readonly ModuleBalancingIOPort[];
    readonly stages: readonly ModuleBalancingStage[];
    readonly warehouseCapacity: number | null;
  };
  /** 仅包含画布引用的自定义模块（排除 system-recipe 与 recommended）。 */
  readonly modules: readonly ModuleBalancingCustomModule[];
}

// ── 导入匹配结果 ──

export type ImportModuleAction =
  | { readonly kind: "create"; readonly module: ModuleBalancingCustomModule }
  | { readonly kind: "reuse"; readonly importId: string; readonly localId: string }
  | {
    readonly kind: "conflict";
    readonly importId: string;
    readonly importName: string;
    readonly localName: string;
    readonly importModule: ModuleBalancingCustomModule;
  };

export interface CanvasImportPlan {
  readonly canvasData: {
    readonly name: string;
    readonly folderId: string | null;
    readonly globalInputs: readonly ModuleBalancingIOPort[];
    readonly stages: readonly {
      readonly name: string;
      readonly entries: readonly { readonly moduleId: string; readonly quantity: number }[];
    }[];
    readonly warehouseCapacity: number | null;
  };
  readonly moduleActions: readonly ImportModuleAction[];
  /** 导入 ID → 本地 ID 的映射（用于 create 和 reuse 场景）。 */
  readonly moduleIdMapping: ReadonlyMap<string, string>;
}

// ── 自定义模块集合导入导出 ──

const MODULE_COLLECTION_EXPORT_VERSION = 2;
const LEGACY_MODULE_COLLECTION_EXPORT_VERSION = 1;
const MODULE_COLLECTION_EXPORT_KIND = "module-collection";

/**
 * 单模块、文件夹和整个自定义模块库共用这一集合格式。
 * 单模块集合的 modules 长度为 1，且 folders 为空。
 */
export interface ModuleCollectionExportData {
  readonly kind: typeof MODULE_COLLECTION_EXPORT_KIND;
  readonly version: typeof MODULE_COLLECTION_EXPORT_VERSION;
  readonly name: string;
  readonly folders: readonly ModuleBalancingFolder[];
  readonly modules: readonly ModuleBalancingCustomModule[];
}

export interface ModuleCollectionImportPlan {
  readonly data: ModuleCollectionExportData;
  readonly moduleActions: readonly ImportModuleAction[];
  readonly moduleIdMapping: ReadonlyMap<string, string>;
}

// ── IOPort 比较辅助 ──

function arePortArraysEqual(
  a: readonly ModuleBalancingIOPort[],
  b: readonly ModuleBalancingIOPort[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((port, index) => {
    const other = b[index];
    if (other === undefined) {
      return false;
    }

    return port.itemId === other.itemId
      && port.perMinute === other.perMinute
      && (port.infinite === true) === (other.infinite === true);
  });
}

// ── 收集画布引用的自定义模块 ID ──

function collectCanvasModuleIds(
  canvas: ModuleBalancingCanvas,
): Set<string> {
  const ids = new Set<string>();
  for (const stage of canvas.stages) {
    for (const entry of stage.entries) {
      ids.add(entry.moduleId);
    }
  }

  return ids;
}

// ── 导出 ──

export function buildCanvasExportData(
  canvas: ModuleBalancingCanvas,
  customModules: readonly ModuleBalancingCustomModule[],
): CanvasExportData {
  const usedModuleIds = collectCanvasModuleIds(canvas);
  const usedModules = customModules.filter((module) => usedModuleIds.has(module.id));

  return {
    version: CANVAS_EXPORT_VERSION,
    canvas: {
      name: canvas.name,
      folderId: canvas.folderId ?? null,
      globalInputs: canvas.globalInputs,
      stages: canvas.stages,
      warehouseCapacity: canvas.warehouseCapacity,
    },
    modules: usedModules,
  };
}

export function downloadCanvasExportJson(data: CanvasExportData, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.canvas.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildModuleCollectionExportData(options: {
  readonly name: string;
  readonly folders: readonly ModuleBalancingFolder[];
  readonly modules: readonly ModuleBalancingCustomModule[];
}): ModuleCollectionExportData {
  const folderIds = new Set(options.folders.map((folder) => folder.id));
  return {
    kind: MODULE_COLLECTION_EXPORT_KIND,
    version: MODULE_COLLECTION_EXPORT_VERSION,
    name: options.name,
    folders: options.folders.map((folder) => ({ ...folder })),
    modules: options.modules.map((module) => ({
      ...module,
      iconItemIds: [...module.iconItemIds],
      folderId: typeof module.folderId === "string" && folderIds.has(module.folderId)
        ? module.folderId
        : null,
      inputs: module.inputs.map((port) => ({ ...port })),
      outputs: module.outputs.map((port) => ({ ...port })),
    })),
  };
}

export function downloadModuleCollectionExportJson(
  data: ModuleCollectionExportData,
  filename: string,
): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.modules.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── 导入解析 ──

export function parseCanvasImportData(raw: unknown): CanvasExportData | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (raw.version !== CANVAS_EXPORT_VERSION && raw.version !== LEGACY_CANVAS_EXPORT_VERSION) {
    return null;
  }

  if (!isRecord(raw.canvas)) {
    return null;
  }

  if (typeof raw.canvas.name !== "string" || raw.canvas.name.trim().length === 0) {
    return null;
  }

  if (!Array.isArray(raw.canvas.globalInputs)) {
    return null;
  }

  if (!Array.isArray(raw.canvas.stages)) {
    return null;
  }

  if (!Array.isArray(raw.modules)) {
    return null;
  }

  const name = raw.canvas.name.trim();
  const folderId = typeof raw.canvas.folderId === "string" ? raw.canvas.folderId : null;
  const warehouseCapacity = typeof raw.canvas.warehouseCapacity === "number"
    && Number.isFinite(raw.canvas.warehouseCapacity)
    && raw.canvas.warehouseCapacity > 0
    ? raw.canvas.warehouseCapacity
    : null;

  const globalInputs = (raw.canvas.globalInputs as unknown[])
    .map(validateIOPort)
    .filter((p): p is ModuleBalancingIOPort => p !== null);
  const stages = (raw.canvas.stages as unknown[])
    .map(validateStage)
    .filter((s): s is ModuleBalancingStage => s !== null);
  const modules = (raw.modules as unknown[])
    .map(validateCustomModule)
    .filter((m): m is ModuleBalancingCustomModule => m !== null);

  if (stages.length === 0) {
    return null;
  }

  return {
    version: CANVAS_EXPORT_VERSION,
    canvas: {
      name,
      folderId,
      globalInputs,
      stages,
      warehouseCapacity,
    },
    modules,
  };
}

export function parseModuleCollectionImportData(raw: unknown): ModuleCollectionExportData | null {
  if (!isRecord(raw)
    || raw.kind !== MODULE_COLLECTION_EXPORT_KIND
    || (raw.version !== MODULE_COLLECTION_EXPORT_VERSION
      && raw.version !== LEGACY_MODULE_COLLECTION_EXPORT_VERSION)
    || typeof raw.name !== "string"
    || raw.name.trim().length === 0
    || !Array.isArray(raw.folders)
    || !Array.isArray(raw.modules)) {
    return null;
  }

  const folders: ModuleBalancingFolder[] = [];
  const folderIds = new Set<string>();
  for (const folderRaw of raw.folders as unknown[]) {
    const folder = validateModuleCollectionFolder(folderRaw);
    if (folder === null || folderIds.has(folder.id)) {
      return null;
    }
    folderIds.add(folder.id);
    folders.push(folder);
  }

  const modules: ModuleBalancingCustomModule[] = [];
  const moduleIds = new Set<string>();
  for (const moduleRaw of raw.modules as unknown[]) {
    const module = validateCustomModule(moduleRaw);
    if (module === null) {
      continue;
    }
    if (moduleIds.has(module.id)) {
      return null;
    }

    const importedFolderId = isRecord(moduleRaw) && typeof moduleRaw.folderId === "string"
      ? moduleRaw.folderId.trim()
      : null;
    moduleIds.add(module.id);
    modules.push({
      ...module,
      folderId: importedFolderId !== null && folderIds.has(importedFolderId)
        ? importedFolderId
        : null,
    });
  }

  if (folders.length === 0 && modules.length === 0) {
    return null;
  }

  return {
    kind: MODULE_COLLECTION_EXPORT_KIND,
    version: MODULE_COLLECTION_EXPORT_VERSION,
    name: raw.name.trim(),
    folders,
    modules,
  };
}

/** 构建导入计划，比对导入模块与本地已有关联模块。 */
export function buildCanvasImportPlan(
  data: CanvasExportData,
  existingCustomModules: readonly ModuleBalancingCustomModule[],
): CanvasImportPlan {
  const existingById = new Map(existingCustomModules.map((module) => [module.id, module]));
  const moduleIdByInputsOutputs = new Map<string, ModuleBalancingCustomModule>();

  // 构建「输入输出指纹 → 模块」索引，用于 GUID 碰撞时比对
  for (const module of existingCustomModules) {
    const fingerprint = buildModuleIOPortFingerprint(module);
    moduleIdByInputsOutputs.set(fingerprint, module);
  }

  const createMap = new Map<string, string>();
  const reuseMap = new Map<string, string>();
  const conflicts: ImportModuleAction[] = [];

  for (const importModule of data.modules) {
    const existingModule = existingById.get(importModule.id);
    if (existingModule === undefined) {
      // GUID 不存在 → 创建
      createMap.set(importModule.id, importModule.id);
    } else {
      // GUID 存在 → 比对输入输出
      if (arePortArraysEqual(existingModule.inputs, importModule.inputs)
        && arePortArraysEqual(existingModule.outputs, importModule.outputs)) {
        // 输入输出完全一致 → 复用
        reuseMap.set(importModule.id, existingModule.id);
      } else {
        // 冲突
        conflicts.push({
          kind: "conflict",
          importId: importModule.id,
          importName: importModule.name,
          localName: existingModule.name,
          importModule,
        });
      }
    }
  }

  const moduleActions: ImportModuleAction[] = [
    ...[...createMap.entries()].map(([id, _module]) => {
      const importModule = data.modules.find((m) => m.id === id)!;
      return { kind: "create" as const, module: importModule };
    }),
    ...[...reuseMap.entries()].map(([importId, localId]) => ({
      kind: "reuse" as const,
      importId,
      localId,
    })),
    ...conflicts,
  ];

  const moduleIdMapping = new Map<string, string>([
    ...[...createMap.entries()],
    ...[...reuseMap.entries()],
  ]);

  return {
    canvasData: {
      name: data.canvas.name,
      folderId: data.canvas.folderId,
      globalInputs: data.canvas.globalInputs,
      stages: data.canvas.stages.map((stage) => ({
        name: stage.name,
        entries: stage.entries.map((entry) => ({
          moduleId: entry.moduleId,
          quantity: entry.quantity,
        })),
      })),
      warehouseCapacity: data.canvas.warehouseCapacity,
    },
    moduleActions,
    moduleIdMapping,
  };
}

/** 复用画布导入的模块匹配逻辑，确保两种入口具有完全一致的冲突语义。 */
export function buildModuleCollectionImportPlan(
  data: ModuleCollectionExportData,
  existingCustomModules: readonly ModuleBalancingCustomModule[],
): ModuleCollectionImportPlan {
  const canvasPlan = buildCanvasImportPlan({
    version: CANVAS_EXPORT_VERSION,
    canvas: {
      name: data.name,
      folderId: null,
      globalInputs: [],
      stages: [],
      warehouseCapacity: null,
    },
    modules: data.modules,
  }, existingCustomModules);

  return {
    data,
    moduleActions: canvasPlan.moduleActions,
    moduleIdMapping: canvasPlan.moduleIdMapping,
  };
}

/** 在导入确认后，将导入数据写入 state。 */
export function applyCanvasImport(
  importData: CanvasExportData,
  moduleIdMapping: Map<string, string>,
  customModules: ModuleBalancingCustomModuleReadWrite[],
  canvases: ModuleBalancingCanvasReadWrite[],
): string {
  // 导入新模块（create 类型）
  for (const importModule of importData.modules) {
    const mappedId = moduleIdMapping.get(importModule.id);
    if (mappedId === undefined) {
      continue;
    }

    // 如果 mappedId 和 importId 相同 → 需要创建；否则是 reuse
    if (mappedId === importModule.id) {
      customModules.push({
        ...importModule,
        id: mappedId,
        iconItemIds: [...importModule.iconItemIds],
        folderId: importModule.folderId ?? null,
        inputs: importModule.inputs.map((p) => ({ ...p })),
        outputs: importModule.outputs.map((p) => ({ ...p })),
      });
    }
  }

  // 创建新画布
  const newCanvasId = createModuleBalancingId();
  const newCanvas: ModuleBalancingCanvasReadWrite = {
    id: newCanvasId,
    name: importData.canvas.name,
    folderId: null,
    globalInputs: importData.canvas.globalInputs.map((p) => ({ ...p })),
    stages: importData.canvas.stages.map((stage) => ({
      id: createModuleBalancingId(),
      name: stage.name,
      entries: stage.entries.map((entry) => ({
        moduleId: moduleIdMapping.get(entry.moduleId) ?? entry.moduleId,
        quantity: entry.quantity,
      })),
    })),
    warehouseCapacity: importData.canvas.warehouseCapacity,
  };

  canvases.push(newCanvas);
  return newCanvasId;
}

/**
 * 应用模块集合：导入文件夹始终生成新的本地 ID；复用模块保持原状；
 * 冲突模块覆盖内容但保留其本地文件夹归属。
 */
export function applyModuleCollectionImport(
  plan: ModuleCollectionImportPlan,
  customModules: ModuleBalancingCustomModuleReadWrite[],
  folders: ModuleBalancingFolderReadWrite[],
): void {
  const importedFolderIdMapping = new Map<string, string>();
  for (const importedFolder of plan.data.folders) {
    const localFolderId = createModuleBalancingId();
    importedFolderIdMapping.set(importedFolder.id, localFolderId);
    folders.push({
      id: localFolderId,
      name: importedFolder.name,
    });
  }

  for (const action of plan.moduleActions) {
    if (action.kind === "reuse") {
      continue;
    }

    if (action.kind === "create") {
      const importedFolderId = action.module.folderId ?? null;
      customModules.push({
        ...action.module,
        iconItemIds: [...action.module.iconItemIds],
        folderId: importedFolderId === null
          ? null
          : importedFolderIdMapping.get(importedFolderId) ?? null,
        inputs: action.module.inputs.map((port) => ({ ...port })),
        outputs: action.module.outputs.map((port) => ({ ...port })),
      });
      continue;
    }

    const localModuleIndex = customModules.findIndex((module) => module.id === action.importId);
    const localModule = customModules[localModuleIndex];
    if (localModuleIndex < 0 || localModule === undefined) {
      continue;
    }
    customModules[localModuleIndex] = {
      ...action.importModule,
      iconItemIds: [...action.importModule.iconItemIds],
      folderId: localModule.folderId ?? null,
      inputs: action.importModule.inputs.map((port) => ({ ...port })),
      outputs: action.importModule.outputs.map((port) => ({ ...port })),
    };
  }
}

// ── 校验辅助 ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateModuleCollectionFolder(raw: unknown): ModuleBalancingFolder | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (id.length === 0 || name.length === 0) {
    return null;
  }

  return { id, name };
}

function validateIOPort(raw: unknown): ModuleBalancingIOPort | null {
  if (!isRecord(raw)) {
    return null;
  }

  const itemId = typeof raw.itemId === "string" ? raw.itemId.trim() : "";
  const perMinute = typeof raw.perMinute === "number" && Number.isFinite(raw.perMinute) && raw.perMinute > 0
    ? raw.perMinute
    : null;
  if (itemId.length === 0 || perMinute === null) {
    return null;
  }

  return {
    itemId,
    perMinute: Math.round(perMinute * 100) / 100,
    ...(raw.infinite === true ? { infinite: true } : {}),
  };
}

function validateStage(raw: unknown): ModuleBalancingStage | null {
  if (!isRecord(raw)) {
    return null;
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "Stage";
  if (!Array.isArray(raw.entries)) {
    return null;
  }

  const entries: ModuleBalancingStageModuleEntry[] = [];
  for (const entry of raw.entries as unknown[]) {
    if (!isRecord(entry)) {
      continue;
    }

    const moduleId = typeof entry.moduleId === "string" ? entry.moduleId.trim() : "";
    const quantity = typeof entry.quantity === "number"
      && Number.isFinite(entry.quantity)
      && entry.quantity > 0
      ? Math.round(entry.quantity * 100) / 100
      : null;
    if (moduleId.length === 0 || quantity === null) {
      continue;
    }

    entries.push({ moduleId, quantity });
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    id: createModuleBalancingId(),
    name,
    entries,
  };
}

function validateCustomModule(raw: unknown): ModuleBalancingCustomModule | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (raw.sourceType !== "custom") {
    return null;
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (id.length === 0 || name.length === 0) {
    return null;
  }

  if (!Array.isArray(raw.inputs) || !Array.isArray(raw.outputs)) {
    return null;
  }

  const inputs = (raw.inputs as unknown[])
    .map(validateIOPort)
    .filter((p): p is ModuleBalancingIOPort => p !== null);
  const outputs = (raw.outputs as unknown[])
    .map(validateIOPort)
    .filter((p): p is ModuleBalancingIOPort => p !== null);
  if (inputs.length === 0 && outputs.length === 0) {
    return null;
  }
  const iconItemIds = migrateModuleBalancingCustomModuleIconItemIds({
    schemaVersion: raw.schemaVersion,
    iconItemIds: raw.iconItemIds,
    legacyIconId: raw.iconId,
    inputItemIds: inputs.map((port) => port.itemId),
    outputItemIds: outputs.map((port) => port.itemId),
  });
  if (iconItemIds === null) {
    return null;
  }

  return {
    schemaVersion: MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION,
    id,
    name,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : "#4f8cff",
    iconItemIds,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    folderId: null, // 导入时重置文件夹归组
    inputs,
    outputs,
    sourceType: "custom",
  };
}

function buildModuleIOPortFingerprint(module: ModuleBalancingCustomModule): string {
  const sortedInputs = [...module.inputs]
    .map((p) => `${p.itemId}:${p.perMinute}${p.infinite === true ? ":inf" : ""}`)
    .sort()
    .join("|");
  const sortedOutputs = [...module.outputs]
    .map((p) => `${p.itemId}:${p.perMinute}${p.infinite === true ? ":inf" : ""}`)
    .sort()
    .join("|");
  return `${sortedInputs}||${sortedOutputs}`;
}
