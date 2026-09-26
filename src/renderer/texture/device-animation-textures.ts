import { Rectangle, Texture } from "pixi.js";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  getDeviceSpriteAnimationSignature,
  normalizeDeviceSpriteAnimationDefinition,
  resolveDeviceSpriteAnimationFrame,
  resolveDeviceSpriteAnimationGrid,
  validateDeviceSpriteAnimationId,
  type DeviceSpriteAnimationManifestPage,
  type DeviceSpriteAnimationPhase,
  type NormalizedDeviceSpriteAnimationDefinition,
} from "@/shared/device-sprite-animation";

// AI-REMOVED 2026-09-13:
// Reason: 取消软预算，不再选择性保留动画页。
// Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
// Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
// Replacement: DeviceAnimationTextureCache.reconcileResidency
// Risk: 全量驻留提高内存与显存占用。
// Human Review: Required
// Original code:
// export const DEFAULT_ANIMATION_RESIDENCY_BYTES = 512 * 1024 * 1024;
const OFFSCREEN_GRACE_MS = 20_000;
const PAGE_QUEUE_INTERVAL_MS = 16;

interface DeviceAnimationPageRuntime {
  readonly phase: DeviceSpriteAnimationPhase;
  readonly pageIndex: number;
  readonly manifest: DeviceSpriteAnimationManifestPage;
  readonly url: string;
  readonly resolution: number;
  readonly owners: Set<symbol>;
  readonly estimatedBytes: number;
  warm: boolean;
  failed: boolean;
  texture: Texture | null;
  frames: readonly Texture[] | null;
  loadPromise: Promise<boolean> | null;
  unloadPromise: Promise<void> | null;
}

interface DeviceAnimationAsset {
  readonly definition: NormalizedDeviceSpriteAnimationDefinition;
  readonly mask: Texture;
  readonly maskUrl: string;
  readonly pages: Readonly<Record<DeviceSpriteAnimationPhase, readonly DeviceAnimationPageRuntime[]>>;
  readonly spriteId: string;
  readonly visibleOwners: Map<symbol, DeviceSpriteAnimationPhase>;
  lastVisibleAt: number;
  unavailable: boolean;
}

export interface DeviceAnimationTextureStats {
  readonly activeSessions: number;
  readonly loadingPages: number;
  readonly residentDecodedBytes: number;
  readonly residentMasks: number;
  readonly residentPages: number;
  readonly residency: {
    // AI-REMOVED 2026-09-13:
    // Reason: 预算诊断不再对应当前的全量驻留规则。
    // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
    // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
    // Replacement: mode / offscreenGraceMs / retainedSetBytes
    // Risk: 全量驻留提高内存与显存占用。
    // Human Review: Required
    // Original code:
    // readonly budgetBytes: number;
    // readonly reservedBytes: number;
    // readonly overBudgetBytes: number;
    readonly mode: "full-set";
    readonly offscreenGraceMs: number;
    readonly retainedSetBytes: number;
    readonly retainedAssets: number;
    readonly visibleSessions: number;
    readonly visibleAssets: number;
    readonly queuedPages: number;
    readonly totalsSinceCreation: Readonly<Record<string, number>>;
    readonly assets: readonly {
      readonly spriteId: string;
      readonly visibleInstances: number;
      readonly totalSetBytes: number;
      readonly selectedPages: number;
      readonly totalPages: number;
      readonly totalFrames: number;
      readonly preparedFrames: number;
      readonly failedPages: number;
      readonly graceRemainingMs: number | null;
      readonly preparedPages: number;
    }[];
    readonly omittedAssets: number;
  };
}

export interface DeviceAnimationTextures {
  // AI-REMOVED 2026-09-06:
  // Reason: 全片段 Texture[] 会强制同时解码并常驻全部分页，反应池约占 2.13GiB。
  // Trigger: 用户要求保留 896px、665 帧和 30 FPS 后实测分页内存。
  // Evidence: 4×4 页面单页约 49MiB；会话只需当前页和相邻预取页。
  // Replacement: hasFrame / prepareFrame / commitFrame 的页级会话接口。
  // Risk: 慢网下在下一页就绪前暂停视觉时间，避免跳帧或空白。
  // Human Review: Required
  //
  // Original code:
  // readonly clips: Readonly<Record<DeviceSpriteAnimationPhase, readonly Texture[]>>;
  readonly definition: NormalizedDeviceSpriteAnimationDefinition;
  readonly mask: Texture;
  readonly frameWidth: number;
  readonly frameHeight: number;
  hasFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): boolean;
  prepareFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): Promise<Texture | null>;
  commitFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): Texture | null;
  setVisible(visible: boolean): void;
  destroy(): void;
}

class DeviceAnimationTextureSession implements DeviceAnimationTextures {
  public readonly definition: NormalizedDeviceSpriteAnimationDefinition;
  public readonly mask: Texture;
  public readonly frameWidth: number;
  public readonly frameHeight: number;

  private readonly owner = Symbol("device-animation-texture-session");
  private readonly retainedPages = new Set<DeviceAnimationPageRuntime>();
  private destroyed = false;
  // 未报告可见性时，首次请求帧视为激活；显式隐藏后禁止帧请求重新激活会话。
  private visible: boolean | null = null;
  private phase: DeviceSpriteAnimationPhase;

  public constructor(
    private readonly cache: DeviceAnimationTextureCache,
    private readonly asset: DeviceAnimationAsset,
    private readonly onDestroy: () => void,
  ) {
    this.definition = asset.definition;
    this.mask = asset.mask;
    this.frameWidth = asset.definition.frameWidth;
    this.frameHeight = asset.definition.frameHeight;
    this.phase = asset.definition.playback.fallbackClip;
  }

  public hasFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): boolean {
    return this.resolveFrame(phase, frameIndex) !== null;
  }

  public async prepareFrame(
    phase: DeviceSpriteAnimationPhase,
    frameIndex: number,
  ): Promise<Texture | null> {
    if (this.destroyed || this.asset.unavailable) {
      return null;
    }
    if (this.visible === false) return null;
    if (this.visible === null) this.setVisible(true);
    this.updatePhase(phase);
    const pages = this.resolveRetainedPages(phase, frameIndex);
    const currentPage = pages[0];
    if (currentPage === undefined) {
      return null;
    }
    const preparations = pages.map((page) => this.cache.retainPage(page, this.owner));
    for (const page of pages) {
      this.retainedPages.add(page);
    }
    const currentReady = await preparations[0];
    if (this.destroyed || !currentReady || this.asset.unavailable) {
      return null;
    }
    return this.resolveFrame(phase, frameIndex);
  }

  public commitFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): Texture | null {
    if (this.destroyed || this.asset.unavailable) {
      return null;
    }
    this.updatePhase(phase);
    const texture = this.resolveFrame(phase, frameIndex);
    this.cache.recordFrameAccess(texture !== null);
    if (texture === null) {
      return null;
    }
    if (this.visible !== true) return texture;
    const nextPages = new Set(this.resolveRetainedPages(phase, frameIndex));
    for (const page of nextPages) {
      void this.cache.retainPage(page, this.owner);
    }
    const releasedPages = [...this.retainedPages].filter((page) => !nextPages.has(page));
    this.retainedPages.clear();
    for (const page of nextPages) {
      this.retainedPages.add(page);
    }
    queueMicrotask(() => {
      for (const page of releasedPages) {
        if (!this.retainedPages.has(page)) this.cache.releasePage(page, this.owner);
      }
    });
    return texture;
  }

  public setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    this.cache.setSessionVisibility(this.asset, this.owner, visible ? this.phase : null);
    if (!visible) {
      for (const page of this.retainedPages) this.cache.releasePage(page, this.owner);
      this.retainedPages.clear();
    }
  }

  private updatePhase(phase: DeviceSpriteAnimationPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (this.visible) this.cache.setSessionVisibility(this.asset, this.owner, phase);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.setVisible(false);
    this.destroyed = true;
    for (const page of this.retainedPages) {
      this.cache.releasePage(page, this.owner);
    }
    this.retainedPages.clear();
    this.onDestroy();
  }

  private resolveFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): Texture | null {
    const resolved = resolveDeviceSpriteAnimationFrame(this.definition, phase, frameIndex);
    return this.asset.pages[phase]?.[resolved.pageIndex]?.frames?.[resolved.localFrameIndex] ?? null;
  }

  private resolveRetainedPages(
    phase: DeviceSpriteAnimationPhase,
    frameIndex: number,
  ): readonly DeviceAnimationPageRuntime[] {
    const resolved = resolveDeviceSpriteAnimationFrame(this.definition, phase, frameIndex);
    const phasePages = this.asset.pages[phase];
    const current = phasePages?.[resolved.pageIndex];
    if (phasePages === undefined || current === undefined) {
      return [];
    }
    const result = new Set<DeviceAnimationPageRuntime>([current]);
    const nextInClip = phasePages[resolved.pageIndex + 1];
    if (nextInClip !== undefined) {
      result.add(nextInClip);
      return [...result];
    }
    const addFirstPage = (candidate: DeviceSpriteAnimationPhase) => {
      const page = this.asset.pages[candidate]?.[0];
      if (page !== undefined) {
        result.add(page);
      }
    };
    const playback = this.definition.playback;
    if (phase === playback.openTransitionClip) {
      addFirstPage(playback.statusClips.normal ?? playback.fallbackClip);
    } else if (phase === playback.closeTransitionClip) {
      addFirstPage(playback.fallbackClip);
    } else {
      if (playback.clipOptions[phase]?.loop) addFirstPage(phase);
      if (phase === playback.fallbackClip && playback.openTransitionClip !== null) {
        addFirstPage(playback.openTransitionClip);
      }
      if (phase === playback.statusClips.normal && playback.closeTransitionClip !== null) {
        addFirstPage(playback.closeTransitionClip);
      }
    }
    return [...result];
  }
}

/** 只拥有分页子纹理；页面无人使用时立即释放基础纹理，避免整套动画常驻 GPU。 */
// AI-CORRECTION 2026-09-13: 当前/相邻页由会话保护，可见类型的其他阶段按预算预热驻留；离屏缓冲到期后回收。
// AI-CORRECTION 2026-09-13: 按用户新要求取消预算裁剪，任一阶段激活整套预上传，最后同类实例离屏超过 20 秒才回收。
export class DeviceAnimationTextureCache {
  private readonly entries = new Map<string, {
    readonly signature: string;
    readonly promise: Promise<DeviceAnimationAsset | null>;
  }>();
  private readonly manifests = new Map<string, Promise<unknown>>();
  private readonly sharedIds = new Map<string, Promise<string>>();
  private readonly reportedErrors = new Set<string>();
  private readonly sessions = new Set<DeviceAnimationTextureSession>();
  private readonly resolvedAssets = new Set<DeviceAnimationAsset>();
  private readonly pageAssets = new WeakMap<DeviceAnimationPageRuntime, DeviceAnimationAsset>();
  private readonly queuedPages = new Map<DeviceAnimationPageRuntime, (ready: boolean) => void>();
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;
  private reconcileScheduled = false;
  // AI-REMOVED 2026-09-13:
  // Reason: 不再维护按预算选择的容量。
  // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
  // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
  // Replacement: getStats().residency.retainedSetBytes
  // Risk: 全量驻留提高内存与显存占用。
  // Human Review: Required
  // Original code:
  // private reservedBytes = 0;
  private warmPriorities = new Map<DeviceAnimationPageRuntime, number>();
  private readonly totals = {
    frameHits: 0, frameMisses: 0, demandLoads: 0, prewarmLoads: 0,
    preparedPages: 0, prewarmFailures: 0, loadFailures: 0, unloadFailures: 0,
    // AI-REMOVED 2026-09-13:
    // Reason: 取消预算驱逐计数；仅保留离屏超时回收计数。
    // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
    // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
    // Replacement: totals.offscreenEvictions
    // Risk: 全量驻留提高内存与显存占用。
    // Human Review: Required
    // Original code:
    // budgetEvictions: 0, offscreenEvictions: 0,
    offscreenEvictions: 0,
  };
  private destroyed = false;

  public constructor(private readonly options: {
    readonly loadManifest: (path: string) => Promise<unknown>;
    readonly loadTexture: (path: string, resolution: number) => Promise<Texture>;
    readonly unloadTexture: (path: string, texture: Texture) => Promise<void>;
    readonly configureTexture: (texture: Texture) => void;
    readonly getMaxTextureSize: () => number;
    readonly uploadTexture: (texture: Texture) => void;
    // AI-REMOVED 2026-09-13:
    // Reason: 缓存不再接受预算覆盖。
    // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
    // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
    // Replacement: reconcileResidency 整套驻留
    // Risk: 全量驻留提高内存与显存占用。
    // Human Review: Required
    // Original code:
    // readonly budgetBytes?: number;
  }) {}

  public async get(
    spriteId: string,
    definition: DeviceSpriteAnimationDefinition,
  ): Promise<DeviceAnimationTextures | null> {
    if (this.destroyed) {
      return null;
    }
    try {
      validateDeviceSpriteAnimationId(spriteId);
      if (definition.closeIdleMode !== "loop" && definition.closeIdleMode !== "hold-last") {
        throw new Error("spriteAnimation.closeIdleMode must be loop or hold-last");
      }
    } catch (error) {
      this.report(spriteId, error);
      return null;
    }
    let assetId: string;
    try {
      assetId = await this.resolveSharedAssetId(spriteId, definition);
    } catch (error) {
      this.report(spriteId, error);
      return null;
    }
    if (this.destroyed) return null;
    const signature = getDeviceSpriteAnimationSignature(definition);
    const existing = this.entries.get(assetId);
    if (existing !== undefined && existing.signature !== signature) {
      this.report(spriteId, new Error("Conflicting animation definitions share one animation asset"));
      return null;
    }
    const entry = existing ?? {
      signature,
      promise: this.load(assetId, definition).catch((error: unknown) => {
        if (!this.destroyed) {
          this.report(spriteId, error);
        }
        return null;
      }),
    };
    if (existing === undefined) {
      this.entries.set(assetId, entry);
    }
    const asset = await entry.promise;
    if (this.destroyed || asset === null || asset.unavailable) {
      return null;
    }
    const session = new DeviceAnimationTextureSession(this, asset, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  public getStats(): DeviceAnimationTextureStats {
    let loadingPages = 0;
    let residentDecodedBytes = 0;
    let residentMasks = 0;
    let residentPages = 0;
    for (const asset of this.resolvedAssets) {
      residentMasks += 1;
      residentDecodedBytes += asset.mask.source.pixelWidth * asset.mask.source.pixelHeight * 4;
      for (const phase of asset.definition.clipIds) {
        for (const page of asset.pages[phase] ?? []) {
          if (page.loadPromise !== null) loadingPages += 1;
          if (page.frames !== null && page.texture !== null) {
            residentPages += 1;
            residentDecodedBytes += page.texture.source.pixelWidth * page.texture.source.pixelHeight * 4;
          }
        }
      }
    }
    const now = performance.now();
    const retainedAssets = [...this.resolvedAssets].filter(asset => this.isAssetRetained(asset, now));
    return Object.freeze({
      activeSessions: this.sessions.size,
      loadingPages,
      residentDecodedBytes,
      residentMasks,
      residentPages,
      residency: {
        // AI-REMOVED 2026-09-13:
        // Reason: 以整套目标容量与离屏期限替代软预算。
        // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
        // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
        // Replacement: residency.mode / retainedSetBytes / offscreenGraceMs
        // Risk: 全量驻留提高内存与显存占用。
        // Human Review: Required
        // Original code:
        // budgetBytes: this.budgetBytes,
        // reservedBytes: this.reservedBytes,
        // overBudgetBytes: Math.max(0, this.reservedBytes - this.budgetBytes),
        mode: "full-set" as const,
        offscreenGraceMs: OFFSCREEN_GRACE_MS,
        retainedSetBytes: retainedAssets.reduce((sum, asset) => sum + asset.definition.clipIds
          .reduce((bytes, phase) => bytes + (asset.pages[phase] ?? [])
            .reduce((total, page) => total + page.estimatedBytes, 0), 0), 0),
        retainedAssets: retainedAssets.length,
        visibleSessions: [...this.resolvedAssets].reduce((sum, asset) => sum + asset.visibleOwners.size, 0),
        visibleAssets: [...this.resolvedAssets].filter(asset => asset.visibleOwners.size > 0).length,
        queuedPages: this.queuedPages.size,
        totalsSinceCreation: { ...this.totals },
        assets: retainedAssets.slice(0, 12).map(asset => {
            const pages = asset.definition.clipIds.flatMap(phase => asset.pages[phase] ?? []);
            return { spriteId: asset.spriteId, visibleInstances: asset.visibleOwners.size,
              totalSetBytes: pages.reduce((sum, page) => sum + page.estimatedBytes, 0),
              totalPages: pages.length,
              totalFrames: pages.reduce((sum, page) => sum + page.manifest.frameCount, 0),
              preparedFrames: pages.reduce((sum, page) => sum + (page.frames?.length ?? 0), 0),
              failedPages: pages.filter(page => page.failed).length,
              graceRemainingMs: asset.visibleOwners.size > 0 ? null : Math.max(0, Math.ceil(asset.lastVisibleAt + OFFSCREEN_GRACE_MS - now)),
              selectedPages: pages.filter(page => this.isWanted(page)).length,
              preparedPages: pages.filter(page => page.frames !== null).length };
          }),
        omittedAssets: Math.max(0, retainedAssets.length - 12),
      },
    });
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.queueTimer !== null) clearTimeout(this.queueTimer);
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.queueTimer = null;
    this.expiryTimer = null;
    for (const finish of this.queuedPages.values()) finish(false);
    this.queuedPages.clear();
    for (const session of [...this.sessions]) {
      session.destroy();
    }
    for (const asset of this.resolvedAssets) {
      for (const phase of asset.definition.clipIds) {
        for (const page of asset.pages[phase] ?? []) {
          page.owners.clear();
          page.warm = false;
          void this.unloadPage(page);
        }
      }
      void this.disposeTexture(asset.maskUrl, asset.mask);
    }
    this.resolvedAssets.clear();
    this.entries.clear();
    this.manifests.clear();
    this.sharedIds.clear();
    this.reportedErrors.clear();
  }

  private loadManifest(spriteId: string): Promise<unknown> {
    const existing = this.manifests.get(spriteId);
    if (existing) return existing;
    const root = `3d-top-view/animations/${spriteId}`;
    const loading = this.options.loadManifest(createPublicAssetUrl(`${root}/manifest.json`));
    this.manifests.set(spriteId, loading);
    return loading;
  }

  private resolveSharedAssetId(spriteId: string, definition: DeviceSpriteAnimationDefinition): Promise<string> {
    const existing = this.sharedIds.get(spriteId);
    if (existing) return existing;
    const resolving = (async () => {
      const manifest = await this.loadManifest(spriteId);
      if (manifest === null || typeof manifest !== "object") throw new Error("Invalid animation manifest");
      const sharedId: unknown = "sharedAnimationId" in manifest ? manifest.sharedAnimationId : undefined;
      if (sharedId === undefined) return spriteId;
      if (typeof sharedId !== "string") throw new Error("sharedAnimationId must be a sprite ID");
      validateDeviceSpriteAnimationId(sharedId);
      if (sharedId === spriteId) throw new Error("Animation cannot share itself");
      const sharedManifest = await this.loadManifest(sharedId);
      if (sharedManifest === null || typeof sharedManifest !== "object"
        || "sharedAnimationId" in sharedManifest) throw new Error("Shared animation target must be canonical");
      const local = normalizeDeviceSpriteAnimationDefinition(definition, manifest);
      const canonical = normalizeDeviceSpriteAnimationDefinition(definition, sharedManifest);
      if (JSON.stringify(local) !== JSON.stringify(canonical)) {
        throw new Error("Shared animation playback or geometry differs");
      }
      return sharedId;
    })();
    this.sharedIds.set(spriteId, resolving);
    return resolving;
  }

  public async retainPage(page: DeviceAnimationPageRuntime, owner: symbol): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }
    const added = !page.owners.has(owner);
    page.owners.add(owner);
    if (added) this.scheduleResidency();
    if (page.frames !== null) {
      return true;
    }
    if (page.loadPromise !== null) {
      return page.loadPromise;
    }
    return this.enqueuePage(page);
  }

  public releasePage(page: DeviceAnimationPageRuntime, owner: symbol): void {
    if (!page.owners.delete(owner)) return;
    this.scheduleResidency();
  }

  public recordFrameAccess(hit: boolean): void {
    if (hit) this.totals.frameHits += 1;
    else this.totals.frameMisses += 1;
  }

  public setSessionVisibility(asset: DeviceAnimationAsset, owner: symbol, phase: DeviceSpriteAnimationPhase | null): void {
    if (phase === null) {
      if (!asset.visibleOwners.delete(owner)) return;
    } else asset.visibleOwners.set(owner, phase);
    asset.lastVisibleAt = performance.now();
    this.scheduleResidency();
  }

  // AI-REMOVED 2026-09-13:
  // Reason: 整套保留不能被预算值覆盖。
  // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
  // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
  // Replacement: isAssetRetained / reconcileResidency
  // Risk: 全量驻留提高内存与显存占用。
  // Human Review: Required
  // Original code:
  // private get budgetBytes(): number {
  //   const value = this.options.budgetBytes ?? DEFAULT_ANIMATION_RESIDENCY_BYTES;
  //   return Number.isFinite(value) && value >= 0 ? value : DEFAULT_ANIMATION_RESIDENCY_BYTES;
  // }

  private isAssetRetained(asset: DeviceAnimationAsset, now: number): boolean {
    return asset.visibleOwners.size > 0 || now <= asset.lastVisibleAt + OFFSCREEN_GRACE_MS;
  }

  private isWanted(page: DeviceAnimationPageRuntime): boolean {
    return page.owners.size > 0 || page.warm;
  }

  private scheduleResidency(): void {
    if (this.destroyed || this.reconcileScheduled) return;
    this.reconcileScheduled = true;
    queueMicrotask(() => {
      this.reconcileScheduled = false;
      if (!this.destroyed) this.reconcileResidency();
    });
  }

  // AI-REMOVED 2026-09-13:
  // Reason: 预算选择和离屏立即取消队列与全量驻留要求冲突。
  // Trigger: 用户要求任一动画触发全阶段全帧驻留，最后同类实例离屏超过 20 秒才回收。
  // Evidence: 原软预算会裁剪阶段，5 秒离屏策略提前取消队列。
  // Replacement: 下方 reconcileResidency
  // Risk: 全量驻留提高内存与显存占用。
  // Human Review: Required
  // Original code:
  // private reconcileResidency(): void {
  //   if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
  //   this.expiryTimer = null;
  //   const now = performance.now();
  //   const assets = [...this.resolvedAssets];
  //   const allPages = assets.flatMap(asset => DEVICE_SPRITE_ANIMATION_PHASES.flatMap(phase => asset.pages[phase]));
  //   // 必需页可超过软预算，不能为了满足缓存上限销毁当前正在显示的纹理。
  //   let reserved = assets.reduce((sum, asset) => sum + asset.mask.source.pixelWidth * asset.mask.source.pixelHeight * 4, 0);
  //   for (const page of allPages) {
  //     page.warm = false;
  //     if (page.owners.size > 0) reserved += page.estimatedBytes;
  //   }
  //   const candidates = new Map<DeviceAnimationPageRuntime, number>();
  //   const add = (page: DeviceAnimationPageRuntime | undefined, priority: number) => {
  //     if (page !== undefined && !page.failed) candidates.set(page, Math.min(candidates.get(page) ?? Infinity, priority));
  //   };
  //   let nextExpiry = Infinity;
  //   for (const asset of assets) {
  //     if (asset.unavailable) continue;
  //     if (asset.visibleOwners.size > 0) {
  //       // 所有可见类型先准备各状态入口，再补当前阶段、其他循环和过渡阶段；同类实例共享一份。
  //       for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) add(asset.pages[phase][0], 0);
  //       for (const phase of new Set(asset.visibleOwners.values())) {
  //         for (const page of asset.pages[phase]) add(page, 1);
  //       }
  //       for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
  //         for (const page of asset.pages[phase]) add(page, phase.endsWith("idle") ? 2 : 3);
  //       }
  //     } else if (now < asset.lastVisibleAt + OFFSCREEN_GRACE_MS) {
  //       nextExpiry = Math.min(nextExpiry, asset.lastVisibleAt + OFFSCREEN_GRACE_MS);
  //       // 离屏缓冲只保留已有/正在加载的页，不继续扩大预热集合。
  //       for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
  //         for (const page of asset.pages[phase]) if (page.texture !== null || (page.loadPromise !== null && !this.queuedPages.has(page))) add(page, 4);
  //       }
  //     }
  //   }
  //   for (const [page] of [...candidates].sort((a, b) => a[1] - b[1])) {
  //     if (page.owners.size > 0 || reserved + page.estimatedBytes > this.budgetBytes) continue;
  //     page.warm = true;
  //     reserved += page.estimatedBytes;
  //   }
  //   this.reservedBytes = reserved;
  //   this.warmPriorities = candidates;
  //   for (const page of allPages) {
  //     if (this.isWanted(page)) {
  //       if (page.frames === null && page.loadPromise === null && !page.failed
  //         && this.resolveAsset(page)?.unavailable === false) void this.enqueuePage(page);
  //     } else if (!this.isWanted(page)) {
  //       const finish = this.queuedPages.get(page);
  //       if (finish !== undefined) {
  //         this.queuedPages.delete(page);
  //         finish(false);
  //       }
  //       if (page.texture === null || page.unloadPromise !== null) continue;
  //       const asset = this.resolveAsset(page)!;
  //       if (asset.visibleOwners.size === 0 && now >= asset.lastVisibleAt + OFFSCREEN_GRACE_MS) this.totals.offscreenEvictions += 1;
  //       else this.totals.budgetEvictions += 1;
  //       void this.unloadPage(page);
  //     }
  //   }
  //   if (Number.isFinite(nextExpiry)) {
  //     this.expiryTimer = setTimeout(() => { this.expiryTimer = null; this.scheduleResidency(); }, Math.max(1, nextExpiry - now));
  //   }
  //   this.scheduleQueue();
  // }

  private reconcileResidency(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const now = performance.now();
    this.warmPriorities.clear();
    let nextExpiry = Infinity;
    for (const asset of this.resolvedAssets) {
      const retained = this.isAssetRetained(asset, now);
      const visible = asset.visibleOwners.size > 0;
      if (retained && !visible) nextExpiry = Math.min(nextExpiry, asset.lastVisibleAt + OFFSCREEN_GRACE_MS);
      const currentPhases = new Set(asset.visibleOwners.values());
      for (const phase of asset.definition.clipIds) {
        for (const page of asset.pages[phase] ?? []) {
          // 优先级只决定加载顺序；整套页面在可见期及离屏 20 秒内均保留并继续加载。
          page.warm = retained;
          if (retained) {
            const priority = !visible ? 4 : page.pageIndex === 0 ? 0 : currentPhases.has(phase) ? 1 : phase.endsWith("idle") ? 2 : 3;
            this.warmPriorities.set(page, priority);
          }
          if (this.isWanted(page)) {
            if (page.frames === null && page.loadPromise === null && !page.failed && !asset.unavailable) {
              void this.enqueuePage(page);
            }
          } else {
            const finish = this.queuedPages.get(page);
            if (finish !== undefined) {
              this.queuedPages.delete(page);
              finish(false);
            }
            if (page.texture === null || page.unloadPromise !== null) continue;
            this.totals.offscreenEvictions += 1;
            void this.unloadPage(page);
          }
        }
      }
    }
    if (Number.isFinite(nextExpiry)) {
      // 用户要求“超过 20 秒”，边界时刻仍保留，下一毫秒再回收。
      this.expiryTimer = setTimeout(() => { this.expiryTimer = null; this.scheduleResidency(); }, Math.max(1, Math.ceil(nextExpiry - now) + 1));
    }
    this.scheduleQueue();
  }

  private enqueuePage(page: DeviceAnimationPageRuntime): Promise<boolean> {
    if (page.loadPromise !== null) return page.loadPromise;
    if (page.failed) {
      if (page.owners.size > 0) {
        const asset = this.resolveAsset(page);
        if (asset !== null) asset.unavailable = true;
      }
      return Promise.resolve(false);
    }
    page.loadPromise = new Promise<boolean>(resolve => this.queuedPages.set(page, resolve)).finally(() => {
      page.loadPromise = null;
      // 取消排队与重新入屏可能交错；Promise 清理后重新核对，避免整套有页漏排。
      this.scheduleResidency();
    });
    this.scheduleQueue();
    return page.loadPromise;
  }

  private scheduleQueue(): void {
    if (this.destroyed || this.loading || this.queueTimer !== null || this.queuedPages.size === 0) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      void this.processQueue();
    }, PAGE_QUEUE_INTERVAL_MS);
  }

  private async processQueue(): Promise<void> {
    if (this.destroyed || this.loading) return;
    // 每次只处理一页；已有人等待的帧始终优先于后台预热。
    const page = [...this.queuedPages.keys()].find(candidate => candidate.owners.size > 0)
      ?? [...this.queuedPages.keys()].sort((a, b) => (this.warmPriorities.get(a) ?? 99) - (this.warmPriorities.get(b) ?? 99))[0];
    if (page === undefined) return;
    const finish = this.queuedPages.get(page)!;
    this.queuedPages.delete(page);
    this.loading = true;
    let ready = false;
    try {
      if (this.isWanted(page) && this.resolveAsset(page)?.unavailable === false) {
        if (page.owners.size > 0) this.totals.demandLoads += 1;
        else this.totals.prewarmLoads += 1;
        ready = await this.loadPage(page);
      }
    } finally {
      this.loading = false;
      finish(ready);
      this.scheduleResidency();
      this.scheduleQueue();
    }
  }

  private report(spriteId: string, error: unknown, message = "animation unavailable; using static sprite."): void {
    if (this.reportedErrors.has(spriteId)) {
      return;
    }
    this.reportedErrors.add(spriteId);
    console.error(`[DeviceAnimation] ${spriteId}: ${message}`, error);
  }

  private async load(
    spriteId: string,
    registryDefinition: DeviceSpriteAnimationDefinition,
  ): Promise<DeviceAnimationAsset | null> {
    const root = `3d-top-view/animations/${spriteId}`;
    const manifest = await this.loadManifest(spriteId);
    const definition = normalizeDeviceSpriteAnimationDefinition(registryDefinition, manifest);
    const maskUrl = createPublicAssetUrl(`${root}/${definition.maskFile}`);
    const mask = await this.options.loadTexture(maskUrl, definition.resolution);
    if (this.destroyed) {
      await this.disposeTexture(maskUrl, mask);
      return null;
    }
    try {
      this.validateCompleteTexture(mask);
      if (mask.source.resolution !== definition.resolution
        || mask.width !== definition.frameWidth || mask.height !== definition.frameHeight) {
        throw new Error("Animation union mask dimensions differ from frame dimensions");
      }
      this.options.configureTexture(mask);
    } catch (error) {
      await this.disposeTexture(maskUrl, mask);
      throw error;
    }
    const createPageRuntimes = (phase: DeviceSpriteAnimationPhase) => (
      definition.clips[phase]!.pages.map((page, pageIndex): DeviceAnimationPageRuntime => ({
        phase,
        pageIndex,
        manifest: page,
        url: createPublicAssetUrl(`${root}/${page.file}`),
        resolution: definition.resolution,
        owners: new Set(),
        estimatedBytes: definition.frameWidth * definition.resolution * page.columns
          * definition.frameHeight * definition.resolution * page.rows * 4,
        warm: false,
        failed: false,
        texture: null,
        frames: null,
        loadPromise: null,
        unloadPromise: null,
      }))
    );
    const pages = Object.fromEntries(definition.clipIds.map((clipId) => [
      clipId,
      createPageRuntimes(clipId),
    ])) as Record<DeviceSpriteAnimationPhase, readonly DeviceAnimationPageRuntime[]>;
    const asset: DeviceAnimationAsset = { definition, mask, maskUrl, pages, spriteId,
      visibleOwners: new Map(), lastVisibleAt: -Infinity, unavailable: false };
    for (const phase of definition.clipIds) {
      for (const page of pages[phase] ?? []) this.pageAssets.set(page, asset);
    }
    this.resolvedAssets.add(asset);
    this.scheduleResidency();
    return asset;
  }

  private async loadPage(page: DeviceAnimationPageRuntime): Promise<boolean> {
    if (page.unloadPromise !== null) {
      await page.unloadPromise;
    }
    if (this.destroyed || !this.isWanted(page)) {
      return false;
    }
    let texture: Texture | null = null;
    try {
      texture = await this.options.loadTexture(page.url, page.resolution);
      if (this.destroyed || !this.isWanted(page)) {
        await this.disposeTexture(page.url, texture);
        return false;
      }
      this.validateCompleteTexture(texture);
      const asset = this.resolveAsset(page);
      if (asset === null || asset.unavailable) {
        await this.disposeTexture(page.url, texture);
        return false;
      }
      const { frameWidth, frameHeight } = resolveDeviceSpriteAnimationGrid(
        asset.definition,
        page.manifest,
        {
          width: texture.source.pixelWidth,
          height: texture.source.pixelHeight,
          resolution: texture.source.resolution,
        },
        this.options.getMaxTextureSize(),
      );
      this.options.configureTexture(texture);
      // 驻留期间由当前缓存统一回收；禁止 Pixi 按未绘制时长自动卸载预热源。
      texture.source.autoGarbageCollect = false;
      this.options.uploadTexture(texture);
      this.totals.preparedPages += 1;
      const frames = Object.freeze(Array.from({ length: page.manifest.frameCount }, (_, index) => new Texture({
        source: texture!.source,
        frame: new Rectangle(
          (index % page.manifest.columns) * frameWidth,
          Math.floor(index / page.manifest.columns) * frameHeight,
          frameWidth,
          frameHeight,
        ),
      })));
      page.texture = texture;
      page.frames = frames;
      return true;
    } catch (error) {
      const asset = this.resolveAsset(page);
      page.failed = true;
      if (page.owners.size > 0) {
        this.totals.loadFailures += 1;
        if (asset !== null) asset.unavailable = true;
      } else this.totals.prewarmFailures += 1;
      if (texture !== null) {
        await this.disposeTexture(page.url, texture);
      }
      if (page.owners.size > 0) this.report(page.url, error);
      else console.warn(`[DeviceAnimation] ${page.url}: prewarm failed; current animation retained.`, error);
      return false;
    }
  }

  private async unloadPage(page: DeviceAnimationPageRuntime): Promise<void> {
    if (this.isWanted(page) || page.unloadPromise !== null || page.texture === null) {
      return page.unloadPromise ?? Promise.resolve();
    }
    const texture = page.texture;
    const frames = page.frames ?? [];
    page.texture = null;
    page.frames = null;
    for (const frame of frames) {
      frame.destroy(false);
    }
    page.unloadPromise = this.disposeTexture(page.url, texture).finally(() => {
      page.unloadPromise = null;
      if (!this.destroyed) this.scheduleResidency();
    });
    return page.unloadPromise;
  }

  private resolveAsset(page: DeviceAnimationPageRuntime): DeviceAnimationAsset | null {
    return this.pageAssets.get(page) ?? null;
  }

  private async disposeTexture(path: string, texture: Texture): Promise<void> {
    try {
      await this.options.unloadTexture(path, texture);
    } catch (error) {
      this.totals.unloadFailures += 1;
      this.report(path, error, "texture unload failed.");
    }
  }

  private validateCompleteTexture(texture: Texture): void {
    if (texture.destroyed || texture.source.destroyed
      || !Number.isFinite(texture.source.resolution) || texture.source.resolution <= 0
      || texture.frame.x !== 0 || texture.frame.y !== 0 || texture.rotate !== 0
      || texture.width !== texture.source.width || texture.height !== texture.source.height) {
      throw new Error("Animation resources must be complete image textures with a valid resolution");
    }
  }
}
