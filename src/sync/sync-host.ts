import type {
  SyncAssetEntry,
  SyncAssetSource,
  SyncConflictResolution,
  SyncContract,
  SyncInitialSyncStage,
  SyncTaskKind,
} from "@/domain/sync";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { createUuid } from "@/domain/shared/uuid";
// AI-REMOVED 2026-07-29:
// Reason: 客户端不再注册或枚举远端设备。
// Trigger: 用户确认不需要设备列表，冲突只展示远端上传时间。
// Evidence: revision 归因不能由全局设备心跳推断。
// Replacement: webdav-sync-adapters.ts committedAt。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { ensureLocalSyncOwnerState } from "@/shared/storage/sync-owner-storage";
// AI-CORRECTION 2026-08-08: Cloudflare 空间需要稳定且隔离的 owner scope；设备枚举仍保持移除。
// AI-CORRECTION 2026-08-08: 上述 owner scope 判断已撤销；空间名称本身就是共享远端 ID，
// 不得拼接安装 ID、账户 ID 或浏览器随机 ID，否则不同浏览器无法加入同一空间。
// AI-REMOVED 2026-08-08:
// Reason: Cloudflare 共享空间不能绑定本地 owner。
// Trigger: 用户明确要求不同用户通过相同空间名称共享数据。
// Evidence: ownerId 对每个浏览器/账户不同，拼接后会生成不同远端 spaceId。
// Replacement: resolveCloudflareSpaceId。
// Risk: 任何知道空间名称的人都可能访问同一空间；后端若需访问控制应独立实现鉴权。
// Human Review: Required
//
// Original code:
// import {
//   createLocalSyncOwnerScopeKey,
//   ensureLocalSyncOwnerState,
// } from "@/shared/storage/sync-owner-storage";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import {
  applyBlueprintSyncEntry,
  listBlueprintSyncEntries,
  type BlueprintFolderRecord,
  type BlueprintRecord,
} from "@/shared/storage/blueprint-storage";
// AI-REMOVED 2026-08-08:
// Reason: 同步模块不再通过业务存储列表读取混入 deletedAt 的记录。
// Trigger: 用户要求业务对象与同步墓碑彻底隔离。
// Evidence: listBlueprintSyncEntries 返回独立的同步传输条目。
// Replacement: 上方 listBlueprintSyncEntries import。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { listBlueprintStorageEntries } from "@/shared/storage/blueprint-storage";
import {
  loadPlannerState,
  normalizePlannerPersistedState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import {
  listLatestWorldDocumentsByBase,
  normalizeWorldDocument,
  readWorldDocument,
  writeWorldDocument,
} from "@/shared/storage/world-document-storage";
// AI-REMOVED 2026-07-29:
// Reason: 当前基地集合已复用按 baseId 选择最新文档的共享查询，不再自行枚举全部文档。
// Trigger: 跨设备远端身份从 documentKey 改为 baseId。
// Evidence: listLatestWorldDocumentsByBase 已封装确定性的新旧文档选择。
// Replacement: 上方 listLatestWorldDocumentsByBase import。
// Risk: None。
// Human Review: Required
//
// Original code:
// import { listWorldDocuments } from "@/shared/storage/world-document-storage";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";

import {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  type SyncAdapterConflict,
  type SyncAdapter,
} from "./engine/sync-adapters";
import {
  createSyncService,
  type SyncInitialPlan,
  type SyncLocalChange,
  type SyncMaintenanceTask,
  type SyncService,
} from "./engine/sync-service";
import {
  readWebDavSyncSettings,
  subscribeToWebDavSyncSettingsChanges,
  writeWebDavSyncSettings,
} from "./storage/webdav-sync-settings";
import {
  readSyncProvider,
  writeSyncProvider,
} from "./sync-providers";
import { SyncStateImpl } from "./sync-state-impl";
import { createWebDavWorkerStorageClient } from "./clients/webdav/webdav-worker-client";
import { createWebDavSyncRemote } from "./clients/webdav/webdav-remote";
import { createCloudflareSyncRemote } from "./clients/cloudflare/cloudflare-remote";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import {
  clearCloudflareSyncSettings,
  readCloudflareSyncSettings,
  resolveCloudflareSpaceId,
  subscribeToCloudflareSyncSettingsChanges,
  type CloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";

export interface SyncHostOptions {
  readonly assetSources?: readonly SyncAssetSource[];
  // AI-REMOVED 2026-08-08:
  // Reason: SyncHost 不再把 debugMode 注入 WebDAV 业务请求。
  // Trigger: ST2-RQ-009 统一由主线程 debug-mode runtime 向各 Worker 发布。
  // Evidence: createWebDavWorkerStorageClient 已接入 attachWorkerRuntime。
  // Replacement: src/shared/logging/debug-mode-runtime.ts。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // readonly readDebugEnabled: () => boolean;
}

export interface SyncHost extends SyncContract {
  dispose(): void;
}

type ResolveInteractiveConflict = <TValue>(
  conflict: SyncAdapterConflict<TValue>,
) => Promise<SyncConflictResolution>;

/**
 * 从 provider 选择 + URL 派生 enabled。
 * 兼容旧用户：若 provider 未设置但旧 enabled=true 且 URL 非空，
 * 自动迁移 provider→"webdav"。
 */
function deriveEnabled(settings: { url: string }, oldEnabled?: boolean): boolean {
  const provider = readSyncProvider();
  if (provider === "webdav") {
    return settings.url.trim() !== "";
  }
  if (provider === "cloudflare") {
    return resolveBackendApiBaseUrl().trim() !== "";
  }
  // 迁移路径：旧用户 enabled=true 且 URL 非空，自动注册为 webdav
  if (oldEnabled === true && settings.url.trim() !== "") {
    writeSyncProvider("webdav");
    return true;
  }
  return false;
}

export async function createSyncHost(
  workspace: WorkspaceContract,
  options: SyncHostOptions,
): Promise<SyncHost> {
  const state = new SyncStateImpl();
  const disposers: Array<() => void> = [];
  let remoteApplyDepth = 0;
  let localNotificationScheduled = false;
  let syncStarted = false;
  let directoryTreeReadyKey: string | null = null;
  let lastEditorWebDavHash: string | null = null;
  // AI-REMOVED 2026-08-08:
  // Reason: 本地 owner 不能参与共享 Cloudflare spaceId。
  // Trigger: 相同空间名称必须在不同浏览器中解析为同一个远端空间。
  // Evidence: anonymous ownerId 是每次安装随机生成的 UUID。
  // Replacement: 下方 getCloudflareSpaceId 只解析已保存的 spaceName。
  // Risk: Low；本地同步状态仍按 apiBase + spaceId 隔离。
  // Human Review: Required
  //
  // Original code:
  // const syncOwnerState = await ensureLocalSyncOwnerState();
  // const cloudflareOwnerScope = createLocalSyncOwnerScopeKey(syncOwnerState.activeOwner);
  let currentCloudflareSettings = await readCloudflareSyncSettings();
  let suppressCloudflareSettingsSync = false;
  const getCloudflareSpaceId = (
    settings: CloudflareSyncSettings = currentCloudflareSettings,
  ) => resolveCloudflareSpaceId(settings);
  let currentSettings = await readWebDavSyncSettings();
  // 从 sync provider + URL 派生 enabled 标志，兼容旧用户自动迁移
  // deriveEnabled 内部会在旧用户首次访问时将 provider 写为 "webdav"
  currentSettings = {
    ...currentSettings,
    enabled: deriveEnabled(currentSettings, currentSettings.enabled),
  };
  // AI-REMOVED 2026-08-08:
  // Reason: Cloudflare 不使用 WebDAV URL；伪造 URL 会污染持久设置且切换 provider 后留下错误目标。
  // Trigger: sync-service 现在支持 provider-aware validateSettings。
  // Evidence: Cloudflare 后端地址由 resolveBackendApiBaseUrl() 独立提供。
  // Replacement: 下方 validateSettings。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // if (readSyncProvider() === "cloudflare" && currentSettings.url.trim() === "") {
  //   currentSettings = { ...currentSettings, url: "cloudflare://sync" };
  // }
  let notifyConflictDetected = (
    _conflict: SyncAdapterConflict<unknown>,
  ): void => {};
  const pendingLocalChanges = new Map<string, Set<string> | null>();

  const withRemoteApply = async <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
    remoteApplyDepth += 1;
    try {
      return await task();
    } finally {
      remoteApplyDepth -= 1;
    }
  };
  const notifyLocalChange = (change: SyncLocalChange) => {
    if (remoteApplyDepth > 0) {
      return;
    }
    if (!isAdapterReadyForLocalChanges(
      state.status.initialSyncStage,
      change.adapterId,
      externalSources,
    )) {
      return;
    }

    const currentAssetIds = pendingLocalChanges.get(change.adapterId);
    if (change.assetId === undefined) {
      pendingLocalChanges.set(change.adapterId, null);
    } else if (currentAssetIds !== null) {
      const nextAssetIds = currentAssetIds ?? new Set<string>();
      nextAssetIds.add(change.assetId);
      pendingLocalChanges.set(change.adapterId, nextAssetIds);
    }
    if (localNotificationScheduled) {
      return;
    }
    localNotificationScheduled = true;
    globalThis.queueMicrotask(() => {
      localNotificationScheduled = false;
      if (remoteApplyDepth > 0) {
        pendingLocalChanges.clear();
        return;
      }

      for (const [adapterId, assetIds] of pendingLocalChanges) {
        if (assetIds === null) {
          service.notifyLocalChange({ adapterId });
          continue;
        }

        for (const assetId of assetIds) {
          service.notifyLocalChange({ adapterId, assetId });
        }
      }
      pendingLocalChanges.clear();
    });
  };

  const externalSources = options.assetSources ?? [];
  const resolveInteractiveConflict: ResolveInteractiveConflict = async (
    conflict,
  ) => {
    notifyConflictDetected(conflict);
    return "pause";
  };
  const adapters: SyncAdapter[] = [
    createFullNoRevisionAdapter<PlannerPersistedState>({
      id: "production-planning",
      remotePath: "assets/planner-state.json",
      readLocal: async () => await loadPlannerState(),
      writeLocal: async (value) => await withRemoteApply(async () => {
        await savePlannerState(value);
      }),
      normalizeRemote: normalizePlannerPersistedState,
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintRecord>({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (blueprintId) => `assets/blueprints/${blueprintId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintRecord>("blueprint"),
      writeLocal: async (entry) => await withRemoteApply(async () => {
        await applyBlueprintSyncEntry(entry);
      }),
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintFolderRecord>({
      id: "blueprint-folders",
      indexPath: "assets/blueprint-folders/index.json",
      entryPath: (folderId) => `assets/blueprint-folders/${folderId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintFolderRecord>("folder"),
      writeLocal: async (entry) => await withRemoteApply(async () => {
        await applyBlueprintSyncEntry(entry);
      }),
      resolveConflict: resolveInteractiveConflict,
    }),
    ...externalSources.map((source) => createAdapterFromSource(
      source,
      withRemoteApply,
      resolveInteractiveConflict,
    )),
    createWorldDocumentAdapter(
      workspace,
      resolveInteractiveConflict,
      withRemoteApply,
    ),
  ];

  state.setSettings(currentSettings);
  // AI-REMOVED 2026-07-29:
  // Reason: SyncHost 构造发生在编辑器文档 hydration 之前，提前切到 canvas 会把客户端初始化时间错误计入全屏锁定。
  // Trigger: 用户报告刷新后进度长期停在 10%，即使画布同步尚未发出任何网络请求。
  // Evidence: service.start() 只在 editorDocument 首个 snapshot 到达后执行；原状态更新发生在此之前。
  // Replacement: createSyncService.syncNow 在当前画布同步真正开始时切换 initialSyncStage。
  // Risk: Low；同步启动前界面可操作，但 editor 尚未 hydration 时本来也不会接受业务编辑。
  // Human Review: Required
  //
  // Original code:
  // if (state.settings.enabled) {
  //   state.setStatus({
  //     ...state.status,
  //     phase: "downloading",
  //     initialSyncStage: "canvas",
  //   });
  // }
  const service:  SyncService = createSyncService({
    readSettings: () => currentSettings,
    validateSettings: (settings) => {
      const provider = readSyncProvider();
      if (provider === "cloudflare") {
        return resolveBackendApiBaseUrl().trim() === ""
          ? "Cloudflare backend URL is empty"
          : null;
      }
      return settings.url.trim() === "" ? "Sync URL is empty" : null;
    },
    createRemote: (
      settings,
      onRequestActivityChange,
      requestOptions,
    ) => {
      const provider = readSyncProvider();
      if (provider === "cloudflare") {
        return createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: getCloudflareSpaceId(),
          maxConcurrentRequests: settings.maxConcurrentRequests,
          onRequestActivityChange,
          ...(requestOptions.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: requestOptions.requestTimeoutMs }),
        });
      }
      return createWebDavSyncRemote({
        client: createWebDavWorkerStorageClient({
          baseUrl: settings.url,
          username: settings.username,
          password: settings.password,
          maxConcurrentRequests: settings.maxConcurrentRequests,
          onRequestActivityChange,
          ...(requestOptions.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: requestOptions.requestTimeoutMs }),
        }),
      });
    },
    adapters,
    createInitialSyncPlan: () => createInitialSyncPlan(workspace, externalSources),
    maintenanceTasks: createMaintenanceTasks({
      collections: adapters.map((adapter) => adapter.collection),
      getDirectoryTreeReadyKey: () => directoryTreeReadyKey,
      setDirectoryTreeReadyKey: (key) => {
        directoryTreeReadyKey = key;
      },
    }),
    resolveAdapterTaskKind: (adapterId) =>
      resolveAdapterTaskKind(adapterId, externalSources),
    canRunInterval: () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    beforeSync: async (session) => {
      // 首次同步时侦查远端状态，决定 UI 显示"上传中"还是"下载中"
      if (
        state.status.phase === "downloading"
        && (state.status.currentRunReason === "startup" || state.status.currentRunReason === "foreground")
      ) {
        try {
          const allCollections = adapters.map((a) => a.collection);
          await session.prefetchIndexes(allCollections);
          // 读取第一个集合的 index 判断远端是否为空
          let remoteHasContent = false;
          for (const collection of allCollections) {
            const index = await session.readIndex(collection);
            if (Object.keys(index.entries).length > 0) {
              remoteHasContent = true;
              break;
            }
          }
          if (!remoteHasContent) {
            state.setStatus({
              ...state.status,
              phase: "uploading",
            });
          }
        } catch {
          // 侦查失败不阻塞同步，保留 downloading 显示
        }
      }
    },
    afterSync: () => {
      // AI-REMOVED 2026-07-29:
      // Reason: 远端设备枚举已成为可观察的独立维护任务，避免每轮同步前后重复读取。
      // Trigger: 用户要求详细任务状态，并降低初始画布等待时间。
      // Evidence: 原流程 beforeSync / afterSync 各执行一次 listRemoteDevices()。
      // Replacement: createMaintenanceTasks() 的 remote-devices 任务。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // state.setRemoteDevices(await listRemoteDevices(client));
    },
    onStatusChange: state.setStatus,
    onConflictDiscoveryStart: state.beginConflictDiscovery,
    resolveConflicts: state.requestConflictResolutions,
    onConflictWorkflowFinished: state.finishConflictWorkflow,
  });
  notifyConflictDetected = service.notifyConflictDetected;

  const actions: SyncContract["actions"] = {
    updateSettings: async (patch) => {
      const wasEnabled = currentSettings.enabled;
      const merged = { ...currentSettings, ...patch };
      // enabled 由 provider + URL 派生，忽略 patch 中的 enabled
      merged.enabled = deriveEnabled(merged, wasEnabled ? undefined : currentSettings.enabled);
      currentSettings = await writeWebDavSyncSettings(merged);
      state.setSettings(currentSettings);
      // AI-REMOVED 2026-08-08:
      // Reason: writeWebDavSyncSettings 会同步通知下方订阅者；这里再次 syncNow 会排入第二轮重复同步。
      // Trigger: provider 切换时观察到 settings-change 与 foreground 连续运行。
      // Evidence: emitWebDavSyncSettingsChange 在 writeWebDavSyncSettings 返回前逐个调用 listener。
      // Replacement: subscribeToWebDavSyncSettingsChanges 中的单次触发。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (!wasEnabled && currentSettings.enabled) {
      //   void service.syncNow("settings-change");
      // }
    },
    syncNow: async () => {
      await service.syncNow(
        state.status.initialSyncStage === "ready" ? "manual" : "foreground",
      );
    },
    resolveConflicts: state.resolveConflicts,
    // AI-REMOVED 2026-08-08:
    // Reason: 原删除流程未暂停同步、Cloudflare 使用固定 default，成功后也不统一关闭 provider；
    // UI 若提前写 none，整个 action 还会删到错误目标或什么都不做。
    // Trigger: 设置页删除操作在真实交互中稳定跳过 reset。
    // Evidence: provider 是 action 内唯一的后端分派依据，而旧 UI 在调用 action 前已经覆盖它。
    // Replacement: 下方捕获 provider → stop → reset 同一实例配置 → 成功后 disable → restart。
    // Risk: Medium；失败时保留原 provider，用户可以重试且不会误报删除成功。
    // Human Review: Required
    //
    // Original code:
    // deleteRemoteData: async () => {
    //   const provider = readSyncProvider();
    //   if (provider === "cloudflare") {
    //     const remote = createCloudflareSyncRemote();
    //     try {
    //       await remote.resetRemote?.();
    //     } finally {
    //       remote.dispose?.();
    //     }
    //     return;
    //   }
    //   const settings = currentSettings;
    //   if (!settings.enabled || settings.url.trim() === "") return;
    //   const remote = createWebDavSyncRemote({
    //     client: createWebDavWorkerStorageClient({
    //       baseUrl: settings.url,
    //       username: settings.username,
    //       password: settings.password,
    //       maxConcurrentRequests: settings.maxConcurrentRequests,
    //     }),
    //   });
    //   try {
    //     await remote.resetRemote?.();
    //   } finally {
    //     remote.dispose?.();
    //   }
    // },
    deleteRemoteData: async () => {
      const provider = readSyncProvider();
      if (provider === "none") {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      if (provider === "webdav" && settings.url.trim() === "") {
        throw new Error("Cannot delete WebDAV data because the sync URL is empty.");
      }
      service.stop();
      try {
        const remote = provider === "cloudflare"
          ? createCloudflareSyncRemote({
              apiBase: resolveBackendApiBaseUrl(),
              spaceId: getCloudflareSpaceId(cloudflareSettings),
              maxConcurrentRequests: settings.maxConcurrentRequests,
            })
          : createWebDavSyncRemote({
              client: createWebDavWorkerStorageClient({
                baseUrl: settings.url,
                username: settings.username,
                password: settings.password,
                maxConcurrentRequests: settings.maxConcurrentRequests,
              }),
            });
        try {
          await remote.resetRemote?.();
        } finally {
          remote.dispose?.();
        }

        if (provider === "cloudflare") {
          suppressCloudflareSettingsSync = true;
          try {
            await clearCloudflareSyncSettings();
          } finally {
            suppressCloudflareSettingsSync = false;
          }
        }

        // 只有远端确认 reset 成功后才关闭 provider，避免先改 provider 导致删到另一个后端。
        writeSyncProvider("none");
        currentSettings = await writeWebDavSyncSettings({
          ...currentSettings,
          enabled: false,
        });
        state.setSettings(currentSettings);
      } finally {
        if (syncStarted) {
          service.start();
        }
      }
    },
    abortCurrentTransaction: async () => {
      const provider = readSyncProvider();
      if (provider !== "cloudflare") {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      service.stop();
      try {
        const remote = createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: getCloudflareSpaceId(cloudflareSettings),
          maxConcurrentRequests: settings.maxConcurrentRequests,
        });
        try {
          await remote.abortTransaction?.();
        } finally {
          remote.dispose?.();
        }
      } finally {
        if (syncStarted) {
          service.start();
        }
      }
    },
    // AI-REMOVED 2026-07-29:
    // Reason: 单个 resolution 会强迫全部冲突采用同一选择，并把“暂停”错误解释为关闭 WebDAV。
    // Trigger: 用户要求一个窗口列出全部冲突，每一项独立提供三个选项。
    // Evidence: 新公开 action 按 adapterId/assetId 提交完整 decisions。
    // Replacement: resolveConflicts。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // resolveConflict: (resolution) => {
    //   if (resolution === "pause") {
    //     writeWebDavSyncSettings({
    //       ...readWebDavSyncSettings(),
    //       enabled: false,
    //     });
    //   }
    //   state.resolveConflict(resolution);
    // },
  };
  const host: SyncHost = {
    state,
    actions,
    queries: {},
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      state.cancelConflictWorkflow();
      service.stop();
      if (workspace.sync === host) {
        workspace.sync = null;
      }
    },
  };

  workspace.sync = host;
  disposers.push(subscribeToStorageChanges((event) => {
    if (event.assetType === "world-document") {
      const currentDocument = workspace.editor?.document.getSnapshot();
      if (currentDocument?.documentKey === event.assetId) {
        const nextEditorWebDavHash = createStableJsonHash(
          createWorldDocumentWebDavValue(currentDocument),
        );
        if (lastEditorWebDavHash === nextEditorWebDavHash) {
          return;
        }
        lastEditorWebDavHash = nextEditorWebDavHash;
        notifyLocalChange({
          adapterId: "world-documents",
          assetId: currentDocument.baseId,
        });
        return;
      }
      // AI-REMOVED 2026-07-29:
      // Reason: IndexedDB 变更事件携带的是本机 documentKey，不能再作为按 baseId 编址的远端资产 ID。
      // Trigger: 两台设备对同一基地生成不同 documentKey，导致远端产生两个文件且永远不冲突。
      // Evidence: 真实双浏览器测试中相同 baseId 分别上传到两个 UUID 目录。
      // Replacement: 当前画布在上方映射为 baseId；非当前文档缺少同步读取的 baseId，因此请求该适配器全量检查。
      // Risk: Low；非当前文档变更会多检查一次索引，但不会错误地上传 UUID 资产。
      // Human Review: Required
      //
      // Original code:
      // notifyLocalChange({
      //   adapterId: "world-documents",
      //   assetId: event.assetId,
      // });
      notifyLocalChange({
        adapterId: "world-documents",
      });
    } else if (event.assetType === "production-planning") {
      notifyLocalChange({ adapterId: "production-planning" });
    } else if (event.assetType === "blueprint") {
      notifyLocalChange({
        adapterId: "blueprints",
        assetId: event.assetId,
      });
    } else if (event.assetType === "blueprint-folder") {
      notifyLocalChange({
        adapterId: "blueprint-folders",
        assetId: event.assetId,
      });
    }
  }));
  for (const source of externalSources) {
    disposers.push(source.subscribe(() => {
      notifyLocalChange({ adapterId: source.id });
    }));
  }
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    let editorDocumentHydrated = false;
    disposers.push(editorDocument.subscribe((documentSnapshot) => {
      const nextEditorWebDavHash = createStableJsonHash(
        createWorldDocumentWebDavValue(documentSnapshot),
      );
      if (!editorDocumentHydrated) {
        editorDocumentHydrated = true;
        lastEditorWebDavHash = nextEditorWebDavHash;
        syncStarted = true;
        service.start();
        return;
      }

      if (lastEditorWebDavHash === nextEditorWebDavHash) {
        return;
      }
      lastEditorWebDavHash = nextEditorWebDavHash;
      // AI-REMOVED 2026-07-29:
      // Reason: 视口中心等设备本地展示状态也会产生 document snapshot，原逻辑把它误判为待上传内容。
      // Trigger: 真实服务器诊断发现每次前台检查都因 viewport center 变化制造 delta 和新 revision。
      // Evidence: 远端 delta 仅包含 /documentSettings/viewport/center/x、y。
      // Replacement: 上方 WebDAV 投影哈希门控，仅业务同步内容变化时进入 notifyLocalChange。
      // Risk: Low；视口仍照常保存到本地 IndexedDB。
      // Human Review: Required
      //
      // Original code:
      // notifyLocalChange({
      //   adapterId: "world-documents",
      //   assetId: documentSnapshot.documentKey,
      // });
      // AI-CORRECTION 2026-07-29: 远端当前画布资产现以稳定 baseId 编址；
      // documentKey 只保留为本机 IndexedDB 与编辑器身份，不再进入上传队列。
      notifyLocalChange({
        adapterId: "world-documents",
        assetId: documentSnapshot.baseId,
      });
    }));
  } else {
    syncStarted = true;
    service.start();
  }
  disposers.push(subscribeToWebDavSyncSettingsChanges((settings) => {
    currentSettings = settings;
    const wasEnabled = state.settings.enabled;
    state.setSettings(settings);
    if (!settings.enabled && state.pendingConflict !== null) {
      state.cancelConflictWorkflow();
    }
    if (!settings.enabled && !syncStarted) {
      state.setStatus({
        ...state.status,
        phase: "idle",
        initialSyncStage: "ready",
      });
    }
    // AI-REMOVED 2026-07-29:
    // Reason: 文档尚未 hydration 时开启 WebDAV 也不应提前显示无请求的画布锁定。
    // Trigger: 用户要求锁定只覆盖当前画布远端判定，不覆盖初始化。
    // Evidence: syncStarted=false 表示 service 尚未开始，状态中的 canvas 没有对应网络任务。
    // Replacement: syncStarted 后由 service.syncNow("startup"/"foreground") 原子进入 canvas 阶段。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // else if (settings.enabled && !syncStarted) {
    //   state.setStatus({
    //     ...state.status,
    //     phase: "downloading",
    //     initialSyncStage: "canvas",
    //   });
    // }
    if (syncStarted) {
      void service.syncNow(
        settings.enabled && !wasEnabled ? "foreground" : "settings-change",
      );
    }
  }));
  disposers.push(subscribeToCloudflareSyncSettingsChanges((settings) => {
    const changed = settings.spaceName !== currentCloudflareSettings.spaceName;
    currentCloudflareSettings = settings;
    if (
      changed
      && !suppressCloudflareSettingsSync
      && syncStarted
      && readSyncProvider() === "cloudflare"
    ) {
      void service.syncNow("settings-change");
    }
  }));
  if (typeof document !== "undefined") {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible"
        && syncStarted
        && currentSettings.enabled
      ) {
        void service.syncNow("foreground");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    disposers.push(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  }

  return host;
}

function isAdapterReadyForLocalChanges(
  initialSyncStage: SyncInitialSyncStage,
  adapterId: string,
  externalSources: readonly SyncAssetSource[],
): boolean {
  if (initialSyncStage === "ready") {
    return true;
  }
  if (adapterId === "world-documents") {
    return initialSyncStage !== "canvas";
  }
  if (adapterId === "blueprints" || adapterId === "blueprint-folders") {
    return initialSyncStage === "modules" || initialSyncStage === "toolbox";
  }
  if (externalSources.some((source) => source.id === adapterId)) {
    return initialSyncStage === "toolbox";
  }

  return false;
}

function createMaintenanceTasks(options: {
  readonly collections: readonly SyncAdapter["collection"][];
  readonly getDirectoryTreeReadyKey: () => string | null;
  readonly setDirectoryTreeReadyKey: (key: string) => void;
}): readonly SyncMaintenanceTask[] {
  return [
    {
      kind: "directory-maintenance",
      run: async (client, settings) => {
        const directoryTreeKey = `${settings.url.trim()}\u0000${settings.username}`;
        if (options.getDirectoryTreeReadyKey() === directoryTreeKey) {
          return;
        }

        await client.prepareCollections?.(options.collections);
        options.setDirectoryTreeReadyKey(directoryTreeKey);
      },
    },
    // AI-REMOVED 2026-07-29:
    // Reason: 设备注册和设备枚举不再是同步维护任务。
    // Trigger: 用户确认设备列表没有意义，冲突仅展示资源 revision 的远端上传时间。
    // Evidence: 真实服务器逐个读取 39 个设备文件约耗时 17.9 秒，且结果不能可靠归因 revision。
    // Replacement: 资源 index/meta 的 committedAt。
    // Risk: Low；服务器上的旧 devices 目录不会被自动删除。
    // Human Review: Required
    //
    // Original code:
    // {
    //   kind: "device-registration",
    //   run: async (client) => {
    //     await registerCurrentDevice(client);
    //   },
    // },
    // {
    //   kind: "remote-devices",
    //   run: async (client) => {
    //     options.state.setRemoteDevices(await listRemoteDevices(client));
    //   },
    // },
  ];
}

function resolveAdapterTaskKind(
  adapterId: string,
  externalSources: readonly SyncAssetSource[],
): SyncTaskKind {
  if (adapterId === "blueprints" || adapterId === "blueprint-folders") {
    return "blueprints";
  }
  if (adapterId === "production-planning") {
    return "toolbox";
  }
  if (externalSources.some((source) => source.id === adapterId)) {
    return "modules";
  }

  return "canvas";
}

function createInitialSyncPlan(
  workspace: WorkspaceContract,
  externalSources: readonly SyncAssetSource[],
): SyncInitialPlan {
  // AI-REMOVED 2026-07-29:
  // Reason: documentKey 是每台设备独立生成的本机身份，不能标识跨设备的同一基地。
  // Trigger: 刷新或另一台设备同步时，当前基地被当成 remote-only 后台文档，画布阶段检查的是本机 UUID 空目录。
  // Evidence: 真实服务器同时存在同一 baseId 的两个 UUID 目录，另一设备刷新后画布内容未变化且 pendingConflict=null。
  // Replacement: 下方 currentBaseId 及按 baseId 构造的前台/后台 scope。
  // Risk: Medium；旧 UUID 目录保留为历史数据，新协议首次由当前本地画布建立 canonical 条目。
  // Human Review: Required
  //
  // Original code:
  // const currentDocumentKey = workspace.editor?.document.getSnapshot().documentKey;
  // const currentDocumentRequest = currentDocumentKey === undefined
  //   ? []
  //   : [{
  //     adapterId: "world-documents",
  //     scope: { includeAssetIds: [currentDocumentKey] },
  //   }];
  const currentBaseId = workspace.editor?.document.getSnapshot().baseId;
  const currentDocumentRequest = currentBaseId === undefined
    ? []
    : [{
      adapterId: "world-documents",
      scope: { includeAssetIds: [currentBaseId] },
    }];

  return {
    batches: [
      {
        stage: "canvas",
        requests: currentDocumentRequest,
      },
      {
        stage: "blueprints",
        requests: [
          { adapterId: "blueprints" },
          { adapterId: "blueprint-folders" },
        ],
      },
      {
        stage: "modules",
        requests: externalSources.map((source) => ({
          adapterId: source.id,
        })),
      },
      {
        stage: "toolbox",
        requests: [{ adapterId: "production-planning" }],
      },
    ],
    backgroundRequests: [{
      adapterId: "world-documents",
      scope: currentBaseId === undefined
        ? undefined
        : { excludeAssetIds: [currentBaseId] },
    }],
  };
}

function createAdapterFromSource(
  source: SyncAssetSource,
  withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
  resolveConflict: ResolveInteractiveConflict,
): SyncAdapter {
  const sharedOptions = {
    id: source.id,
    indexPath: source.indexPath,
    listLocal: source.listLocal,
    writeLocal: async (entry: SyncAssetEntry) => await withRemoteApply(async () => {
      await source.writeLocal(entry);
    }),
    normalizeRemote: source.normalizeRemote,
    resolveConflict,
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
  resolveConflict: ResolveInteractiveConflict,
  withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
): SyncAdapter {
  return createPatchCollectionWithRevisionAdapter<WorldDocument>({
    id: "world-documents",
    // AI-REMOVED 2026-07-29:
    // Reason: 旧集合按本机 UUID 编址，同一基地在不同设备上无法互相发现。
    // Trigger: 用户报告跨设备刷新后当前画布未同步，也没有冲突提示。
    // Evidence: 真实双端测试确认 A/B 的 baseId 相同、documentKey 不同，服务器生成两个独立资产。
    // Replacement: documents/by-base/index.json 与 documents/by-base/<baseId>。
    // Risk: Medium；不自动删除或猜测合并旧 UUID 历史目录。
    // Human Review: Required
    //
    // Original code:
    // indexPath: "documents/index.json",
    // directoryPath: (documentKey) => `documents/${encodeURIComponent(documentKey)}`,
    indexPath: "documents/by-base/index.json",
    directoryPath: (baseId) => `documents/by-base/${encodeURIComponent(baseId)}`,
    listLocal: async (scope) => {
      // AI-REMOVED 2026-07-29:
      // Reason: 按 documentKey 列出会把同一基地的设备副本视为不同的远端资产。
      // Trigger: 当前画布跨设备无法覆盖、下载或产生冲突。
      // Evidence: Search-First 找到 shared 已有 listLatestWorldDocumentsByBase，可直接复用其确定性新旧排序。
      // Replacement: 下方 documentsByBase；当前编辑器快照优先覆盖同基地的持久化副本。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // const documentsByKey = new Map(
      //   (await listWorldDocuments()).map((document) => [document.documentKey, document]),
      // );
      // const currentDocument = workspace.editor?.document.getSnapshot();
      // if (currentDocument !== undefined) {
      //   documentsByKey.set(currentDocument.documentKey, currentDocument);
      // }
      //
      // return Array.from(documentsByKey.values()).map((document) => ({
      //   id: document.documentKey,
      //   value: createWorldDocumentWebDavValue(document),
      //   deletedAt: null,
      // }));
      const currentDocument = workspace.editor?.document.getSnapshot();
      if (
        currentDocument !== undefined
        && scope?.includeAssetIds?.length === 1
        && scope.includeAssetIds[0] === currentDocument.baseId
      ) {
        return [{
          id: currentDocument.baseId,
          value: createWorldDocumentWebDavValue(currentDocument),
          deletedAt: null,
        }];
      }

      const documentsByBase = await listLatestWorldDocumentsByBase({});
      if (currentDocument !== undefined) {
        documentsByBase.set(currentDocument.baseId, currentDocument);
      }

      return Array.from(documentsByBase.values()).flatMap((document) =>
        scope?.includeAssetIds !== undefined
        && !scope.includeAssetIds.includes(document.baseId)
          ? []
          : [{
            id: document.baseId,
            value: createWorldDocumentWebDavValue(document),
            deletedAt: null,
          }]
      );
    },
    writeLocal: async (entry) => await withRemoteApply(async () => {
      const editor = workspace.editor;
      const currentDocument = editor?.document.getSnapshot();
      // AI-REMOVED 2026-07-29:
      // Reason: 远端 canonical 文档不再携带本机 documentKey，按 entry.value.documentKey 查找会写成新的错误文档。
      // Trigger: 用户要求远端内容应用到当前画布，同时保留每台设备的内部对象身份。
      // Evidence: documentKey 是 IndexedDB key 与 editor 当前文档身份；替换它会断开当前编辑器和持久化记录。
      // Replacement: 下方按 entry.id(baseId) 查找本机最新副本，并由 preserveLocalWorldDocumentIdentity 保留身份。
      // Risk: Low；无本地副本时生成新的本机 UUID。
      // Human Review: Required
      //
      // Original code:
      // const existingDocument = currentDocument?.documentKey === entry.value.documentKey
      //   ? currentDocument
      //   : await readWorldDocument(entry.value.documentKey);
      // const localValue = preserveLocalWorldDocumentViewport(
      //   entry.value,
      //   existingDocument,
      // );
      // await writeWorldDocument(localValue);
      // if (
      //   editor !== null
      //   && currentDocument?.documentKey === entry.value.documentKey
      // ) {
      //   editor.actions.applySynchronizedDocument(localValue);
      // }
      const latestDocumentsByBase = await listLatestWorldDocumentsByBase({});
      const existingDocument = currentDocument?.baseId === entry.id
        ? currentDocument
        : latestDocumentsByBase.get(entry.id) ?? await readWorldDocument(entry.id);
      const localValue = preserveLocalWorldDocumentIdentity(
        {
          ...entry.value,
          baseId: entry.id,
          documentKey: entry.id,
        },
        existingDocument,
      );
      await writeWorldDocument(localValue);
      if (
        editor !== null
        && currentDocument?.baseId === entry.id
      ) {
        editor.actions.applySynchronizedDocument(localValue);
      }
    }),
    normalizeRemote: (value) => {
      const document = normalizeWorldDocument(value);

      return document === null
        ? null
        : createWorldDocumentWebDavValue(document);
    },
    resolveConflict,
  });
}

export function createWorldDocumentWebDavValue(
  document: WorldDocument,
): WorldDocument {
  return {
    ...document,
    documentKey: document.baseId,
    documentSettings: {
      ...document.documentSettings,
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
        displayRotation: 0,
      },
    },
  };
}

// AI-REMOVED 2026-07-29:
// Reason: 仅保留 viewport 会把远端 canonical documentKey 写进本机 IndexedDB，破坏编辑器内部对象身份。
// Trigger: 当前画布改为按 baseId 编址后，远端 documentKey 被规范化为 baseId。
// Evidence: writeWorldDocument 以 document.documentKey 为 IndexedDB key，editor 也以本机 documentKey 识别当前文档。
// Replacement: preserveLocalWorldDocumentIdentity。
// Risk: Low。
// Human Review: Required
//
// Original code:
// function preserveLocalWorldDocumentViewport(
//   remoteDocument: WorldDocument,
//   localDocument: WorldDocument | null | undefined,
// ): WorldDocument {
//   if (localDocument === null || localDocument === undefined) {
//     return remoteDocument;
//   }
//
//   return {
//     ...remoteDocument,
//     documentSettings: {
//       ...remoteDocument.documentSettings,
//       viewport: localDocument.documentSettings.viewport,
//     },
//   };
// }
export function preserveLocalWorldDocumentIdentity(
  remoteDocument: WorldDocument,
  localDocument: WorldDocument | null | undefined,
): WorldDocument {
  return {
    ...remoteDocument,
    documentKey: localDocument?.documentKey ?? createUuid(),
    documentSettings: {
      ...remoteDocument.documentSettings,
      viewport: localDocument?.documentSettings.viewport
        ?? remoteDocument.documentSettings.viewport,
    },
  };
}

// AI-REMOVED 2026-08-06:
// Reason: REQ-005 将 WebDAV 目录维护移动到 WebDavSyncRemoteSession.prepareCollections，sync-host 不再直接持有 WebDAV 文件系统 client。
// Trigger: SyncRemote 重构要求 app/service/adapter 调用面面向同步业务 session，而不是 WebDAV 目录和文件操作。
// Evidence: createMaintenanceTasks 现在调用 session.prepareCollections?.(collections)，WebDavSyncRemoteSession 内部按 collection.webDav binding 维护目录层级。
// Replacement: src/sync/clients/webdav/webdav-remote.ts WebDavSyncRemoteSession.prepareCollections。
// Risk: Low；目录创建顺序仍按深度分组并行，写入路径仍由 WebDAV remote 确保父目录存在。
// Human Review: Required
//
// Original code:
// async function ensureWebDavDirectoryTree(
//   client: SyncStorageClient,
//   externalSources: readonly SyncAssetSource[],
// ): Promise<void> {
//   const directoryPaths = new Set([
//     "",
//     "assets",
//     "assets/blueprints",
//     "assets/blueprint-folders",
//     "documents",
//     "documents/by-base",
//   ]);
//   for (const source of externalSources) {
//     addPathAncestors(directoryPaths, source.indexPath);
//   }
//   const pathsByDepth = new Map<number, string[]>();
//   for (const path of directoryPaths) {
//     const depth = path === "" ? 0 : path.split("/").length;
//     const paths = pathsByDepth.get(depth) ?? [];
//     paths.push(path);
//     pathsByDepth.set(depth, paths);
//   }
//   for (const depth of Array.from(pathsByDepth.keys()).sort((left, right) => left - right)) {
//     await Promise.all(
//       (pathsByDepth.get(depth) ?? []).map(async (path) => {
//         await client.makeDirectory(path);
//       }),
//     );
//   }
// }
//
// function addPathAncestors(paths: Set<string>, filePath: string): void {
//   const segments = filePath.split("/").filter(Boolean);
//   segments.pop();
//   let current = "";
//   for (const segment of segments) {
//     current = current === "" ? segment : `${current}/${segment}`;
//     paths.add(current);
//   }
// }

// AI-REMOVED 2026-07-29:
// Reason: 设备心跳、全量设备枚举和“最近设备即提交者”的猜测均退出同步协议。
// Trigger: 用户确认不需要列出设备，仅提示远端上传时间。
// Evidence: 设备文件无法关联到具体 revision，且 39 个文件的真实枚举约耗时 17.9 秒。
// Replacement: webdav-sync-adapters.ts RemoteIndexEntry/RemotePatchMetaFile.committedAt。
// Risk: Low；远端旧 devices/*.json 保留，未执行破坏性删除。
// Human Review: Required
//
// Original code:
// async function registerCurrentDevice(client: SyncStorageClient): Promise<void> {
//   const now = new Date().toISOString();
//   const ownerState = await ensureLocalSyncOwnerState({ now });
//   const path = `devices/${ownerState.deviceId}.json`;
//   const existing = await readRemoteDeviceInfo(client, path);
//   const nextDevice: SyncRemoteDeviceInfo = {
//     deviceId: ownerState.deviceId,
//     label: existing?.label ?? createDefaultDeviceLabel(now),
//     firstSeen: existing?.firstSeen ?? now,
//     lastActive: now,
//   };
//
//   await client.writeTextFile(path, JSON.stringify(nextDevice));
// }
//
// async function listRemoteDevices(
//   client: SyncStorageClient,
// ): Promise<SyncRemoteDeviceInfo[]> {
//   const entries = await client.listDirectory("devices");
//   const devices = await Promise.all(entries.flatMap((entry) =>
//     entry.type === "file" && entry.basename.endsWith(".json")
//       ? [readRemoteDeviceInfo(client, `devices/${entry.basename}`)]
//       : []
//   ));
//
//   return devices.filter((device): device is SyncRemoteDeviceInfo => device !== null);
// }
//
// async function readRemoteDeviceInfo(
//   client: SyncStorageClient,
//   path: string,
// ): Promise<SyncRemoteDeviceInfo | null> {
//   const file = await client.readTextFile(path);
//   if (file === null) {
//     return null;
//   }
//
//   try {
//     return normalizeRemoteDeviceInfo(JSON.parse(file.content));
//   } catch {
//     return null;
//   }
// }
//
// function normalizeRemoteDeviceInfo(value: unknown): SyncRemoteDeviceInfo | null {
//   if (
//     !isRecord(value)
//     || typeof value.deviceId !== "string"
//     || typeof value.label !== "string"
//     || typeof value.firstSeen !== "string"
//     || typeof value.lastActive !== "string"
//   ) {
//     return null;
//   }
//
//   return {
//     deviceId: value.deviceId,
//     label: value.label,
//     firstSeen: value.firstSeen,
//     lastActive: value.lastActive,
//   };
// }
//
// function resolveRemoteDeviceLabel(
//   devices: readonly SyncRemoteDeviceInfo[],
// ): string {
//   return devices[0]?.label ?? "远端设备";
// }
//
// function createDefaultDeviceLabel(now: string): string {
//   const navigatorValue = typeof navigator === "undefined" ? null : navigator;
//   const browser = navigatorValue?.userAgent.includes("Firefox") ? "Firefox"
//     : navigatorValue?.userAgent.includes("Edg/") ? "Edge"
//       : navigatorValue?.userAgent.includes("Chrome") ? "Chrome"
//         : "Browser";
//   const platform = navigatorValue?.platform || "Unknown OS";
//
//   return `${browser} on ${platform} (${now.slice(0, 10)})`;
// }
//
// function isRecord(value: unknown): value is Record<string, unknown> {
//   return typeof value === "object" && value !== null;
// }
