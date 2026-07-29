import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingFolderReadWrite,
} from "@/app/state/state-impl";
import {
  listModuleBalancingCanvasEntries,
  listModuleBalancingCustomModuleEntries,
  listModuleBalancingFolderEntries,
  loadModuleBalancingState,
  normalizeModuleBalancingState,
  writeModuleBalancingCanvasEntry,
  writeModuleBalancingCustomModuleEntry,
  writeModuleBalancingFolderEntry,
} from "@/app/storage/module-balancing-storage";
import type { SyncAssetEntry, SyncAssetSource } from "@/domain/sync";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";

/**
 * 模块平衡业务对同步模块的唯一数据端口。
 *
 * 这里不引用 WebDAV 或同步实现；远端写入后产生的 UI 刷新也由本业务模块自行完成。
 */
export function createModuleBalancingSyncSources(
  appHost: AppHost,
): readonly SyncAssetSource[] {
  const subscribe = (listener: () => void) => subscribeToStorageChanges((event) => {
    if (event.assetType === "custom-module" || event.assetType === "module-canvas") {
      listener();
    }
  });
  const refreshState = async () => {
    const nextState = await loadModuleBalancingState();
    if (nextState === null) {
      return;
    }

    runInAction(() => {
      appHost.internalState.workbench.toolbox.moduleBalancing = nextState;
    });
  };

  return [
    {
      id: "custom-modules",
      mode: "full-with-revision",
      indexPath: "assets/custom-modules/index.json",
      remotePath: (moduleId) => `assets/custom-modules/${moduleId}.json`,
      listLocal: listModuleBalancingCustomModuleEntries,
      writeLocal: async (entry) => {
        await writeModuleBalancingCustomModuleEntry(
          entry as SyncAssetEntry<ModuleBalancingCustomModuleReadWrite>,
        );
        await refreshState();
      },
      subscribe,
    },
    {
      id: "custom-module-folders",
      mode: "full-with-revision",
      indexPath: "assets/custom-module-folders/index.json",
      remotePath: (folderId) => `assets/custom-module-folders/${folderId}.json`,
      listLocal: async () => await listModuleBalancingFolderEntries("folders"),
      writeLocal: async (entry) => {
        await writeModuleBalancingFolderEntry(
          "folders",
          entry as SyncAssetEntry<ModuleBalancingFolderReadWrite>,
        );
        await refreshState();
      },
      subscribe,
    },
    {
      id: "module-canvas-folders",
      mode: "full-with-revision",
      indexPath: "assets/module-canvas-folders/index.json",
      remotePath: (folderId) => `assets/module-canvas-folders/${folderId}.json`,
      listLocal: async () => await listModuleBalancingFolderEntries("canvasFolders"),
      writeLocal: async (entry) => {
        await writeModuleBalancingFolderEntry(
          "canvasFolders",
          entry as SyncAssetEntry<ModuleBalancingFolderReadWrite>,
        );
        await refreshState();
      },
      subscribe,
    },
    {
      id: "module-canvases",
      mode: "patch-with-revision",
      indexPath: "assets/module-canvases/index.json",
      remotePath: (canvasId) => `assets/module-canvases/${canvasId}`,
      listLocal: listModuleBalancingCanvasEntries,
      writeLocal: async (entry) => {
        await writeModuleBalancingCanvasEntry(
          entry as SyncAssetEntry<ModuleBalancingCanvasReadWrite>,
        );
        await refreshState();
      },
      normalizeRemote: (value) => normalizeModuleBalancingState({
        canvases: [value],
      }).canvases[0] ?? null,
      subscribe,
    },
  ];
}
