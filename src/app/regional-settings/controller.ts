import { makeAutoObservable, runInAction } from "mobx";

import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { SyncAssetEntry, SyncAssetSource } from "@/domain/sync";
import { subscribeToStorageChanges } from "@/shared/storage/storage-change-event";
import {
  findRegionalDarkPipeLinkForEndpoint,
  // AI-REMOVED 2026-09-23:
  // Reason: 覆盖判定必须包含暗管与仓库等所有本地槽位关系，不限暗管对暗管。
  // Trigger: 用户要求任何影响链接数据的编辑覆盖停用的跨基地关系。
  // Evidence: createWarehouseSlotLink 只改 slotLinks，可能不改实体 config。
  // Replacement: bindInactiveDarkPipeLinkEdits 内比较当前端点涉及的 slotLinks。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // findDarkPipeSlotLinkForEntity,
  type RegionalDarkPipeEndpoint,
  type RegionalDarkPipeLink,
} from "@/shared/dark-pipe-link";
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
} from "./storage";

export class RegionalSettingsController {
  public asset: RegionalSettingsAsset = createDefaultRegionalSettingsAsset();
  public hydrated = false;
  public hasPersistedAsset = false;

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

  public get darkPipeLinks(): readonly RegionalDarkPipeLink[] {
    return this.asset.darkPipeLinks;
  }

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

  public getRegionalDarkPipeLinks(regionTag: string): readonly RegionalDarkPipeLink[] {
    const baseIds = new Set(
      this.registry.baseDefinitions
        .filter((definition) => definition.tag === regionTag)
        .map((definition) => definition.id),
    );
    return this.asset.darkPipeLinks.filter((link) =>
      baseIds.has(link.inlet.baseId) && baseIds.has(link.outlet.baseId)
    );
  }

  public findDarkPipeLink(endpoint: RegionalDarkPipeEndpoint): RegionalDarkPipeLink | null {
    return findRegionalDarkPipeLinkForEndpoint(this.asset.darkPipeLinks, endpoint);
  }

  public bindInactiveDarkPipeLinkEdits(
    editor: EditorContract,
    isMultiBaseEnabled: () => boolean,
  ): () => void {
    let previousDocument = editor.document.getSnapshot();
    return editor.document.subscribe((nextDocument) => {
      const priorDocument = previousDocument;
      previousDocument = nextDocument;
      if (priorDocument.documentKey !== nextDocument.documentKey || isMultiBaseEnabled()) return;

      for (const link of this.darkPipeLinks) {
        const endpoint = link.inlet.baseId === nextDocument.baseId
          ? link.inlet
          : link.outlet.baseId === nextDocument.baseId
            ? link.outlet
            : null;
        if (endpoint === null) continue;
        const before = priorDocument.entities[endpoint.entityId];
        const after = nextDocument.entities[endpoint.entityId];
        const touchesEndpoint = (slotLink: typeof nextDocument.slotLinks[number]) =>
          slotLink.source.entityId === endpoint.entityId
          || slotLink.target.entityId === endpoint.entityId;
        if (
          before !== undefined
          && (
            after === undefined
            || JSON.stringify(before.config) !== JSON.stringify(after.config)
            // AI-REMOVED 2026-09-23:
            // Reason: 只识别暗管对暗管链接会漏掉仓库槽位链接编辑。
            // Trigger: 用户要求任何影响链接数据的编辑覆盖停用的跨基地关系。
            // Evidence: createWarehouseSlotLink 不一定修改实体 config。
            // Replacement: 下方比较端点关联的全部 slotLinks。
            // Risk: Low
            // Human Review: Required
            // Original code:
            // || findDarkPipeSlotLinkForEntity(nextDocument, endpoint.entityId) !== null
            || JSON.stringify(priorDocument.slotLinks.filter(touchesEndpoint))
              !== JSON.stringify(nextDocument.slotLinks.filter(touchesEndpoint))
          )
        ) {
          this.removeDarkPipeLink(link.id);
        }
      }
    });
  }

  public addDarkPipeLink(link: RegionalDarkPipeLink): boolean {
    const inletBase = this.registry.baseDefinitions.find(
      (definition) => definition.id === link.inlet.baseId,
    );
    const outletBase = this.registry.baseDefinitions.find(
      (definition) => definition.id === link.outlet.baseId,
    );
    if (
      inletBase === undefined
      || outletBase === undefined
      || inletBase.id === outletBase.id
      || inletBase.tag !== outletBase.tag
      || this.asset.darkPipeLinks.some((candidate) => candidate.id === link.id)
      || this.findDarkPipeLink(link.inlet) !== null
      || this.findDarkPipeLink(link.outlet) !== null
    ) {
      return false;
    }
    this.asset = {
      ...cloneRegionalSettingsAsset(this.asset),
      darkPipeLinks: [...this.asset.darkPipeLinks, link]
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
    this.queuePersist();
    return true;
  }

  public removeDarkPipeLink(linkId: string): boolean {
    const darkPipeLinks = this.asset.darkPipeLinks.filter((link) => link.id !== linkId);
    if (darkPipeLinks.length === this.asset.darkPipeLinks.length) {
      return false;
    }
    this.asset = {
      ...cloneRegionalSettingsAsset(this.asset),
      darkPipeLinks,
    };
    this.queuePersist();
    return true;
  }

  public pruneDarkPipeLinksForBase(
    baseId: string,
    existingEntityIds: ReadonlySet<string>,
  ): void {
    const darkPipeLinks = this.asset.darkPipeLinks.filter((link) => {
      if (link.inlet.baseId === baseId && !existingEntityIds.has(link.inlet.entityId)) {
        return false;
      }
      if (link.outlet.baseId === baseId && !existingEntityIds.has(link.outlet.entityId)) {
        return false;
      }
      return true;
    });
    if (darkPipeLinks.length === this.asset.darkPipeLinks.length) {
      return;
    }
    this.asset = {
      ...cloneRegionalSettingsAsset(this.asset),
      darkPipeLinks,
    };
    this.queuePersist();
  }

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
