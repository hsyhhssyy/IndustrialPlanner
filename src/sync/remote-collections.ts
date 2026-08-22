import type {
  SyncAssetType,
  SyncHashAlgorithm,
  SyncRemoteAdapterMode,
  SyncRemoteAssetIdCodec,
  SyncRemoteCollection,
  SyncRemoteWebDavBinding,
} from "./clients";

const IDENTITY_ASSET_ID_CODEC: SyncRemoteAssetIdCodec = {
  toRemoteAssetId: (adapterAssetId) => adapterAssetId,
  toAdapterAssetId: (remoteAssetId) => remoteAssetId,
};

const PLANNER_STATE_ASSET_ID_CODEC: SyncRemoteAssetIdCodec = {
  toRemoteAssetId: (adapterAssetId) => adapterAssetId === "single" ? "default" : adapterAssetId,
  toAdapterAssetId: (remoteAssetId) => remoteAssetId === "default" ? "single" : remoteAssetId,
  acceptsRemoteAssetId: (remoteAssetId) => remoteAssetId === "default",
};

const REGIONAL_SETTINGS_ASSET_ID_CODEC: SyncRemoteAssetIdCodec = {
  toRemoteAssetId: (adapterAssetId) =>
    adapterAssetId === "default" ? "regional-settings" : adapterAssetId,
  toAdapterAssetId: (remoteAssetId) =>
    remoteAssetId === "regional-settings" ? "default" : remoteAssetId,
  acceptsRemoteAssetId: (remoteAssetId) => remoteAssetId === "regional-settings",
};

export function createSyncRemoteCollection(options: {
  readonly adapterId: string;
  readonly name?: string;
  readonly mode: SyncRemoteAdapterMode;
  readonly assetType?: SyncAssetType;
  readonly assetIdCodec?: SyncRemoteAssetIdCodec;
  readonly hashAlgorithm?: SyncHashAlgorithm;
  readonly stateKey: string;
  readonly webDav?: SyncRemoteWebDavBinding;
}): SyncRemoteCollection {
  return {
    adapterId: options.adapterId,
    name: options.name ?? resolveDefaultCollectionName(options.adapterId),
    mode: options.mode,
    assetType: options.assetType ?? resolveDefaultAssetType(options.adapterId),
    assetIdCodec: options.assetIdCodec ?? resolveDefaultAssetIdCodec(options.adapterId),
    hashAlgorithm: options.hashAlgorithm ?? "fnv1a32",
    stateKey: options.stateKey,
    ...(options.webDav === undefined ? {} : { webDav: options.webDav }),
  };
}

export function createSyncAssetKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
}

function resolveDefaultCollectionName(adapterId: string): string {
  switch (adapterId) {
    case "blueprint-folders":
      return "blueprints";
    case "custom-modules":
    case "custom-module-folders":
    case "module-canvas-folders":
    case "module-canvases":
      return "modules";
    case "production-planning":
      return "toolbox";
    default:
      return adapterId;
  }
}

function resolveDefaultAssetType(adapterId: string): SyncAssetType {
  switch (adapterId) {
    case "world-documents":
      return "world-document";
    case "blueprints":
      return "blueprint";
    case "blueprint-folders":
      return "blueprint-folder";
    case "custom-modules":
      return "custom-module";
    case "custom-module-folders":
      return "custom-module-folder";
    case "module-canvas-folders":
      return "module-canvas-folder";
    case "module-canvases":
      return "module-canvas";
    default:
      return "planner-state";
  }
}

function resolveDefaultAssetIdCodec(adapterId: string): SyncRemoteAssetIdCodec {
  // AI-REMOVED 2026-08-22:
  // Reason: 仅为 production-planning 分配 codec 会让 regional-settings/default 继续使用
  //   identity 映射，与 production-planning/single 同时落到 planner-state/default。
  // Trigger: 真实 default 空间启动同步时，区域设置 adapter 读取生产计划 JSON 并 schema 失败。
  // Evidence: 远端 planner-state/default 内容哈希正确，字段为 targets/supplies/recipeChoices；
  //   两个 adapter 的默认 assetType 都是 planner-state。
  // Replacement: 下方分别为生产计划和区域设置分配互斥远端 ID 的 codec。
  // Risk: Low；保留生产计划历史键，区域设置使用此前不存在的独立键。
  // Human Review: Required
  //
  // Original code:
  // return adapterId === "production-planning"
  //   ? PLANNER_STATE_ASSET_ID_CODEC
  //   : IDENTITY_ASSET_ID_CODEC;
  if (adapterId === "production-planning") {
    return PLANNER_STATE_ASSET_ID_CODEC;
  }
  if (adapterId === "regional-settings") {
    return REGIONAL_SETTINGS_ASSET_ID_CODEC;
  }
  return IDENTITY_ASSET_ID_CODEC;
}
