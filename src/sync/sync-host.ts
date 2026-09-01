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
  deleteWorldDocument,
  listLatestWorldDocumentsByBase,
  listWorldDocuments,
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
import type { SnapshotChangeContext } from "@/shared/snapshot/snapshot-store";

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
  readSyncConnectionSettings,
  subscribeToSyncConnectionSettingsChanges,
  writeSyncConnectionSettings,
} from "./storage/sync-connection-settings";
import {
  readSyncProvider,
  writeSyncProvider,
} from "./sync-providers";
import {
  activateSyncProvider,
  createCloudflareAccountSyncTargetKey,
  createCloudflareAnonymousSyncTargetKey,
  createWebDavSyncTargetKey,
  hasPersistedSyncProviderActivation,
  isSyncProviderTargetActive,
  readActiveSyncProvider,
  readSyncProviderActivation,
  subscribeToSyncProviderActivationChanges,
} from "@/shared/storage/sync-provider-activation";
import { SyncStateImpl } from "./sync-state-impl";
import { createWebDavWorkerStorageClient } from "./clients/webdav/webdav-worker-client";
import { createWebDavSyncRemote } from "./clients/webdav/webdav-remote";
// AI-REMOVED 2026-08-12:
// Reason: 直接引用旧主线程 Cloudflare remote 会绕过新的长生命周期 Worker。
// Trigger: 用户要求上传开始后即使标签页切到后台也继续上传，并降低主线程渲染压力。
// Evidence: clients/cloudflare 公共入口现在导出 v2 Worker remote 与 transport。
// Replacement: 下方公共入口导入。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { createCloudflareSyncRemote } from "./clients/cloudflare/cloudflare-remote";
import {
  CloudflareV2WorkerClient,
  createCloudflareSyncRemote,
  initializeCloudflareSpaceSettings,
  readCloudflareV2LocalRevision,
} from "./clients/cloudflare";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import {
  clearCloudflareOAuthSession,
  readCloudflareOAuthSession,
  subscribeToCloudflareOAuthSessionChanges,
  type CloudflareOAuthSession,
} from "@/shared/storage/cloudflare-oauth-session";
// AI-REMOVED 2026-08-19:
// Reason: 同步主机启动时必须完成随机空间初始化；删除远端数据后直接写入新的随机空间，不再留下未初始化状态。
// Trigger: 新用户不能继续隐式进入共享 default 空间，同时已有 default 用户必须保持不动。
// Evidence: initializeCloudflareSpaceSettings 会区分已选 provider、本地 default 状态和首次使用；删除流程已成功 reset 当前远端。
// Replacement: initializeCloudflareSpaceSettings、createRandomCloudflareSpaceName 与 writeCloudflareSyncSettings。
// Risk: Low。
// Human Review: Required
// AI-CORRECTION 2026-08-24: 上述随机空间替代方案已失效；未确认用户保持空目标，删除后也回到待配置态。
//
// Original code:
//   clearCloudflareSyncSettings,
//   readCloudflareSyncSettings,
import {
  clearCloudflareSyncSettings,
  resolveCloudflareSpaceId,
  subscribeToCloudflareSyncSettingsChanges,
  writeCloudflareSyncSettings,
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
// AI-CORRECTION 2026-08-24: enabled 现在由已确认 activation 与当前目标共同派生；pending provider 永远返回 false。
function deriveEnabled(
  settings: { readonly url: string; readonly username: string },
  cloudflareTargetKey: string | null,
  oldEnabled?: boolean,
): boolean {
  // AI-REMOVED 2026-08-24:
  // Reason: provider 选择不再等同于同步激活，单看 provider/URL 会在配置确认前启动网络同步。
  // Trigger: 用户要求切换同步方式后必须进入设置明确确认目标。
  // Evidence: sync-provider-activation 区分 pending 与 active，并保存已确认目标 key。
  // Replacement: 下方 isSyncProviderTargetActive 门控。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const provider = readSyncProvider();
  // if (provider === "webdav") {
  //   return settings.url.trim() !== "";
  // }
  // if (provider === "cloudflare") {
  //   return resolveBackendApiBaseUrl().trim() !== "";
  // }
  // // 迁移路径：旧用户 enabled=true 且 URL 非空，自动注册为 webdav
  // if (oldEnabled === true && settings.url.trim() !== "") {
  //   writeSyncProvider("webdav");
  //   return true;
  // }
  // return false;
  const webDavTargetKey = createWebDavSyncTargetKey(settings);
  if (
    settings.url.trim() !== ""
    && isSyncProviderTargetActive("webdav", webDavTargetKey)
  ) {
    return true;
  }
  if (
    cloudflareTargetKey !== null
    && resolveBackendApiBaseUrl().trim() !== ""
    && isSyncProviderTargetActive("cloudflare", cloudflareTargetKey)
  ) {
    return true;
  }
  if (
    !hasPersistedSyncProviderActivation()
    && readSyncProvider() === "none"
    && oldEnabled === true
    && settings.url.trim() !== ""
  ) {
    return activateSyncProvider("webdav", webDavTargetKey);
  }
  return false;
}

export async function createSyncHost(
  workspace: WorkspaceContract,
  options: SyncHostOptions,
): Promise<SyncHost> {
  const state = new SyncStateImpl();
  const disposers: Array<() => void> = [];
  let currentCloudflareSession = readCloudflareOAuthSession();
  // Cloudflare transport 归 SyncHost 所有；单轮 SyncRemote dispose 不终止正在后台执行的上传。
  // 延迟创建避免未选择 Cloudflare 时加载或初始化对应 Worker。
  let cloudflareWorkerClient: CloudflareV2WorkerClient | null = null;
  const getCloudflareWorkerClient = (): CloudflareV2WorkerClient => {
    cloudflareWorkerClient ??= new CloudflareV2WorkerClient({
      onAuthenticationFailure: () => {
        if (currentCloudflareSession !== null) {
          clearCloudflareOAuthSession();
        }
      },
    });
    return cloudflareWorkerClient;
  };
  const disposeCloudflareWorkerClient = (): void => {
    cloudflareWorkerClient?.dispose();
    cloudflareWorkerClient = null;
  };
  // AI-REMOVED 2026-08-12:
  // Reason: 远端落地已由 storage/snapshot change origin 显式标记，不再需要动态作用域猜测变更来源。
  // Trigger: Cloudflare 冲突选择 use-remote 后，remoteApplyDepth 依赖回调发生在 Promise 释放前的时序。
  // Evidence: storage-change-event 和 snapshot-store 现在携带 local/remote-sync origin。
  // Replacement: subscribeToStorageChanges 与 editorDocument.subscribe 的 origin 过滤。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // let remoteApplyDepth = 0;
  let localNotificationScheduled = false;
  let syncStarted = false;
  let directoryTreeReadyKey: string | null = null;
  // AI-REMOVED 2026-08-22:
  // Reason: 单一 hash 把不同基地之间的正常导航当成同一文档的内容变化。
  // Trigger: 切换到非当前基地才产生上传意图并暴露此前被漏检的冲突。
  // Evidence: A/B 的同步投影天然不同，lastEditorDocumentHash 无法表达 hash 所属 baseId。
  // Replacement: 下方 lastEditorDocumentHashByBaseId 与 recordWorldDocumentProjectionChange。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // let lastEditorDocumentHash: string | null = null;
  // 按基地记录已观察到的同步投影，避免 A→B 导航的天然 hash 变化被误判为编辑。
  const lastEditorDocumentHashByBaseId = new Map(
    Array.from(
      (await listLatestWorldDocumentsByBase({})).values(),
      (document) => [
        document.baseId,
        createStableJsonHash(createWorldDocumentRemoteValue(document)),
      ] as const,
    ),
  );
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
  const activationAtStartup = readSyncProviderActivation();
  let currentCloudflareSettings = await initializeCloudflareSpaceSettings({
    apiBase: resolveBackendApiBaseUrl(),
    cloudflareProviderSelected: activationAtStartup.state === "active"
      && activationAtStartup.provider === "cloudflare"
      && activationAtStartup.confirmedTargetKey === null,
  });
  if (
    !hasPersistedSyncProviderActivation()
    && readActiveSyncProvider() === "cloudflare"
    && currentCloudflareSession !== null
    && currentCloudflareSettings.remoteMode === "anonymous"
  ) {
    currentCloudflareSettings = await writeCloudflareSyncSettings({
      ...currentCloudflareSettings,
      remoteMode: "account",
    });
  }
  let suppressCloudflareSettingsSync = false;
  const resolveCloudflareTargetKey = (
    settings: CloudflareSyncSettings = currentCloudflareSettings,
    session: CloudflareOAuthSession | null = currentCloudflareSession,
  ): string | null => {
    if (settings.remoteMode === "account") {
      return session === null
        || session.apiBaseUrl !== resolveBackendApiBaseUrl()
        ? null
        : createCloudflareAccountSyncTargetKey({
            apiBaseUrl: session.apiBaseUrl,
            accountId: session.account.accountId,
            spaceId: session.spaceId,
          });
    }
    return settings.spaceName.trim() === ""
      ? null
      : createCloudflareAnonymousSyncTargetKey({
          apiBaseUrl: resolveBackendApiBaseUrl(),
          spaceId: settings.spaceName,
        });
  };
  const getCloudflareTarget = (
    settings: CloudflareSyncSettings = currentCloudflareSettings,
    session: CloudflareOAuthSession | null = currentCloudflareSession,
  ) => {
    if (settings.remoteMode === "account") {
      if (
        session === null
        || session.apiBaseUrl !== resolveBackendApiBaseUrl()
      ) {
        throw new Error("Cloudflare account login is required.");
      }
      return {
        spaceId: session.spaceId,
        accessToken: session.accessToken,
        targetKey: createCloudflareAccountSyncTargetKey({
          apiBaseUrl: session.apiBaseUrl,
          accountId: session.account.accountId,
          spaceId: session.spaceId,
        }),
      };
    }
    return {
      spaceId: resolveCloudflareSpaceId(settings),
      accessToken: null,
      targetKey: createCloudflareAnonymousSyncTargetKey({
        apiBaseUrl: resolveBackendApiBaseUrl(),
        spaceId: resolveCloudflareSpaceId(settings),
      }),
    };
  };
  let localRevisionTargetKey: string | null = null;
  let localRevisionRefreshGeneration = 0;
  const refreshCurrentLocalRevision = async (): Promise<void> => {
    const generation = ++localRevisionRefreshGeneration;
    if (readActiveSyncProvider() !== "cloudflare") {
      localRevisionTargetKey = null;
      state.setCurrentLocalRevision(null);
      return;
    }

    let target: ReturnType<typeof getCloudflareTarget>;
    try {
      target = getCloudflareTarget();
    } catch {
      localRevisionTargetKey = null;
      state.setCurrentLocalRevision(null);
      return;
    }

    if (localRevisionTargetKey !== target.targetKey) {
      localRevisionTargetKey = target.targetKey;
      state.setCurrentLocalRevision(null);
    }

    try {
      const revision = await readCloudflareV2LocalRevision(
        resolveBackendApiBaseUrl(),
        target.spaceId,
      );
      if (
        generation === localRevisionRefreshGeneration
        && readActiveSyncProvider() === "cloudflare"
        && resolveCloudflareTargetKey() === target.targetKey
      ) {
        state.setCurrentLocalRevision(revision);
      }
    } catch {
      // 本地 revision 读取失败不影响同步；目标切换时已清空旧目标的展示值。
    }
  };
  let currentSettings = await readSyncConnectionSettings();
  // 从 sync provider + URL 派生 enabled 标志，兼容旧用户自动迁移
  // deriveEnabled 内部会在旧用户首次访问时将 provider 写为 "webdav"
  // AI-CORRECTION 2026-08-24: 迁移现在写入带目标确认 key 的 active activation，不再只写 provider。
  currentSettings = {
    ...currentSettings,
    enabled: deriveEnabled(
      currentSettings,
      resolveCloudflareTargetKey(),
      currentSettings.enabled,
    ),
  };
  const initialActivation = readSyncProviderActivation();
  if (
    initialActivation.state === "active"
    && initialActivation.confirmedTargetKey === null
  ) {
    const legacyTargetKey = initialActivation.provider === "webdav"
      ? currentSettings.url.trim() === ""
        ? null
        : createWebDavSyncTargetKey(currentSettings)
      : resolveCloudflareTargetKey();
    if (legacyTargetKey !== null) {
      activateSyncProvider(initialActivation.provider, legacyTargetKey);
    }
  }
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

  // AI-REMOVED 2026-08-12:
  // Reason: 动态 remote apply depth 无法表达跨异步边界的变更因果。
  // Trigger: use-remote 落地后仍可能在 depth 释放后收到变更通知。
  // Evidence: 用 didDownload 延迟 5 秒只能回避竞态，不能消除竞态。
  // Replacement: 远端资产写入显式传递 origin: "remote-sync"。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const withRemoteApply = async <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
  //   remoteApplyDepth += 1;
  //   try {
  //     return await task();
  //   } finally {
  //     remoteApplyDepth -= 1;
  //   }
  // };
  const notifyLocalChange = (change: SyncLocalChange) => {
    // AI-REMOVED 2026-08-12:
    // Reason: 变更来源已在通知边界过滤，不再读取动态 depth。
    // Trigger: remoteApplyDepth 只在回调与远端写入同步重入时可靠。
    // Evidence: 所有内建远端落地均标记 remote-sync。
    // Replacement: 下方 storage/snapshot 订阅者的 origin 分支。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (remoteApplyDepth > 0) {
    //   return;
    // }
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
      // AI-REMOVED 2026-08-12:
      // Reason: microtask 不再负责猜测远端写入是否已经释放。
      // Trigger: 用 microtask 与 remoteApplyDepth 的相对时序过滤通知会遗漏异步事件。
      // Evidence: origin 在事件创建时已固定，不受后续调度影响。
      // Replacement: microtask 仅合并本地变更通知。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // if (remoteApplyDepth > 0) {
      //   pendingLocalChanges.clear();
      //   return;
      // }

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
      // AI-REMOVED 2026-08-12:
      // Reason: 远端落地不再由 withRemoteApply 时序窗口抑制通知。
      // Trigger: Cloudflare use-remote 会在抑制释放后被误判为本地修改。
      // Evidence: savePlannerState 现在支持显式 StorageWriteOptions.origin。
      // Replacement: 下方 origin: "remote-sync" 写入。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // writeLocal: async (value) => await withRemoteApply(async () => {
      //   await savePlannerState(value);
      // }),
      writeLocal: async (value) => {
        await savePlannerState(value, { origin: "remote-sync" });
      },
      normalizeRemote: normalizePlannerPersistedState,
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintRecord>({
      id: "blueprints",
      indexPath: "assets/blueprints/index.json",
      entryPath: (blueprintId) => `assets/blueprints/${blueprintId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintRecord>("blueprint"),
      // AI-REMOVED 2026-08-12:
      // Reason: 蓝图远端落地改用显式 origin，不再依赖动态 depth。
      // Trigger: 远端覆盖本地不应产生上传意图。
      // Evidence: applyBlueprintSyncEntry 已向 storage change 传递 origin。
      // Replacement: 下方 origin: "remote-sync" 写入。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // writeLocal: async (entry) => await withRemoteApply(async () => {
      //   await applyBlueprintSyncEntry(entry);
      // }),
      writeLocal: async (entry) => {
        await applyBlueprintSyncEntry(entry, { origin: "remote-sync" });
      },
      resolveConflict: resolveInteractiveConflict,
    }),
    createFullWithRevisionAdapter<BlueprintFolderRecord>({
      id: "blueprint-folders",
      indexPath: "assets/blueprint-folders/index.json",
      entryPath: (folderId) => `assets/blueprint-folders/${folderId}.json`,
      listLocal: async () => await listBlueprintSyncEntries<BlueprintFolderRecord>("folder"),
      // AI-REMOVED 2026-08-12:
      // Reason: 蓝图文件夹远端落地改用显式 origin，不再依赖动态 depth。
      // Trigger: 远端覆盖本地不应产生上传意图。
      // Evidence: applyBlueprintSyncEntry 已向 storage change 传递 origin。
      // Replacement: 下方 origin: "remote-sync" 写入。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // writeLocal: async (entry) => await withRemoteApply(async () => {
      //   await applyBlueprintSyncEntry(entry);
      // }),
      writeLocal: async (entry) => {
        await applyBlueprintSyncEntry(entry, { origin: "remote-sync" });
      },
      resolveConflict: resolveInteractiveConflict,
    }),
    ...externalSources.map((source) => createAdapterFromSource(
      source,
      resolveInteractiveConflict,
    )),
    createWorldDocumentAdapter(
      workspace,
      resolveInteractiveConflict,
      (baseId, document) => {
        if (document === null) {
          lastEditorDocumentHashByBaseId.delete(baseId);
          return;
        }
        recordWorldDocumentProjectionChange(
          lastEditorDocumentHashByBaseId,
          document,
        );
      },
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
      const provider = readActiveSyncProvider();
      if (provider === "cloudflare") {
        if (resolveBackendApiBaseUrl().trim() === "") {
          return "Cloudflare backend URL is empty";
        }
        return currentCloudflareSettings.remoteMode === "account"
          && (
            currentCloudflareSession === null
            || currentCloudflareSession.apiBaseUrl !== resolveBackendApiBaseUrl()
          )
          ? "Cloudflare account login is required"
          : null;
      }
      return settings.url.trim() === "" ? "Sync URL is empty" : null;
    },
    createRemote: (
      settings,
      onRequestActivityChange,
      requestOptions,
    ) => {
      const provider = readActiveSyncProvider();
      if (provider === "cloudflare") {
        const target = getCloudflareTarget();
        return createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: target.spaceId,
          ...(target.accessToken === null
            ? {}
            : { accessToken: target.accessToken }),
          workerClient: getCloudflareWorkerClient(),
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
    onStatusChange: (nextStatus) => {
      state.setStatus(nextStatus);
      if (
        nextStatus.currentRunReason === null
        && (nextStatus.phase === "idle" || nextStatus.phase === "error")
      ) {
        void refreshCurrentLocalRevision();
      }
    },
    onConflictDiscoveryStart: state.beginConflictDiscovery,
    resolveConflicts: state.requestConflictResolutions,
    onConflictWorkflowFinished: state.finishConflictWorkflow,
  });
  await refreshCurrentLocalRevision();
  notifyConflictDetected = service.notifyConflictDetected;

  const actions: SyncContract["actions"] = {
    updateSettings: async (patch) => {
      const wasEnabled = currentSettings.enabled;
      const merged = { ...currentSettings, ...patch };
      // enabled 由 provider + URL 派生，忽略 patch 中的 enabled
      merged.enabled = deriveEnabled(
        merged,
        resolveCloudflareTargetKey(),
        wasEnabled ? undefined : currentSettings.enabled,
      );
      currentSettings = await writeSyncConnectionSettings(merged);
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
      const provider = readActiveSyncProvider();
      if (provider === null) {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      if (provider === "webdav" && settings.url.trim() === "") {
        throw new Error("Cannot delete WebDAV data because the sync URL is empty.");
      }
      service.stop();
      try {
        const cloudflareTarget = provider === "cloudflare"
          ? getCloudflareTarget(cloudflareSettings)
          : null;
        const remote = cloudflareTarget !== null
          ? createCloudflareSyncRemote({
              apiBase: resolveBackendApiBaseUrl(),
              spaceId: cloudflareTarget.spaceId,
              ...(cloudflareTarget.accessToken === null
                ? {}
                : { accessToken: cloudflareTarget.accessToken }),
              workerClient: getCloudflareWorkerClient(),
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
            // AI-REMOVED 2026-08-19:
            // Reason: 删除设置会重新暴露隐式 default；远端清空后应直接准备新的随机空间。
            // Trigger: 用户要求删除全部远端数据后，下次启用使用新的随机空间名。
            // Evidence: 上方 resetRemote 已清除当前远端及其本地同步状态。
            // Replacement: 下方 writeCloudflareSyncSettings 写入新随机空间。
            // Risk: Low；写入失败时仍保留原空间设置，且删除 action 会失败并保持 provider 供用户重试。
            // Human Review: Required
            // AI-CORRECTION 2026-08-24: 上述随机空间替代方案已失效；删除成功后清空目标并关闭 provider。
            //
            // Original code:
            // await clearCloudflareSyncSettings();
            // AI-REMOVED 2026-08-24:
            // Reason: 删除远端数据后不能再次预生成随机目标；下次选择 Cloudflare 必须回到待配置。
            // Trigger: 用户要求匿名 Space ID 只有在明确确认后才生效，避免浪费远端空间。
            // Evidence: clearCloudflareSyncSettings 现在返回未配置空目标，provider 随后关闭。
            // Replacement: 下方 clearCloudflareSyncSettings 与内存未配置状态。
            // Risk: 用户下次启用时必须重新填写或选择账户。
            // Human Review: Required
            //
            // Original code:
            // currentCloudflareSettings = await writeCloudflareSyncSettings({
            //   spaceName: createRandomCloudflareSpaceName(),
            //   remoteMode: cloudflareSettings.remoteMode,
            // });
            await clearCloudflareSyncSettings();
            currentCloudflareSettings = {
              spaceName: "",
              remoteMode: "anonymous",
            };
          } finally {
            suppressCloudflareSettingsSync = false;
          }
        }

        // 只有远端确认 reset 成功后才关闭 provider，避免先改 provider 导致删到另一个后端。
        writeSyncProvider("none");
        currentSettings = await writeSyncConnectionSettings({
          ...currentSettings,
          enabled: false,
        });
        state.setSettings(currentSettings);
      } finally {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      }
    },
    abortCurrentTransaction: async () => {
      const provider = readActiveSyncProvider();
      if (provider !== "cloudflare") {
        return;
      }
      const settings = currentSettings;
      const cloudflareSettings = currentCloudflareSettings;
      service.stop();
      try {
        const cloudflareTarget = getCloudflareTarget(cloudflareSettings);
        const remote = createCloudflareSyncRemote({
          apiBase: resolveBackendApiBaseUrl(),
          spaceId: cloudflareTarget.spaceId,
          ...(cloudflareTarget.accessToken === null
            ? {}
            : { accessToken: cloudflareTarget.accessToken }),
          workerClient: getCloudflareWorkerClient(),
          maxConcurrentRequests: settings.maxConcurrentRequests,
        });
        try {
          await remote.abortTransaction?.();
        } finally {
          remote.dispose?.();
        }
      } finally {
        if (syncStarted && currentSettings.enabled) {
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
      disposeCloudflareWorkerClient();
      if (workspace.sync === host) {
        workspace.sync = null;
      }
    },
  };

  workspace.sync = host;
  disposers.push(subscribeToStorageChanges((event) => {
    if (event.origin === "remote-sync") {
      return;
    }

    if (event.assetType === "world-document") {
      const currentDocument = workspace.editor?.document.getSnapshot();
      if (currentDocument?.documentKey === event.assetId) {
        const nextEditorDocumentHash = createStableJsonHash(
          createWorldDocumentRemoteValue(currentDocument),
        );
        // AI-CORRECTION 2026-08-22: 同步投影按 baseId 去重；纯基地导航不产生上传意图。
        if (!recordWorldDocumentProjectionHashChange(
          lastEditorDocumentHashByBaseId,
          currentDocument.baseId,
          nextEditorDocumentHash,
        )) {
          return;
        }
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
    disposers.push(editorDocument.subscribe((
      documentSnapshot,
      changeContext?: SnapshotChangeContext,
    ) => {
      const nextEditorDocumentHash = createStableJsonHash(
        createWorldDocumentRemoteValue(documentSnapshot),
      );
      if (!editorDocumentHydrated) {
        editorDocumentHydrated = true;
        recordWorldDocumentProjectionHashChange(
          lastEditorDocumentHashByBaseId,
          documentSnapshot.baseId,
          nextEditorDocumentHash,
        );
        syncStarted = true;
        // AI-CORRECTION 2026-08-24: pending/disabled 状态不启动定时器或 startup sync；激活后由设置订阅启动。
        if (currentSettings.enabled) {
          service.start();
        }
        return;
      }

      // AI-CORRECTION 2026-08-22: 比较目标基地自身的上次投影，而不是与前一个基地比较。
      // 已存在且内容未变的基地切换只更新当前指针；新基地与真实内容变化仍会入队。
      if (!recordWorldDocumentProjectionHashChange(
        lastEditorDocumentHashByBaseId,
        documentSnapshot.baseId,
        nextEditorDocumentHash,
      )) {
        return;
      }
      if (changeContext?.origin === "remote-sync") {
        return;
      }
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
    // AI-CORRECTION 2026-08-24: 没有编辑器时也只启动已确认的同步目标。
    if (currentSettings.enabled) {
      service.start();
    }
  }
  disposers.push(subscribeToSyncConnectionSettingsChanges((settings) => {
    currentSettings = settings;
    const wasEnabled = state.settings.enabled;
    state.setSettings(settings);
    if (!settings.enabled && state.pendingConflict !== null) {
      state.cancelConflictWorkflow();
    }
    if (!settings.enabled) {
      service.stop();
      disposeCloudflareWorkerClient();
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
    if (!settings.enabled) {
      void service.syncNow("settings-change");
      return;
    }
    if (syncStarted) {
      if (!wasEnabled) {
        service.start();
      } else {
        void service.syncNow("settings-change");
      }
    }
  }));
  let derivedSettingsRefresh = Promise.resolve();
  const refreshDerivedEnabled = (): Promise<void> => {
    const refresh = async (): Promise<void> => {
      const enabled = deriveEnabled(
        currentSettings,
        resolveCloudflareTargetKey(),
      );
      if (enabled === currentSettings.enabled) {
        return;
      }
      currentSettings = await writeSyncConnectionSettings({
        ...currentSettings,
        enabled,
      });
    };
    derivedSettingsRefresh = derivedSettingsRefresh.then(refresh, refresh);
    return derivedSettingsRefresh;
  };
  disposers.push(subscribeToSyncProviderActivationChanges(() => {
    service.stop();
    disposeCloudflareWorkerClient();
    void refreshDerivedEnabled()
      .then(() => {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      })
      .catch(() => {
        // 激活状态已安全落盘；enabled 持久化失败时保持当前运行态停止，等待下次设置刷新。
      });
  }));
  disposers.push(subscribeToCloudflareSyncSettingsChanges((settings) => {
    currentCloudflareSettings = settings;
    if (!suppressCloudflareSettingsSync) {
      void refreshDerivedEnabled().catch(() => {
        // 配置写入成功但 enabled 刷新失败时不主动启动同步。
      });
    }
  }));
  disposers.push(subscribeToCloudflareOAuthSessionChanges((session) => {
    const unchanged = session?.accessToken === currentCloudflareSession?.accessToken
      && session?.spaceId === currentCloudflareSession?.spaceId;
    if (unchanged) {
      return;
    }
    currentCloudflareSession = session;
    service.stop();
    disposeCloudflareWorkerClient();
    // AI-REMOVED 2026-08-24:
    // Reason: OAuth session 的存在只表示已登录，不能替用户选择账户同步并自动重启服务。
    // Trigger: 用户要求 Cloudflare 必须明确选择账户或匿名 Space ID 后才生效。
    // Evidence: Cloudflare 对话框的“使用账号并启用”现在负责写 account 配置与 active activation。
    // Replacement: refreshDerivedEnabled；只有既有 active account 目标与新 session 匹配时恢复同步。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // void (async () => {
    //   try {
    //     if (session !== null && currentCloudflareSettings.remoteMode === "anonymous") {
    //       suppressCloudflareSettingsSync = true;
    //       try {
    //         const accountSettings: CloudflareSyncSettings = {
    //           ...currentCloudflareSettings,
    //           remoteMode: "account",
    //         };
    //         currentCloudflareSettings = accountSettings;
    //         await writeCloudflareSyncSettings(accountSettings);
    //       } finally {
    //         suppressCloudflareSettingsSync = false;
    //       }
    //     }
    //   } catch {
    //     // 内存态仍保持 account，禁止持久化失败时回退到匿名空间。
    //   } finally {
    //     if (syncStarted) {
    //       service.start();
    //     }
    //   }
    // })();
    void refreshDerivedEnabled()
      .then(() => {
        if (syncStarted && currentSettings.enabled) {
          service.start();
        }
      })
      .catch(() => {
        // session 变化后默认保持停止；后续显式配置或 focus 会再次刷新。
      });
  }));
  if (typeof document !== "undefined") {
    const handleVisibilityChange = () => {
      if (!syncStarted || !currentSettings.enabled) {
        return;
      }
      if (document.visibilityState === "visible") {
        void service.syncNow("foreground");
        return;
      }
      if (document.visibilityState === "hidden") {
        // 切后台时若本地变更仍处于 5s 空闲去抖期，立即启动后台上传，
        // 避免主线程定时器被后台节流推迟。
        service.flushPendingChanges();
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
  // AI-REMOVED 2026-08-12:
  // Reason: SyncAssetSource.writeLocal 实现已负责以 remote-sync origin 写入，适配器不再注入动态抑制器。
  // Trigger: 远端落地与通知回调的时序不应影响是否上传。
  // Evidence: createModuleBalancingSyncSources 的全部写入均显式传递 remote-sync。
  // Replacement: sharedOptions.writeLocal 直接调用 source.writeLocal。
  // Risk: 新的 SyncAssetSource 实现必须遵守远端落地不发出 local 通知的 contract。
  // Human Review: Required
  //
  // Original code:
  // withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
  resolveConflict: ResolveInteractiveConflict,
): SyncAdapter {
  const sharedOptions = {
    id: source.id,
    indexPath: source.indexPath,
    listLocal: source.listLocal,
    // AI-REMOVED 2026-08-12:
    // Reason: 删除基于调用栈深度的远端写入抑制。
    // Trigger: 异步通知可以逃出 withRemoteApply 作用域。
    // Evidence: 资产 source 的写入路径已用 remote-sync origin 标记。
    // Replacement: 下方直接 source.writeLocal。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // writeLocal: async (entry: SyncAssetEntry) => await withRemoteApply(async () => {
    //   await source.writeLocal(entry);
    // }),
    writeLocal: async (entry: SyncAssetEntry) => {
      await source.writeLocal(entry);
    },
    isRemoteVersionUnsupported: source.isRemoteVersionUnsupported,
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
  onSynchronizedDocumentChange: (
    baseId: string,
    document: WorldDocument | null,
  ) => void,
  // AI-REMOVED 2026-08-12:
  // Reason: editor snapshot 现在直接携带 remote-sync origin。
  // Trigger: 当前画布远端覆盖不应依赖 withRemoteApply 释放时机。
  // Evidence: applySynchronizedDocument 使用 EditorDocumentWriteMode "remote-sync"。
  // Replacement: writeLocal 直接持久化并应用同步文档。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // withRemoteApply: <TValue>(task: () => Promise<TValue>) => Promise<TValue>,
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
          value: createWorldDocumentRemoteValue(currentDocument),
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
            value: createWorldDocumentRemoteValue(document),
            deletedAt: null,
          }]
      );
    },
    // AI-REMOVED 2026-08-12:
    // Reason: 文档远端落地不再使用动态 depth 抑制订阅。
    // Trigger: Cloudflare use-remote 冲突解决后会误排入本地上传。
    // Evidence: editor document snapshot 的 remote-sync origin 在变更产生时即固定。
    // Replacement: 下方直接写入，sync-host 订阅者按 origin 过滤。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // writeLocal: async (entry) => await withRemoteApply(async () => {
    writeLocal: async (entry) => {
      const editor = workspace.editor;
      const currentDocument = editor?.document.getSnapshot();
      // AI-CORRECTION 2026-08-14: writeLocal 支持远端墓碑（deletedAt 非空）：
      // 删除该基地（entry.id 为远端资产 baseId）在本机的全部文档副本。
      // 触发场景：远端墓碑下载、以及冲突弹框中上传条目被决议为“用远端”（放弃本地新增）。
      // 原实现忽略 deletedAt，墓碑落地只推进 touch 不删本地，导致“已同步但本地仍在”的假象。
      if (entry.deletedAt !== null) {
        const documents = await listWorldDocuments();
        for (const document of documents) {
          if (document.baseId === entry.id) {
            await deleteWorldDocument(document.documentKey);
          }
        }
        onSynchronizedDocumentChange(entry.id, null);
        return;
      }

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
      onSynchronizedDocumentChange(entry.id, localValue);
      if (
        editor !== null
        && currentDocument?.baseId === entry.id
      ) {
        editor.actions.applySynchronizedDocument(localValue);
      }
    },
    // AI-REMOVED 2026-08-12:
    // Reason: 上方 writeLocal 已不再由 withRemoteApply 包裹。
    // Trigger: 改用显式 remote-sync origin。
    // Evidence: writeLocal 的完整旧起始行已在上方审计记录保留。
    // Replacement: 上方 writeLocal 实现。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // }),
    normalizeRemote: (value) => {
      const document = normalizeWorldDocument(value);

      return document === null
        ? null
        : createWorldDocumentRemoteValue(document);
    },
    resolveConflict,
  });
}

export function createWorldDocumentRemoteValue(
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

/**
 * 记录基地文档的同步投影并返回内容是否相对该基地上次记录发生变化。
 * 不同基地互不比较，因此纯导航不会制造本地上传意图。
 */
export function recordWorldDocumentProjectionChange(
  hashesByBaseId: Map<string, string>,
  document: WorldDocument,
): boolean {
  return recordWorldDocumentProjectionHashChange(
    hashesByBaseId,
    document.baseId,
    createStableJsonHash(createWorldDocumentRemoteValue(document)),
  );
}

function recordWorldDocumentProjectionHashChange(
  hashesByBaseId: Map<string, string>,
  baseId: string,
  nextHash: string,
): boolean {
  const changed = hashesByBaseId.get(baseId) !== nextHash;
  hashesByBaseId.set(baseId, nextHash);
  return changed;
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
