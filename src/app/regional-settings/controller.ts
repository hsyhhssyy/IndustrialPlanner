import { makeAutoObservable, runInAction } from "mobx";

import type { RegistryContract } from "@/domain/registry/registry-contract";
// AI-REMOVED 2026-09-25:
// Reason: 旧 App 关系动作已归档，不再依赖文档契约。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: Editor。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

// AI-REMOVED 2026-09-25:
// Reason: 旧 App 关系动作已归档，不再依赖文档契约。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: Editor。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
// import type { WorldDocument } from "@/domain/document/world-document";

import type { SyncAssetEntry, SyncAssetSource } from "@/domain/sync";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
// AI-REMOVED 2026-09-25:
// Reason: App 关系动作已归档。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: Editor。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
// import {
//   findRegionalDarkPipeLinkForEndpoint,
//   findDarkPipeSlotLinkForEntity,
//   prepareDarkPipeLinkDocument,
//   resolveDarkPipeRole,
//   // AI-REMOVED 2026-09-23:
//   // Reason: 覆盖判定必须包含暗管与仓库等所有本地槽位关系，不限暗管对暗管。
//   // Trigger: 用户要求任何影响链接数据的编辑覆盖停用的跨基地关系。
//   // Evidence: createWarehouseSlotLink 只改 slotLinks，可能不改实体 config。
//   // Replacement: bindInactiveDarkPipeLinkEdits 内比较当前端点涉及的 slotLinks。
//   // Risk: Low
//   // Human Review: Required
//   // Original code:
//   // findDarkPipeSlotLinkForEntity,
//   type RegionalDarkPipeEndpoint,
//   type RegionalDarkPipeLink,
// } from "@/shared/dark-pipe-link";
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: None；App 仅保留旧资产迁移输入。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
// import type { RegionalDarkPipeLink } from "@/shared/dark-pipe-link";

import {
  cloneRegionalSettingsAsset,
  createDefaultRegionalSettingsAsset,
  normalizeRegionalPerMinute,
  normalizeRegionalSettingsAsset,
  REGIONAL_SETTINGS_ASSET_ID,
  resolveRegionalResourceSettings,
  type RegionalResourceSetting,
  type RegionalResourceSupplyMode,
  type RegionalSettingsAsset,
} from "./model";
import {
  deleteRegionalSettingsAsset,
  loadRegionalSettingsAsset,
  saveRegionalSettingsAsset,
// AI-REMOVED 2026-09-25:
// Reason: App 不再保存关系。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: Editor 文档事务。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
//   saveRegionalDarkPipeConnection,

// AI-REMOVED 2026-09-25:
// Reason: App 不再保存关系。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: Editor 文档事务。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
//   emitRegionalDarkPipeConnectionChange,

} from "./storage";

export class RegionalSettingsController {
  public asset: RegionalSettingsAsset = createDefaultRegionalSettingsAsset();
  public hydrated = false;
  public hasPersistedAsset = false;
  public darkPipeLinkSaving = false;
  public darkPipeLinkSaveFailed = false;

  private persistenceQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly registry: RegistryContract) {
    makeAutoObservable<this, "registry" | "persistenceQueue">(this, {
      registry: false,
      persistenceQueue: false,
    }, { autoBind: true });
  }

  public get multiBaseEnabled(): boolean {
    return this.asset.multiBaseEnabled;
  }

// AI-REMOVED 2026-09-25:
// Reason: App 不再提供关系权威。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: EditorQuery.getRegionalDarkPipeLinks。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
//   public get darkPipeLinks(): readonly RegionalDarkPipeLink[] {
//     return this.asset.darkPipeLinks;
//   }
//
  public async hydrate(): Promise<void> {
    const stored = await loadRegionalSettingsAsset(this.registry.itemDefinitions);
    runInAction(() => {
      this.asset = stored ?? createDefaultRegionalSettingsAsset();
      this.hasPersistedAsset = stored !== null;
      this.hydrated = true;
    });
  }

  public getRegionResources(regionTag: string): readonly RegionalResourceSetting[] {
    return resolveRegionalResourceSettings(
      this.asset,
      regionTag,
      this.registry.itemDefinitions,
    );
  }

// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/editor/dark-pipe-link-lifecycle.ts 和 EditorQuery.getRegionalDarkPipeLinks。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   public getRegionalDarkPipeLinks(regionTag: string): readonly RegionalDarkPipeLink[] {
//     const baseIds = new Set(
//       this.registry.baseDefinitions
//         .filter((definition) => definition.tag === regionTag)
//         .map((definition) => definition.id),
//     );
//     return this.asset.darkPipeLinks.filter((link) =>
//       baseIds.has(link.inlet.baseId) && baseIds.has(link.outlet.baseId)
//     );
//   }

// AI-REMOVED 2026-09-25:
// Reason: 删除 App 建链、断链和文档监听职责，避免继续写入旧资产关系。
// Trigger: REQ-038 文档权威与 Editor 统一生命周期。
// Evidence: 建链、入口断开与后台出口历史已接入 Editor。
// Replacement: src/editor/actions/dark-pipe-link-action.ts 与 dark-pipe-link-lifecycle.ts。
// Risk: 旧资产迁移与关闭模式编辑需要回归。
// Human Review: Required
// Original code:
//   public findDarkPipeLink(endpoint: RegionalDarkPipeEndpoint): RegionalDarkPipeLink | null {
//     return findRegionalDarkPipeLinkForEndpoint(this.asset.darkPipeLinks, endpoint);
//   }
//
//   public bindInactiveDarkPipeLinkEdits(
//     editor: EditorContract,
//     isMultiBaseEnabled: () => boolean,
//   ): () => void {
//     let previousDocument = editor.document.getSnapshot();
//     return editor.document.subscribe((nextDocument) => {
//       const priorDocument = previousDocument;
//       previousDocument = nextDocument;
//       if (priorDocument.documentKey !== nextDocument.documentKey || isMultiBaseEnabled()) return;
//
//       for (const link of this.darkPipeLinks) {
//         const endpoint = link.inlet.baseId === nextDocument.baseId
//           ? link.inlet
//           : link.outlet.baseId === nextDocument.baseId
//             ? link.outlet
//             : null;
//         if (endpoint === null) continue;
//         const before = priorDocument.entities[endpoint.entityId];
//         const after = nextDocument.entities[endpoint.entityId];
//         const touchesEndpoint = (slotLink: typeof nextDocument.slotLinks[number]) =>
//           slotLink.source.entityId === endpoint.entityId
//           || slotLink.target.entityId === endpoint.entityId;
//         if (
//           before !== undefined
//           && (
//             after === undefined
//             || JSON.stringify(before.config) !== JSON.stringify(after.config)
//             // AI-REMOVED 2026-09-23:
//             // Reason: 只识别暗管对暗管链接会漏掉仓库槽位链接编辑。
//             // Trigger: 用户要求任何影响链接数据的编辑覆盖停用的跨基地关系。
//             // Evidence: createWarehouseSlotLink 不一定修改实体 config。
//             // Replacement: 下方比较端点关联的全部 slotLinks。
//             // Risk: Low
//             // Human Review: Required
//             // Original code:
//             // || findDarkPipeSlotLinkForEntity(nextDocument, endpoint.entityId) !== null
//             || JSON.stringify(priorDocument.slotLinks.filter(touchesEndpoint))
//               !== JSON.stringify(nextDocument.slotLinks.filter(touchesEndpoint))
//           )
//         ) {
//           this.removeDarkPipeLink(link.id);
//         }
//       }
//     });
//   }
//
//   public async addDarkPipeLink(link: RegionalDarkPipeLink, options: {
//     readonly editor: EditorContract;
//     readonly documents: readonly WorldDocument[];
//     readonly isCurrent: () => boolean;
//   }): Promise<boolean> {
//     if (this.darkPipeLinkSaving) return false;
//     this.darkPipeLinkSaving = true;
//     this.darkPipeLinkSaveFailed = false;
//     const commit = this.persistenceQueue.catch(() => undefined).then(async () => {
//       const inletBase = this.registry.baseDefinitions.find(
//         (definition) => definition.id === link.inlet.baseId,
//       );
//       const outletBase = this.registry.baseDefinitions.find(
//         (definition) => definition.id === link.outlet.baseId,
//       );
//       if (
//         inletBase === undefined
//         || outletBase === undefined
//         || inletBase.id === outletBase.id
//         || inletBase.tag !== outletBase.tag
//         || this.asset.darkPipeLinks.some((candidate) => candidate.id === link.id)
//         || this.findDarkPipeLink(link.inlet) !== null
//         || this.findDarkPipeLink(link.outlet) !== null
//         || !options.isCurrent()
//       ) {
//         return false;
//       }
//       const documents = options.documents.map((before) => ({
//         before,
//         after: prepareDarkPipeLinkDocument(before, [link.inlet, link.outlet]
//           .filter((endpoint) => endpoint.baseId === before.baseId)
//           .map((endpoint) => endpoint.entityId)),
//       }));
//       for (const [role, endpoint] of [["inlet", link.inlet], ["outlet", link.outlet]] as const) {
//         const document = documents.find(({ before }) => before.baseId === endpoint.baseId)?.before;
//         const entity = document?.entities[endpoint.entityId];
//         if (document === undefined || entity === undefined
//           || resolveDarkPipeRole(entity.definitionId) !== role
//           || findDarkPipeSlotLinkForEntity(document, entity.id) !== null) return false;
//       }
//       const previousAsset = this.asset;
//       const nextAsset = {
//         ...cloneRegionalSettingsAsset(this.asset),
//         darkPipeLinks: [...this.asset.darkPipeLinks, link]
//           .sort((left, right) => left.id.localeCompare(right.id)),
//       };
//       const currentDocument = options.editor.document.getSnapshot();
//       const cancellation = new AbortController();
//       const unsubscribeDocument = options.editor.document.subscribe((document) => {
//         if (document !== currentDocument) cancellation.abort();
//       });
//       const unsubscribeAsset = reaction(
//         () => this.asset === previousAsset && options.isCurrent(),
//         (current) => { if (!current) cancellation.abort(); },
//       );
//       let publishing = false;
//       const unsubscribeStorage = subscribeToStorageChanges((event) => {
//         if (!publishing && event.assetType === "world-document"
//           && documents.some(({ before }) => before.documentKey === event.assetId)) cancellation.abort();
//       });
//       try {
//         const saved = await saveRegionalDarkPipeConnection({
//           previousAsset, nextAsset, documents, itemDefinitions: this.registry.itemDefinitions,
//           signal: cancellation.signal,
//         });
//         if (!saved) return false;
//         publishing = true;
//         unsubscribeDocument();
//         unsubscribeAsset();
//         runInAction(() => {
//           this.asset = nextAsset;
//           this.hasPersistedAsset = true;
//           const current = documents.find(({ before }) => before.documentKey === currentDocument.documentKey);
//           if (current !== undefined && current.before !== current.after) {
//             options.editor.actions.applySynchronizedDocument(current.after);
//           }
//         });
//         emitRegionalDarkPipeConnectionChange(documents.filter(({ before, after }) => before !== after).map(({ after }) => after));
//         return true;
//       } finally {
//         unsubscribeDocument();
//         unsubscribeAsset();
//         unsubscribeStorage();
//       }
//     });
//     this.persistenceQueue = commit.then(() => undefined, () => undefined);
//     let saved = false;
//     try {
//       saved = await commit;
//       return saved;
//     } finally {
//       runInAction(() => {
//         this.darkPipeLinkSaving = false;
//         this.darkPipeLinkSaveFailed = !saved;
//       });
//     }
//   }
//
//   public removeDarkPipeLink(linkId: string): boolean {
//     const darkPipeLinks = this.asset.darkPipeLinks.filter((link) => link.id !== linkId);
//     if (darkPipeLinks.length === this.asset.darkPipeLinks.length) {
//       return false;
//     }
//     this.asset = {
//       ...cloneRegionalSettingsAsset(this.asset),
//       darkPipeLinks,
//     };
//     this.queuePersist();
//     return true;
//   }
//
// AI-REMOVED 2026-09-25:
// Reason: 跨基地关系已迁入出口世界文档，移除 App 关系权威的装配和接口。
// Trigger: REQ-038 及用户授权修改 main。
// Evidence: Editor 文档集合与 listDocumentRegionalDarkPipeLinks 已统一提供当前关系。
// Replacement: src/editor/dark-pipe-link-lifecycle.ts 和 EditorQuery.getRegionalDarkPipeLinks。
// Risk: Legacy 单基地和区域启动保护需回归。
// Human Review: Required
// Original code:
//   public pruneDarkPipeLinksForBase(
//     baseId: string,
//     existingEntityIds: ReadonlySet<string>,
//   ): void {
//     const darkPipeLinks = this.asset.darkPipeLinks.filter((link) => {
//       if (link.inlet.baseId === baseId && !existingEntityIds.has(link.inlet.entityId)) {
//         return false;
//       }
//       if (link.outlet.baseId === baseId && !existingEntityIds.has(link.outlet.entityId)) {
//         return false;
//       }
//       return true;
//     });
//     if (darkPipeLinks.length === this.asset.darkPipeLinks.length) {
//       return;
//     }
//     this.asset = {
//       ...cloneRegionalSettingsAsset(this.asset),
//       darkPipeLinks,
//     };
//     this.queuePersist();
//   }

  public setMultiBaseEnabled(enabled: boolean): void {
    if (this.asset.multiBaseEnabled === enabled) {
      return;
    }
    this.asset = {
      ...cloneRegionalSettingsAsset(this.asset),
      multiBaseEnabled: enabled,
    };
    this.queuePersist();
  }

  public setRegionResources(
    regionTag: string,
    resources: readonly RegionalResourceSetting[],
  ): void {
    const next = cloneRegionalSettingsAsset(this.asset);
    const normalized = normalizeRegionalSettingsAsset({
      ...next,
      regions: {
        ...next.regions,
        [regionTag]: { resources },
      },
    }, this.registry.itemDefinitions);
    if (normalized === null) {
      return;
    }
    this.asset = normalized;
    this.queuePersist();
  }

  public applyInfiniteProfile(regionTag: string): void {
    const next = cloneRegionalSettingsAsset(this.asset);
    const regions = { ...next.regions };
    delete regions[regionTag];
    this.asset = { ...next, regions };
    this.queuePersist();
  }

  public upsertResource(
    regionTag: string,
    itemId: string,
    patch: Partial<Pick<RegionalResourceSetting, "mode" | "perMinute">> = {},
  ): void {
    const resources = this.getRegionResources(regionTag).map((resource) => ({ ...resource }));
    const existing = resources.find((resource) => resource.itemId === itemId);
    if (existing === undefined) {
      resources.push({
        itemId,
        mode: patch.mode ?? "infinite",
        perMinute: normalizeRegionalPerMinute(patch.perMinute ?? 10),
      });
    } else {
      const index = resources.indexOf(existing);
      resources[index] = {
        itemId,
        mode: patch.mode ?? existing.mode,
        perMinute: normalizeRegionalPerMinute(patch.perMinute ?? existing.perMinute),
      };
    }
    this.setRegionResources(regionTag, resources);
  }

  public setResourceMode(
    regionTag: string,
    itemId: string,
    mode: RegionalResourceSupplyMode,
  ): void {
    this.upsertResource(regionTag, itemId, { mode });
  }

  public removeResource(regionTag: string, itemId: string): void {
    this.setRegionResources(
      regionTag,
      this.getRegionResources(regionTag).filter((resource) => resource.itemId !== itemId),
    );
  }

  public createSyncSource(): SyncAssetSource {
    return {
      id: "regional-settings",
      mode: "full-with-revision",
      indexPath: "assets/regional-settings/index.json",
      remotePath: () => "assets/regional-settings/default.json",
      listLocal: async () => {
        const stored = await loadRegionalSettingsAsset(this.registry.itemDefinitions);
        return stored === null
          ? []
          : [{ id: REGIONAL_SETTINGS_ASSET_ID, value: stored, deletedAt: null }];
      },
      writeLocal: async (entry) => {
        await this.applySyncEntry(entry as SyncAssetEntry<RegionalSettingsAsset>);
      },
      normalizeRemote: (value) => normalizeRegionalSettingsAsset(
        value,
        this.registry.itemDefinitions,
      ),
      subscribe: (listener) => subscribeToStorageChanges((event) => {
        if (event.origin === "local" && event.assetType === "regional-settings") {
          listener();
        }
      }),
    };
  }

  private async applySyncEntry(entry: SyncAssetEntry<RegionalSettingsAsset>): Promise<void> {
    if (entry.deletedAt !== null) {
      await deleteRegionalSettingsAsset({ origin: "remote-sync" });
      runInAction(() => {
        this.asset = createDefaultRegionalSettingsAsset();
        this.hasPersistedAsset = false;
        this.hydrated = true;
      });
      return;
    }

    const normalized = normalizeRegionalSettingsAsset(
      entry.value,
      this.registry.itemDefinitions,
    );
    if (normalized === null) {
      throw new Error("Remote regional settings asset is invalid.");
    }
    await saveRegionalSettingsAsset(normalized, { origin: "remote-sync" });
    runInAction(() => {
      this.asset = normalized;
      this.hasPersistedAsset = true;
      this.hydrated = true;
    });
  }

  private queuePersist(): void {
    const snapshot = cloneRegionalSettingsAsset(this.asset);
    this.hasPersistedAsset = true;
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(async () => {
        await saveRegionalSettingsAsset(snapshot, { origin: "local" });
      });
  }
}
