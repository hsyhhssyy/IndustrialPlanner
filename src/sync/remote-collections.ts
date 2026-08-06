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
  return adapterId === "production-planning"
    ? PLANNER_STATE_ASSET_ID_CODEC
    : IDENTITY_ASSET_ID_CODEC;
}