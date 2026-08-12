export type StorageAssetType =
  | "world-document"
  | "blueprint"
  | "blueprint-folder"
  | "custom-module"
  | "module-canvas"
  | "production-planning";

export type StorageChangeOrigin = "local" | "remote-sync";

export interface StorageWriteOptions {
  readonly origin?: StorageChangeOrigin;
}

export interface StorageChangeEvent {
  readonly assetType: StorageAssetType;
  readonly assetId: string;
  readonly origin: StorageChangeOrigin;
  readonly timestamp: number;
}

export type StorageChangeListener = (event: StorageChangeEvent) => void;

const listeners = new Set<StorageChangeListener>();

export function subscribeToStorageChanges(listener: StorageChangeListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function emitStorageChange(event: StorageChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // 单个监听器失败不应阻断其他存储变更消费者。
    }
  }
}
