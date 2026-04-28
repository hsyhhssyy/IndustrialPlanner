import {
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
  Assets,
} from "pixi.js"

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import type { RenderHost } from "@/renderer/renderer-host"
import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180

const DEFAULT_GHOST_ROOT_ALPHA = 0.2;
const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

const SCANLINE_TEXTURE_PATH = "/textures/scanline-45deg-50opacity.png";
/** 扫描线超出设备边界的像素 padding（按 tile 个数 × 纹理原始宽度） */
const SCANLINE_PADDING_TILES = 2;
const SCANLINE_SCROLL_INTERVAL_MS = 2000;

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private readonly previewEffectRoot: Container
  private readonly previewFillContainer: Container
  private readonly previewMask: Sprite
  private currentLayout: RenderSpriteLayout | null = null
  private disposed = false
  private isTextureReady = false

  /** 扫描线 TilingSprite，完全由 GenericDeviceSprite 自己管理 */
  protected readonly scanlineTiling: TilingSprite;
  private scanlineTexture: Texture | null = null;
  private scanlineLoadStarted = false;

  private defaultCollectionOverlayGraphics: Graphics | null = null;

  public constructor(
    entityId: string,
    spriteId: string,
    private readonly renderHost: RenderHost,
  ) {
    super(entityId)

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    this.previewEffectRoot = new Container()
    this.previewEffectRoot.visible = false

    this.previewFillContainer = new Container()

    this.previewMask = new Sprite(Texture.EMPTY)
    this.previewMask.anchor.set(0.5)
    this.previewMask.roundPixels = true

    // 自行创建扫描线，直接放入 masked container（不再从基类移入）
    this.scanlineTiling = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 });
    this.scanlineTiling.anchor.set(0.5);
    this.scanlineTiling.roundPixels = true;
    this.scanlineTiling.visible = false;
    this.previewFillContainer.addChild(this.scanlineTiling)
    this.previewFillContainer.mask = this.previewMask

    this.previewEffectRoot.addChild(this.previewFillContainer)
    this.previewEffectRoot.addChild(this.previewMask)
    this.getRootOfLayer("overlay").addChild(this.previewEffectRoot)

    const bodyTextureLoad = this.renderHost.textureManager.getTexture(`device-sprite-${spriteId}`)
    const previewMaskTextureLoad = this.renderHost.textureManager.getTexture(`device-masks-${spriteId}`)

    void Promise.all([bodyTextureLoad, previewMaskTextureLoad]).then(([
      bodyTexture,
      previewMaskTexture,
    ]) => {
      if (this.disposed) {
        return
      }

      this.body.texture = bodyTexture
      this.previewMask.texture = previewMaskTexture
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
      }
    }).catch(() => {
      if (this.disposed) {
        return
      }

      this.body.visible = false
      this.previewEffectRoot.visible = false
    })
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void context

    this.currentLayout = layout

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
  }

  protected resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout;
    void context;

    for (const root of this.getAllRoots()) {
      root.alpha = 1;
      root.visible = true;
    }
    this.defaultCollectionOverlayGraphics?.clear();
    this.scanlineTiling.visible = false;
    this.previewEffectRoot.visible = false;
  }

  // ---- 三个 abstract overlay 方法实现 ----

  protected drawGhostOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout;
    void context;

    for (const root of this.getAllRoots()) {
      root.alpha = DEFAULT_GHOST_ROOT_ALPHA;
    }
  }

  protected drawPreviewOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isTextureReady) {
      return;
    }

    this.loadScanlineTexture();

    // 以纹理原始像素尺寸平铺，不做 zoom 缩放
    const tilePixelSize = this.scanlineTexture?.width ?? 64;
    const paddingPixels = SCANLINE_PADDING_TILES * tilePixelSize;

    this.scanlineTiling.visible = true;
    this.scanlineTiling.x = 0;
    this.scanlineTiling.y = 0;
    this.scanlineTiling.width = layout.width + paddingPixels * 2;
    this.scanlineTiling.height = layout.height + paddingPixels * 2;

    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS;
    this.scanlineTiling.tilePosition.x = phase * tilePixelSize;

    this.previewEffectRoot.visible = true;
  }

  protected drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.drawCollectionOverlayStroke({
      layout,
      color: this.resolveSelectionCollectionOverlayColor(context),
      width: this.resolveSelectionCollectionOverlayStrokeWidth(context),
    });
  }

  // ---- overlay 辅助方法 ----

  protected getCollectionOverlayGraphics(): Graphics {
    this.ensureNotDisposed();

    if (this.defaultCollectionOverlayGraphics !== null) {
      return this.defaultCollectionOverlayGraphics;
    }

    const graphics = new Graphics({ roundPixels: true });
    this.getRootOfLayer("overlay").addChild(graphics);
    this.defaultCollectionOverlayGraphics = graphics;
    return graphics;
  }

  protected resolveSelectionCollectionOverlayStrokeWidth(
    context: RenderSpriteSyncContext,
  ): number {
    return resolveWorldEntitySelectionStrokeWidth(this.resolveWorkspaceGridCellPixelSize(context));
  }

  protected resolveSelectionCollectionOverlayColor(
    context: RenderSpriteSyncContext,
  ): number {
    return resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.worldEntitySelectionStrokeColorKey,
    );
  }

  protected drawCollectionOverlayStroke(options: {
    layout: RenderSpriteLayout;
    color: number;
    width: number;
  }): void {
    const innerRect = resolveInnerStrokeRect(options.layout, options.width);
    if (innerRect === null) {
      return;
    }

    this.getCollectionOverlayGraphics()
      .rect(innerRect.x, innerRect.y, innerRect.width, innerRect.height)
      .stroke({
        width: options.width,
        color: options.color,
      });
  }

  private loadScanlineTexture(): void {
    if (this.scanlineLoadStarted) {
      return;
    }

    this.scanlineLoadStarted = true;

    void Assets.load<Texture>(SCANLINE_TEXTURE_PATH).then((texture) => {
      if (this.disposed) {
        return;
      }

      this.scanlineTexture = texture;
      this.scanlineTiling.texture = texture;
    }).catch(() => {
      // 扫描线纹理加载失败，无伤大雅
    });
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Cannot use a destroyed render sprite.");
    }
  }

  protected onDestroy(): void {
    this.disposed = true
  }

  private applyLayout(layout: RenderSpriteLayout): void {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270
    const normalizedLayout = {
      x: layout.x + layout.width / 2,
      y: layout.y + layout.height / 2,
      width: isQuarterTurn ? layout.height : layout.width,
      height: isQuarterTurn ? layout.width : layout.height,
      rotation: layout.rotation * DEGREE_TO_RADIAN,
    }

    applyCenteredSpriteLayout(this.body, normalizedLayout)
    applyCenteredSpriteLayout(this.previewFillContainer, normalizedLayout)
    applyCenteredSpriteLayout(this.previewMask, normalizedLayout)
  }

}

function applyCenteredSpriteLayout(target: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}, layout: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): void {
  target.x = layout.x
  target.y = layout.y
  target.width = layout.width
  target.height = layout.height
  target.rotation = layout.rotation
}

function resolveWorldEntitySelectionStrokeWidth(gridCellPixelSize: number): number {
  const width = gridCellPixelSize / 8;

  return Math.max(
    WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
    Math.min(WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH, width),
  );
}

function resolveInnerStrokeRect(
  layout: RenderSpriteLayout,
  strokeWidth: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const inset = Math.min(
    strokeWidth / 2,
    layout.width / 2,
    layout.height / 2,
  );
  const width = layout.width - inset * 2;
  const height = layout.height - inset * 2;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: layout.x + inset,
    y: layout.y + inset,
    width,
    height,
  };
}
