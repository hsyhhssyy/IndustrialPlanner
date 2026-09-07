import { Rectangle, Texture } from "pixi.js";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  DEVICE_SPRITE_ANIMATION_PHASES,
  getDeviceSpriteAnimationSignature,
  normalizeDeviceSpriteAnimationDefinition,
  resolveDeviceSpriteAnimationFrame,
  resolveDeviceSpriteAnimationGrid,
  validateDeviceSpriteAnimationId,
  type DeviceSpriteAnimationManifestPage,
  type DeviceSpriteAnimationPhase,
  type NormalizedDeviceSpriteAnimationDefinition,
} from "@/shared/device-sprite-animation";

interface DeviceAnimationPageRuntime {
  readonly phase: DeviceSpriteAnimationPhase;
  readonly pageIndex: number;
  readonly manifest: DeviceSpriteAnimationManifestPage;
  readonly url: string;
  readonly owners: Set<symbol>;
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
  unavailable: boolean;
}

export interface DeviceAnimationTextureStats {
  readonly activeSessions: number;
  readonly loadingPages: number;
  readonly residentDecodedBytes: number;
  readonly residentMasks: number;
  readonly residentPages: number;
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

  public constructor(
    private readonly cache: DeviceAnimationTextureCache,
    private readonly asset: DeviceAnimationAsset,
    private readonly onDestroy: () => void,
  ) {
    this.definition = asset.definition;
    this.mask = asset.mask;
    this.frameWidth = asset.definition.frameWidth;
    this.frameHeight = asset.definition.frameHeight;
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
    const texture = this.resolveFrame(phase, frameIndex);
    if (texture === null) {
      return null;
    }
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
        this.cache.releasePage(page, this.owner);
      }
    });
    return texture;
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const page of this.retainedPages) {
      this.cache.releasePage(page, this.owner);
    }
    this.retainedPages.clear();
    this.onDestroy();
  }

  private resolveFrame(phase: DeviceSpriteAnimationPhase, frameIndex: number): Texture | null {
    const resolved = resolveDeviceSpriteAnimationFrame(this.definition, phase, frameIndex);
    return this.asset.pages[phase][resolved.pageIndex]?.frames?.[resolved.localFrameIndex] ?? null;
  }

  private resolveRetainedPages(
    phase: DeviceSpriteAnimationPhase,
    frameIndex: number,
  ): readonly DeviceAnimationPageRuntime[] {
    const resolved = resolveDeviceSpriteAnimationFrame(this.definition, phase, frameIndex);
    const current = this.asset.pages[phase][resolved.pageIndex];
    if (current === undefined) {
      return [];
    }
    const result = new Set<DeviceAnimationPageRuntime>([current]);
    const nextInClip = this.asset.pages[phase][resolved.pageIndex + 1];
    if (nextInClip !== undefined) {
      result.add(nextInClip);
      return [...result];
    }
    const addFirstPage = (candidate: DeviceSpriteAnimationPhase) => {
      const page = this.asset.pages[candidate][0];
      if (page !== undefined) {
        result.add(page);
      }
    };
    switch (phase) {
      case "open":
        addFirstPage("open_idle");
        break;
      case "open_idle":
        addFirstPage("open_idle");
        addFirstPage("close");
        break;
      case "close":
        addFirstPage("close_idle");
        break;
      case "close_idle":
        if (this.definition.closeIdleMode === "loop") {
          addFirstPage("close_idle");
        }
        addFirstPage("open");
        break;
    }
    return [...result];
  }
}

/** 只拥有分页子纹理；页面无人使用时立即释放基础纹理，避免整套动画常驻 GPU。 */
export class DeviceAnimationTextureCache {
  private readonly entries = new Map<string, {
    readonly signature: string;
    readonly promise: Promise<DeviceAnimationAsset | null>;
  }>();
  private readonly reportedErrors = new Set<string>();
  private readonly sessions = new Set<DeviceAnimationTextureSession>();
  private readonly resolvedAssets = new Set<DeviceAnimationAsset>();
  private destroyed = false;

  public constructor(private readonly options: {
    readonly loadManifest: (path: string) => Promise<unknown>;
    readonly loadTexture: (path: string) => Promise<Texture>;
    readonly unloadTexture: (path: string, texture: Texture) => Promise<void>;
    readonly configureTexture: (texture: Texture) => void;
    readonly getMaxTextureSize: () => number;
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
    const signature = getDeviceSpriteAnimationSignature(definition);
    const existing = this.entries.get(spriteId);
    if (existing !== undefined && existing.signature !== signature) {
      this.report(spriteId, new Error("Conflicting animation definitions share one spriteId"));
      return null;
    }
    const entry = existing ?? {
      signature,
      promise: this.load(spriteId, definition).catch((error: unknown) => {
        if (!this.destroyed) {
          this.report(spriteId, error);
        }
        return null;
      }),
    };
    if (existing === undefined) {
      this.entries.set(spriteId, entry);
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
      residentDecodedBytes += asset.definition.frameWidth * asset.definition.frameHeight * 4;
      for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
        for (const page of asset.pages[phase]) {
          if (page.loadPromise !== null) loadingPages += 1;
          if (page.frames !== null) {
            residentPages += 1;
            residentDecodedBytes += page.manifest.rows * asset.definition.frameHeight
              * page.manifest.columns * asset.definition.frameWidth * 4;
          }
        }
      }
    }
    return Object.freeze({
      activeSessions: this.sessions.size,
      loadingPages,
      residentDecodedBytes,
      residentMasks,
      residentPages,
    });
  }

  public destroy(): void {
    this.destroyed = true;
    for (const session of [...this.sessions]) {
      session.destroy();
    }
    for (const asset of this.resolvedAssets) {
      for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
        for (const page of asset.pages[phase]) {
          page.owners.clear();
          void this.unloadPage(page);
        }
      }
      void this.options.unloadTexture(asset.maskUrl, asset.mask);
    }
    this.resolvedAssets.clear();
    this.entries.clear();
    this.reportedErrors.clear();
  }

  public async retainPage(page: DeviceAnimationPageRuntime, owner: symbol): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }
    page.owners.add(owner);
    if (page.frames !== null) {
      return true;
    }
    if (page.loadPromise !== null) {
      return page.loadPromise;
    }
    page.loadPromise = this.loadPage(page).finally(() => {
      page.loadPromise = null;
    });
    return page.loadPromise;
  }

  public releasePage(page: DeviceAnimationPageRuntime, owner: symbol): void {
    page.owners.delete(owner);
    if (page.owners.size === 0) {
      void this.unloadPage(page);
    }
  }

  private report(spriteId: string, error: unknown): void {
    if (this.reportedErrors.has(spriteId)) {
      return;
    }
    this.reportedErrors.add(spriteId);
    console.error(`[DeviceAnimation] ${spriteId}: animation unavailable; using static sprite.`, error);
  }

  private async load(
    spriteId: string,
    registryDefinition: DeviceSpriteAnimationDefinition,
  ): Promise<DeviceAnimationAsset | null> {
    const root = `3d-top-view/animations/${spriteId}`;
    const manifest = await this.options.loadManifest(createPublicAssetUrl(`${root}/manifest.json`));
    const definition = normalizeDeviceSpriteAnimationDefinition(registryDefinition, manifest);
    const maskUrl = createPublicAssetUrl(`${root}/${definition.maskFile}`);
    const mask = await this.options.loadTexture(maskUrl);
    if (this.destroyed) {
      await this.options.unloadTexture(maskUrl, mask);
      return null;
    }
    this.validateCompleteTexture(mask);
    if (mask.width !== definition.frameWidth || mask.height !== definition.frameHeight) {
      throw new Error("Animation union mask dimensions differ from frame dimensions");
    }
    this.options.configureTexture(mask);
    const createPageRuntimes = (phase: DeviceSpriteAnimationPhase) => (
      definition.clips[phase].pages.map((page, pageIndex): DeviceAnimationPageRuntime => ({
        phase,
        pageIndex,
        manifest: page,
        url: createPublicAssetUrl(`${root}/${page.file}`),
        owners: new Set(),
        texture: null,
        frames: null,
        loadPromise: null,
        unloadPromise: null,
      }))
    );
    const pages: Record<DeviceSpriteAnimationPhase, readonly DeviceAnimationPageRuntime[]> = {
      open: createPageRuntimes("open"),
      open_idle: createPageRuntimes("open_idle"),
      close: createPageRuntimes("close"),
      close_idle: createPageRuntimes("close_idle"),
    };
    const asset: DeviceAnimationAsset = { definition, mask, maskUrl, pages, unavailable: false };
    this.resolvedAssets.add(asset);
    return asset;
  }

  private async loadPage(page: DeviceAnimationPageRuntime): Promise<boolean> {
    if (page.unloadPromise !== null) {
      await page.unloadPromise;
    }
    if (this.destroyed || page.owners.size === 0) {
      return false;
    }
    let texture: Texture | null = null;
    try {
      texture = await this.options.loadTexture(page.url);
      if (this.destroyed || page.owners.size === 0) {
        await this.options.unloadTexture(page.url, texture);
        return false;
      }
      this.validateCompleteTexture(texture);
      const asset = this.resolveAsset(page);
      if (asset === null || asset.unavailable) {
        await this.options.unloadTexture(page.url, texture);
        return false;
      }
      const { frameWidth, frameHeight } = resolveDeviceSpriteAnimationGrid(
        asset.definition,
        page.manifest,
        { width: texture.source.pixelWidth, height: texture.source.pixelHeight },
        this.options.getMaxTextureSize(),
      );
      this.options.configureTexture(texture);
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
      if (asset !== null) {
        asset.unavailable = true;
      }
      if (texture !== null) {
        await this.options.unloadTexture(page.url, texture);
      }
      this.report(page.url, error);
      return false;
    }
  }

  private async unloadPage(page: DeviceAnimationPageRuntime): Promise<void> {
    if (page.owners.size > 0 || page.unloadPromise !== null || page.texture === null) {
      return page.unloadPromise ?? Promise.resolve();
    }
    const texture = page.texture;
    const frames = page.frames ?? [];
    page.texture = null;
    page.frames = null;
    for (const frame of frames) {
      frame.destroy(false);
    }
    page.unloadPromise = this.options.unloadTexture(page.url, texture).finally(() => {
      page.unloadPromise = null;
      const owner = page.owners.values().next().value;
      if (!this.destroyed && owner !== undefined) {
        void this.retainPage(page, owner);
      }
    });
    return page.unloadPromise;
  }

  private resolveAsset(page: DeviceAnimationPageRuntime): DeviceAnimationAsset | null {
    return [...this.resolvedAssets].find(
      (candidate) => candidate.pages[page.phase][page.pageIndex] === page,
    ) ?? null;
  }

  private validateCompleteTexture(texture: Texture): void {
    if (texture.destroyed || texture.source.destroyed || texture.source.resolution !== 1
      || texture.frame.x !== 0 || texture.frame.y !== 0 || texture.rotate !== 0
      || texture.width !== texture.source.pixelWidth || texture.height !== texture.source.pixelHeight) {
      throw new Error("Animation resources must be complete, unscaled image textures");
    }
  }
}
