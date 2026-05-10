import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  Assets,
  type TextStyleOptions,
} from "pixi.js"

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import { getRotatedGridFootprint } from "@/shared/geometry/grid"
import type { GridRectSize, GridRotation } from "@/domain/shared/grid"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"
import {
  resolveDeviceBodyTextureKey,
  resolveDeviceLabelIconTextureKey,
  resolveDeviceMaskTextureKey,
} from "@/renderer/sprites/device-texture-key"
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

const BLUEPRINT_MASK_TEXTURE_PATH = "/textures/blueprint-mask-50opacity.png";
const PREVIEW_BORDER_WIDTH = 1;
const PREVIEW_BORDER_ALPHA = 0.5;

const DEVICE_LABEL_ICON_SIZE = 14;
const DEVICE_LABEL_FONT_SIZE = 8;
const DEVICE_LABEL_TEXT_WIDTH_RATIO = 0.88;
const DEVICE_LABEL_GAP = 2;
const DEVICE_LABEL_LINE_HEIGHT_RATIO = 1.16;
const DEVICE_LABEL_DEFAULT_TEXT_COLOR = 0xffffff;
const DEVICE_LABEL_DEFAULT_STROKE_COLOR = 0x20242a;
const DEVICE_LABEL_BLUEPRINT_TEXT_COLOR = 0x111111;

const FLOW_GLOW_TEXTURE_PATH = "/textures/flow-glow.png";
/** 边缘流光内边框粗细（px），默认 5px */
/** 2026-05-05: 现改为动态计算后的上限值，真实线宽按实体渲染后最长边的 8% 决定，并夹取到 1-5px。 */
const FLOW_GLOW_BORDER_MAX_WIDTH = 5;
const FLOW_GLOW_BORDER_MIN_WIDTH = 1;
/** 流光滑动周期（ms） */
const FLOW_GLOW_SCROLL_INTERVAL_MS = 5000;

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type PortEdge = PortDefinition["edge"];
type PortChevronMaterial = "solid" | "liquid";
type PortChevronDirection = "input" | "output";
type PortChevronTextureKey = `${PortChevronMaterial}-${PortChevronDirection}`;

const PORT_CHEVRON_TEXTURE_KEYS = [
  "solid-input",
  "solid-output",
  "liquid-input",
  "liquid-output",
] as const satisfies readonly PortChevronTextureKey[];

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly spriteId: string
  private readonly body: Sprite
  private readonly previewEffectRoot: Container
  private readonly previewMask: Sprite
  private readonly deviceLabelRoot: Container
  private readonly deviceIcon: Sprite
  private readonly deviceNameText: Text
  private currentLayout: RenderSpriteLayout | null = null
  private disposed = false
  private isTextureReady = false
  private currentBodyTextureKey: string | null = null
  private currentMaskTextureKey: string | null = null
  private currentDeviceIconTextureKey: string | null = null
  private currentDeviceNameText: string | null = null
  private currentDeviceNameStyleKey: string | null = null
  private textureLoadVersion = 0
  private deviceIconLoadVersion = 0
  private isDeviceIconReady = false

  /** 扫描线 TilingSprite，完全由 GenericDeviceSprite 自己管理 */
  protected readonly scanlineTiling: TilingSprite;
  private scanlineTexture: Texture | null = null;
  private scanlineLoadStarted = false;

  /** preview 白色固定宽度边框线 */
  private readonly previewBorderGraphics: Graphics;

  /** selection 特效：blueprint mask 平铺 + device mask 裁剪 */
  /** AI-CORRECTION 2026-05-10: 开启蓝图样式设备图片后，此处裁剪遮罩改为 blueprint-view/sprite-masks；关闭时仍使用 device mask。 */
  private readonly selectionEffectRoot: Container;
  private readonly selectionMask: Sprite;
  protected readonly selectionTiling: TilingSprite;
  private selectionTexture: Texture | null = null;
  private selectionTextureLoadStarted = false;

  /** 边缘流光特效 */
  private readonly flowGlowEffectRoot: Container;
  /** 内边框底色 Graphics */
  private readonly flowGlowBorderGraphics: Graphics;
  /** 矩形遮罩 Graphics，将流光裁剪到设备矩形区域内 */
  private readonly flowGlowMask: Graphics;
  /** 扇形光束 TilingSprite，从设备中心旋转，纹理平铺填充 */
  private readonly flowGlowBeam: TilingSprite;
  private flowGlowTexture: Texture | null = null;
  private flowGlowTextureLoadStarted = false;

  private defaultCollectionOverlayGraphics: Graphics | null = null;

  private readonly portOverlayRoot: Container;
  private readonly portChevronSprites: Sprite[] = [];
  private readonly portChevronTextures = new Map<PortChevronTextureKey, Texture>();
  private portChevronTextureLoadStarted = false;
  private arePortChevronTexturesReady = false;

  public constructor(
    entityId: string,
    private readonly definition: EntityDefinition,
    private readonly renderHost: RenderHost,
  ) {
    super(entityId)

    const spriteId = definition.spriteId
    this.spriteId = spriteId

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    this.deviceLabelRoot = new Container()
    this.deviceLabelRoot.visible = false

    this.deviceIcon = new Sprite(Texture.EMPTY)
    this.deviceIcon.anchor.set(0.5)
    this.deviceIcon.roundPixels = true
    this.deviceIcon.visible = false

    this.deviceNameText = new Text({
      text: "",
      style: createDeviceNameTextStyle({
        useBlueprintStyle: false,
        fontSize: DEVICE_LABEL_FONT_SIZE,
        wordWrapWidth: 64,
      }),
    })
    this.deviceNameText.anchor.set(0.5)
    this.deviceNameText.visible = false

    this.deviceLabelRoot.addChild(this.deviceIcon)
    this.deviceLabelRoot.addChild(this.deviceNameText)
    this.getRootOfLayer("entity").addChild(this.deviceLabelRoot)

    this.previewEffectRoot = new Container()
    this.previewEffectRoot.visible = false

    this.previewMask = new Sprite(Texture.EMPTY)
    this.previewMask.anchor.set(0.5)
    this.previewMask.roundPixels = true

    // previewMask 只作为裁剪遮罩，不参与可见渲染
    this.previewMask.renderable = false;

    // 扫描线直接放入 previewEffectRoot，mask 设在 TilingSprite 上
    // 不再经过中间 Container，避免 Container 的 scale/rotation 副作用
    this.scanlineTiling = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 });
    this.scanlineTiling.anchor.set(0.5);
    this.scanlineTiling.roundPixels = true;
    this.scanlineTiling.visible = false;
    this.scanlineTiling.mask = this.previewMask

    // preview 白色固定边框线，位于扫描线之上
    this.previewBorderGraphics = new Graphics({ roundPixels: true });
    this.previewBorderGraphics.visible = false;

    this.previewEffectRoot.addChild(this.scanlineTiling)
    this.previewEffectRoot.addChild(this.previewMask)
    this.previewEffectRoot.addChild(this.previewBorderGraphics)
    this.getRootOfLayer("overlay").addChild(this.previewEffectRoot)

    // selection 特效：blueprint mask 平铺 + device mask 裁剪
    // AI-CORRECTION 2026-05-10: 开启蓝图样式设备图片后，此处裁剪遮罩改为 blueprint-view/sprite-masks；关闭时仍使用 device mask。
    this.selectionEffectRoot = new Container()
    this.selectionEffectRoot.visible = false

    this.selectionMask = new Sprite(Texture.EMPTY)
    this.selectionMask.anchor.set(0.5)
    this.selectionMask.roundPixels = true
    // selectionMask 只作为裁剪遮罩，不参与可见渲染
    this.selectionMask.renderable = false;

    this.selectionTiling = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 });
    this.selectionTiling.anchor.set(0.5);
    this.selectionTiling.roundPixels = true;
    this.selectionTiling.visible = false;
    this.selectionTiling.mask = this.selectionMask;

    this.selectionEffectRoot.addChild(this.selectionTiling)
    this.selectionEffectRoot.addChild(this.selectionMask)
    this.getRootOfLayer("overlay").addChild(this.selectionEffectRoot)

    // 边缘流光特效：内边框底色 + 扇形光束从中心旋转，矩形遮罩裁剪
    this.flowGlowEffectRoot = new Container()
    this.flowGlowEffectRoot.visible = false

    this.flowGlowBorderGraphics = new Graphics({ roundPixels: true });

    this.flowGlowMask = new Graphics({ roundPixels: true });
    this.flowGlowEffectRoot.addChild(this.flowGlowMask);
    this.flowGlowEffectRoot.mask = this.flowGlowMask;

    this.flowGlowBeam = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 });
    this.flowGlowBeam.anchor.set(0.5);
    this.flowGlowBeam.roundPixels = true;
    this.flowGlowBeam.visible = false;

    this.flowGlowEffectRoot.addChild(this.flowGlowBorderGraphics);
    this.flowGlowEffectRoot.addChild(this.flowGlowBeam);
    this.getRootOfLayer("overlay").addChild(this.flowGlowEffectRoot);

    this.portOverlayRoot = new Container()
    this.portOverlayRoot.visible = false
    this.getRootOfLayer("overlay").addChild(this.portOverlayRoot)

    this.syncDeviceTextures()
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void context

    this.currentLayout = layout
    this.syncDeviceTextures()

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
    this.previewBorderGraphics.clear();
    this.previewBorderGraphics.visible = false;
    this.previewEffectRoot.visible = false;
    this.selectionEffectRoot.visible = false;
    this.flowGlowBorderGraphics.clear();
    this.flowGlowEffectRoot.visible = false;
    this.portOverlayRoot.visible = false;
    this.hidePortChevronSprites();
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

    // 当 preview 包含多个元素时，使用蓝色 selection 特效
    const previewCollection = context.workspace.editor?.state.collections[EntityCollectionType.preview];
    if (previewCollection && previewCollection.length > 1) {
      this.drawSelectionOverlay(layout, context);
      return;
    }

    // 单元素 preview：使用白色系动画遮罩
    this.loadScanlineTexture();

    // 以纹理原始像素尺寸平铺，不做 zoom 缩放
    const tilePixelSize = this.scanlineTexture?.width ?? 64;
    const paddingPixels = SCANLINE_PADDING_TILES * tilePixelSize;

    this.scanlineTiling.visible = true;
    this.scanlineTiling.x = layout.x + layout.width / 2;
    this.scanlineTiling.y = layout.y + layout.height / 2;
    this.scanlineTiling.rotation = 0;
    this.scanlineTiling.width = layout.width + paddingPixels * 2;
    this.scanlineTiling.height = layout.height + paddingPixels * 2;

    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS;
    this.scanlineTiling.tilePosition.x = phase * tilePixelSize;

    // 白色固定宽度边框线，50% 不透明度
    this.previewBorderGraphics.visible = true;
    this.previewBorderGraphics
      .rect(layout.x, layout.y, layout.width, layout.height)
      .stroke({
        width: PREVIEW_BORDER_WIDTH,
        color: 0xffffff,
        alpha: PREVIEW_BORDER_ALPHA,
      });

    this.previewEffectRoot.visible = true;
  }

  protected drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isTextureReady) {
      return;
    }

    // 当只有自己处于 selection 中，且不是 marquee/move 模式时，使用边缘流光特效
    if (this.shouldDrawFlowGlowOverlay(context)) {
      this.drawFlowGlowOverlay(layout, context);
      return;
    }

    this.loadSelectionTexture();

    this.selectionTiling.visible = true;
    this.selectionTiling.x = layout.x + layout.width / 2;
    this.selectionTiling.y = layout.y + layout.height / 2;
    this.selectionTiling.rotation = 0;
    this.selectionTiling.width = layout.width;
    this.selectionTiling.height = layout.height;

    void context;

    this.selectionEffectRoot.visible = true;
  }

  protected afterSyncLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.syncDeviceLabel(layout);

    if (this.shouldDrawLogisticsEndpointOverlay(context)) {
      this.drawPreviewOverlay(layout, context);
    }

    this.syncPortOverlay(layout, context);
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

  private syncDeviceTextures(): void {
    const bodyTextureKey = resolveDeviceBodyTextureKey(
      this.spriteId,
      this.renderHost.workspace.app,
    )
    const maskTextureKey = resolveDeviceMaskTextureKey(
      this.spriteId,
      this.renderHost.workspace.app,
    )

    if (
      this.currentBodyTextureKey === bodyTextureKey
      && this.currentMaskTextureKey === maskTextureKey
    ) {
      return
    }

    this.currentBodyTextureKey = bodyTextureKey
    this.currentMaskTextureKey = maskTextureKey
    this.textureLoadVersion += 1
    const activeLoadVersion = this.textureLoadVersion

    this.isTextureReady = false
    this.body.visible = false
    this.deviceLabelRoot.visible = false

    const bodyTextureLoad = this.renderHost.textureManager.getTexture(bodyTextureKey)
    const previewMaskTextureLoad = this.renderHost.textureManager.getTexture(maskTextureKey)

    void Promise.all([bodyTextureLoad, previewMaskTextureLoad]).then(([
      bodyTexture,
      previewMaskTexture,
    ]) => {
      if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
        return
      }

      this.body.texture = bodyTexture
      this.previewMask.texture = previewMaskTexture
      this.selectionMask.texture = previewMaskTexture
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
      }
    }).catch(() => {
      if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
        return
      }

      this.body.visible = false
      this.previewEffectRoot.visible = false
      this.selectionEffectRoot.visible = false
      this.flowGlowEffectRoot.visible = false
      this.portOverlayRoot.visible = false
      this.deviceLabelRoot.visible = false
      this.hidePortChevronSprites()
    })
  }

  private syncDeviceLabel(layout: RenderSpriteLayout): void {
    const app = this.renderHost.workspace.app;
    if (!shouldRenderDeviceLabel(this.definition)) {
      this.deviceLabelRoot.visible = false;
      this.deviceIcon.visible = false;
      this.deviceNameText.visible = false;
      return;
    }

    const useBlueprintStyle = app?.state.settings.gameUseSimplifiedDeviceIcons ?? false;
    const showDeviceName = app?.state.settings.gameShowDeviceNames ?? true;
    const showDeviceIcon = app?.state.settings.gameShowDeviceIcons ?? false;

    if (!this.isTextureReady || (!showDeviceName && !showDeviceIcon)) {
      this.deviceLabelRoot.visible = false;
      this.deviceIcon.visible = false;
      this.deviceNameText.visible = false;
      return;
    }

    const labelLayout = resolveDeviceLabelLayout({
      layout,
      showDeviceIcon,
      showDeviceName,
    });

    this.deviceLabelRoot.visible = true;

    if (showDeviceIcon) {
      this.syncDeviceIconTexture();
      this.deviceIcon.x = labelLayout.icon.x;
      this.deviceIcon.y = labelLayout.icon.y;
      this.deviceIcon.width = labelLayout.icon.size;
      this.deviceIcon.height = labelLayout.icon.size;
      this.deviceIcon.rotation = 0;
      this.deviceIcon.visible = this.isDeviceIconReady;
    } else {
      this.deviceIcon.visible = false;
    }

    if (showDeviceName) {
      const nextText = resolveDeviceDisplayName(this.definition, app);
      if (this.currentDeviceNameText !== nextText) {
        this.currentDeviceNameText = nextText;
        this.deviceNameText.text = nextText;
      }

      const nextStyleKey = createDeviceNameTextStyleKey({
        useBlueprintStyle,
        fontSize: labelLayout.text.fontSize,
        wordWrapWidth: labelLayout.text.maxWidth,
      });
      if (this.currentDeviceNameStyleKey !== nextStyleKey) {
        this.currentDeviceNameStyleKey = nextStyleKey;
        this.deviceNameText.style = createDeviceNameTextStyle({
          useBlueprintStyle,
          fontSize: labelLayout.text.fontSize,
          wordWrapWidth: labelLayout.text.maxWidth,
        });
      }

      this.deviceNameText.x = labelLayout.text.x;
      this.deviceNameText.y = labelLayout.text.y;
      this.deviceNameText.rotation = 0;
      this.deviceNameText.visible = true;
    } else {
      this.deviceNameText.visible = false;
    }
  }

  private syncDeviceIconTexture(): void {
    const nextTextureKey = resolveDeviceLabelIconTextureKey(
      this.definition.id,
      this.renderHost.workspace.app,
    );

    if (this.currentDeviceIconTextureKey === nextTextureKey) {
      return;
    }

    this.currentDeviceIconTextureKey = nextTextureKey;
    this.deviceIconLoadVersion += 1;
    this.isDeviceIconReady = false;
    this.deviceIcon.visible = false;
    const activeLoadVersion = this.deviceIconLoadVersion;

    void this.renderHost.textureManager.getTexture(nextTextureKey).then((texture) => {
      if (
        this.disposed
        || activeLoadVersion !== this.deviceIconLoadVersion
        || this.currentDeviceIconTextureKey !== nextTextureKey
      ) {
        return;
      }

      this.deviceIcon.texture = texture;
      this.isDeviceIconReady = true;

      if (this.currentLayout !== null) {
        this.syncDeviceLabel(this.currentLayout);
      }
    }).catch(() => {
      if (this.disposed || activeLoadVersion !== this.deviceIconLoadVersion) {
        return;
      }

      this.isDeviceIconReady = false;
      this.deviceIcon.visible = false;
    });
  }

  private loadSelectionTexture(): void {
    if (this.selectionTextureLoadStarted) {
      return;
    }

    this.selectionTextureLoadStarted = true;

    void Assets.load<Texture>(BLUEPRINT_MASK_TEXTURE_PATH).then((texture) => {
      if (this.disposed) {
        return;
      }

      this.selectionTexture = texture;
      this.selectionTiling.texture = texture;
    }).catch(() => {
      // blueprint mask 纹理加载失败，无伤大雅
    });
  }

  private shouldDrawFlowGlowOverlay(context: RenderSpriteSyncContext): boolean {
    const collections = context.workspace.editor?.state.collections;
    if (!collections) {
      return false;
    }

    // 只有自己处于 selection 中
    const selectionCollection = collections[EntityCollectionType.selection];
    if (!isOnlyEntityInCollection(selectionCollection, this.entityId)) {
      return false;
    }

    // 不是 marquee 模式
    const activeTool = context.workspace.app?.state.activeTool;
    if (activeTool === "marquee" || activeTool === "move") {
      return false;
    }

    return true;
  }

  private drawFlowGlowOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isTextureReady) {
      return;
    }

    this.loadFlowGlowTexture();

    const bw = resolveFlowGlowBorderWidth(layout);
    const x0 = layout.x;
    const y0 = layout.y;
    const w = layout.width;
    const h = layout.height;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    const halfBw = bw / 2;

    // 1. 内边框底色（向内缩进半线宽 stroke）
    this.flowGlowBorderGraphics.clear();
    const strokeColor = resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.flowGlowStrokeColorKey,
    );
    this.flowGlowBorderGraphics
      .rect(x0 + halfBw, y0 + halfBw, w - bw, h - bw)
      .stroke({ width: bw, color: strokeColor });

    // 2. 矩形边框环遮罩：光束只在边缘边框区域可见（挖空内部）
    this.flowGlowMask.clear();
    this.flowGlowMask
      .rect(x0, y0, w, h).fill({ color: 0xffffff })
      .rect(x0 + bw, y0 + bw, w - 2 * bw, h - 2 * bw).cut();

    // 3. 扇形光束 TilingSprite：从设备中心旋转，纹理平铺
    if (this.flowGlowTexture !== null) {
      const texSize = this.flowGlowTexture.width; // 512

      // 边长至少覆盖设备对角线，确保旋转 45° 时仍填满矩形
      const diag = Math.sqrt(w * w + h * h);
      const tileSize = Math.max(diag, texSize);

      // 旋转相位：一个周期完成 360° 旋转
      const phase = ((context.time.nowMs % FLOW_GLOW_SCROLL_INTERVAL_MS) / FLOW_GLOW_SCROLL_INTERVAL_MS);
      const rotation = phase * Math.PI * 2;

      const tintColor = resolveAppThemeColorNumber(
        context.theme,
        context.theme.renderer.flowGlowTintColorKey,
      );

      this.flowGlowBeam.visible = true;
      this.flowGlowBeam.x = cx;
      this.flowGlowBeam.y = cy;
      this.flowGlowBeam.width = tileSize;
      this.flowGlowBeam.height = tileSize;
      this.flowGlowBeam.tileScale.set(1);
      this.flowGlowBeam.rotation = rotation;
      this.flowGlowBeam.tint = tintColor;
    } else {
      this.flowGlowBeam.visible = false;
    }

    this.flowGlowEffectRoot.visible = true;
  }

  private loadFlowGlowTexture(): void {
    if (this.flowGlowTextureLoadStarted) {
      return;
    }

    this.flowGlowTextureLoadStarted = true;

    void Assets.load<Texture>(FLOW_GLOW_TEXTURE_PATH).then((texture) => {
      if (this.disposed) {
        return;
      }

      this.flowGlowTexture = texture;
      this.flowGlowBeam.texture = texture;
    }).catch(() => {
      // flow-glow 纹理加载失败，无伤大雅
    });
  }

  private loadPortChevronTextures(useMobile: boolean): void {
    if (this.portChevronTextureLoadStarted) {
      return;
    }

    this.portChevronTextureLoadStarted = true;

    void Promise.all(
      PORT_CHEVRON_TEXTURE_KEYS.map(async (key) => {
        const texture = await this.renderHost.textureManager.getTexture(
          resolvePortChevronTextureResourceKey(key, useMobile),
        );
        return [key, texture] as const;
      }),
    ).then((entries) => {
      if (this.disposed) {
        return;
      }

      for (const [key, texture] of entries) {
        this.portChevronTextures.set(key, texture);
      }

      this.arePortChevronTexturesReady = true;
    }).catch(() => {
      // 端口贴图走 texture manager fallback；这里仅避免异步异常影响 sprite 同步。
    });
  }

  private syncPortOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isTextureReady) {
      return;
    }

    if (!this.shouldDrawPortOverlay(context)) {
      return;
    }

    // 物流模式下根据是否已起笔决定显示出口还是入口箭头
    const directionFilter = this.resolveLogisticsPortDirectionFilter(context);

    const portChevronSpecs = resolvePortChevronSpecs({
      definition: this.definition,
      layout,
      directionFilter,
    });

    if (portChevronSpecs.length === 0) {
      return;
    }

    if (!this.arePortChevronTexturesReady) {
      const deviceClass = context.workspace.app?.state.screenProfile.deviceClass;
      const useMobile = deviceClass === "mobile" || deviceClass === "tablet";
      this.loadPortChevronTextures(useMobile);
      return;
    }

    for (let index = 0; index < portChevronSpecs.length; index += 1) {
      const spec = portChevronSpecs[index];

      if (spec === undefined) {
        continue;
      }

      const texture = this.portChevronTextures.get(spec.textureKey);

      if (texture === undefined) {
        continue;
      }

      const sprite = this.getPortChevronSprite(index);
      sprite.texture = texture;
      sprite.tint = resolveAppThemeColorNumber(
        context.theme,
        context.theme.renderer.portChevronColorKey,
      );
      sprite.visible = true;
      sprite.x = spec.x;
      sprite.y = spec.y;
      sprite.width = spec.width;
      sprite.height = spec.height;
      sprite.rotation = spec.rotation;
    }

    for (let index = portChevronSpecs.length; index < this.portChevronSprites.length; index += 1) {
      const sprite = this.portChevronSprites[index];

      if (sprite !== undefined) {
        sprite.visible = false;
      }
    }

    this.portOverlayRoot.visible = true;
  }

  private shouldDrawPortOverlay(context: RenderSpriteSyncContext): boolean {
    if (this.definition.tags.includes("ChevronHidden")) {
      return false;
    }

    const collections = context.workspace.editor!.state.collections;

    if (isOnlyEntityInCollection(
      collections[EntityCollectionType.selection],
      this.entityId,
    ) || isOnlyEntityInCollection(
      collections[EntityCollectionType.preview],
      this.entityId,
    )) {
      return true;
    }

    // 传送带模式下，对所有设备显示端口箭头
    if (context.workspace.app?.state.activeTool === "logistics-placement") {
      return true;
    }

    return false;
  }

  /**
   * 物流模式下，根据是否已起笔（已有 head）决定显示出口还是入口箭头：
   * - 未起笔（无 draft / headDraftEntityId 为 null）：显示 output（出口）箭头
   * - 已起笔（有 draft 且 headDraftEntityId 非 null）：显示 input（入口/终点）箭头
   * - 非物流模式返回 null，不过滤
   */
  private resolveLogisticsPortDirectionFilter(
    context: RenderSpriteSyncContext,
  ): "input" | "output" | null {
    if (context.workspace.app?.state.activeTool !== "logistics-placement") {
      return null;
    }

    const draft = context.workspace.editor?.queries?.resolveLogisticsDraftState?.();

    if (draft && draft.headDraftEntityId !== null) {
      // 已起笔 → 显示入口箭头（可作为终点连接的目标设备）
      return "input";
    }

    // 未起笔 → 显示出口箭头（可作为起点的设备）
    return "output";
  }

  private shouldDrawLogisticsEndpointOverlay(context: RenderSpriteSyncContext): boolean {
    const draft = context.workspace.editor?.queries?.resolveLogisticsDraftState?.();
    const sourceEntityId = draft?.source?.type === "device-port"
      ? draft.source.entityId
      : null;
    const targetEntityId = draft?.target?.type === "device-port"
      ? draft.target.entityId
      : null;

    return this.entityId === sourceEntityId || this.entityId === targetEntityId;
  }

  private getPortChevronSprite(index: number): Sprite {
    const existingSprite = this.portChevronSprites[index];

    if (existingSprite !== undefined) {
      return existingSprite;
    }

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.portOverlayRoot.addChild(sprite);
    this.portChevronSprites[index] = sprite;
    return sprite;
  }

  private hidePortChevronSprites(): void {
    for (const sprite of this.portChevronSprites) {
      sprite.visible = false;
    }
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
    applyCenteredSpriteLayout(this.previewMask, normalizedLayout)
    applyCenteredSpriteLayout(this.selectionMask, normalizedLayout)
    this.syncDeviceLabel(layout)
  }

}

function resolveDeviceDisplayName(
  definition: EntityDefinition,
  app: RenderHost["workspace"]["app"],
): string {
  const translated = app?.actions.translate(definition.nameKey);

  return translated && translated !== definition.nameKey ? translated : definition.id;
}

function shouldRenderDeviceLabel(definition: EntityDefinition): boolean {
  return !definition.tags.some((tag) => tag === "BeltFamily" || tag === "PipeFamily");
}

function createDeviceNameTextStyleKey(options: {
  useBlueprintStyle: boolean;
  fontSize: number;
  wordWrapWidth: number;
}): string {
  return [
    options.useBlueprintStyle ? "blueprint" : "default",
    options.fontSize.toFixed(2),
    options.wordWrapWidth.toFixed(2),
  ].join(":");
}

function createDeviceNameTextStyle(options: {
  useBlueprintStyle: boolean;
  fontSize: number;
  wordWrapWidth: number;
}): TextStyleOptions {
  if (options.useBlueprintStyle) {
    return {
      fontFamily: "sans-serif",
      fontSize: options.fontSize,
      fontWeight: "600",
      fill: DEVICE_LABEL_BLUEPRINT_TEXT_COLOR,
      align: "center",
      wordWrap: true,
      wordWrapWidth: options.wordWrapWidth,
      lineHeight: options.fontSize * DEVICE_LABEL_LINE_HEIGHT_RATIO,
    };
  }

  return {
    fontFamily: "sans-serif",
    fontSize: options.fontSize,
    fontWeight: "600",
    fill: DEVICE_LABEL_DEFAULT_TEXT_COLOR,
    align: "center",
    wordWrap: true,
    wordWrapWidth: options.wordWrapWidth,
    lineHeight: options.fontSize * DEVICE_LABEL_LINE_HEIGHT_RATIO,
    stroke: {
      color: DEVICE_LABEL_DEFAULT_STROKE_COLOR,
      width: Math.max(1, Math.round(options.fontSize * 0.16)),
      alpha: 0.42,
    },
    dropShadow: {
      color: DEVICE_LABEL_DEFAULT_STROKE_COLOR,
      alpha: 0.32,
      blur: 2,
      distance: 1,
      angle: Math.PI / 2,
    },
  };
}

function resolveDeviceLabelLayout(options: {
  layout: RenderSpriteLayout;
  showDeviceIcon: boolean;
  showDeviceName: boolean;
}): {
  icon: {
    x: number;
    y: number;
    size: number;
  };
  text: {
    x: number;
    y: number;
    fontSize: number;
    maxWidth: number;
  };
} {
  const { layout, showDeviceIcon, showDeviceName } = options;
  const centerX = layout.x + layout.width / 2;
  const centerY = layout.y + layout.height / 2;
  const iconSize = showDeviceIcon ? DEVICE_LABEL_ICON_SIZE : 0;
  const fontSize = DEVICE_LABEL_FONT_SIZE;
  const lineHeight = showDeviceName ? fontSize * DEVICE_LABEL_LINE_HEIGHT_RATIO : 0;
  const gap = showDeviceIcon && showDeviceName ? DEVICE_LABEL_GAP : 0;
  const totalHeight = iconSize + gap + lineHeight;
  const top = centerY - totalHeight / 2;
  const iconY = showDeviceIcon
    ? top + iconSize / 2
    : centerY;
  const textY = showDeviceName
    ? top + iconSize + gap + lineHeight / 2
    : centerY;

  return {
    icon: {
      x: centerX,
      y: iconY,
      size: iconSize,
    },
    text: {
      x: centerX,
      y: textY,
      fontSize,
      maxWidth: Math.max(24, layout.width * DEVICE_LABEL_TEXT_WIDTH_RATIO),
    },
  };
}

function isOnlyEntityInCollection(
  collection: {
    readonly length: number;
    contains(entityId: string): boolean;
  },
  entityId: string,
): boolean {
  return collection.length === 1 && collection.contains(entityId);
}

function resolvePortChevronSpecs(options: {
  definition: EntityDefinition;
  layout: RenderSpriteLayout;
  directionFilter?: "input" | "output" | null;
}): {
  textureKey: PortChevronTextureKey;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}[] {
  const specs: {
    textureKey: PortChevronTextureKey;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[] = [];
  for (const portGroup of options.definition.portGroups) {
    // 按方向过滤：bidirectional 端口在两个方向都显示
    if (options.directionFilter) {
      if (
        portGroup.direction !== options.directionFilter
        && portGroup.direction !== "bidirectional"
      ) {
        continue;
      }
    }

    const material = resolvePortChevronMaterial(options.definition, portGroup);
    const direction = resolvePortChevronDirection(portGroup.direction);
    const textureKey = `${material}-${direction}` as PortChevronTextureKey;

    for (const port of portGroup.ports) {
      const chevronLayout = resolvePortChevronLayout({
        footprint: options.definition.footprint,
        layout: options.layout,
        port,
      });

      if (chevronLayout === null) {
        continue;
      }

      specs.push({
        textureKey,
        ...chevronLayout,
      });
    }
  }

  return specs;
}

function resolvePortChevronMaterial(
  definition: EntityDefinition,
  portGroup: PortGroupDefinition,
): PortChevronMaterial {
  if (portGroup.kind === "fluid") {
    return "liquid";
  }

  const storageSlotGroupById = new Map(
    definition.storageSlotGroups.map((slotGroup) => [
      slotGroup.id,
      slotGroup,
    ]),
  );

  for (const binding of definition.portStorageBindings) {
    if (binding.portGroupId !== portGroup.id) {
      continue;
    }

    const storageSlotGroup = storageSlotGroupById.get(binding.storageSlotGroupId);

    if (storageSlotGroup === undefined) {
      continue;
    }

    if (storageSlotGroup.kind === "fluid") {
      return "liquid";
    }

    if (storageSlotGroup.slots.some((slot) => slot.itemFilterType === "liquid")) {
      return "liquid";
    }
  }

  return "solid";
}

function resolvePortChevronDirection(
  direction: PortGroupDefinition["direction"],
): PortChevronDirection {
  return direction === "output" ? "output" : "input";
}

function resolvePortChevronTextureResourceKey(
  key: PortChevronTextureKey,
  useMobile: boolean,
): string {
  const [material, direction] = key.split("-") as [
    PortChevronMaterial,
    PortChevronDirection,
  ];

  const suffix = useMobile ? "-mobile" : "";
  return `texture-${material}-port-chevron-${direction}${suffix}`;
}

function resolvePortChevronLayout(options: {
  footprint: GridRectSize;
  layout: RenderSpriteLayout;
  port: PortDefinition;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} | null {
  const rotatedFootprint = getRotatedGridFootprint(
    options.footprint,
    options.layout.rotation,
  );
  const gridCellPixelSize = resolveLayoutGridCellPixelSize(
    options.layout,
    rotatedFootprint,
  );

  if (gridCellPixelSize === null) {
    return null;
  }

  const portCell = rotateLocalPortCell({
    footprint: options.footprint,
    port: options.port,
    rotation: options.layout.rotation,
  });
  const edge = rotatePortEdge(options.port.edge, options.layout.rotation);
  const outsideCell = resolveOutsidePortCell(portCell, edge);

  return {
    x: options.layout.x + (outsideCell.x + 0.5) * gridCellPixelSize,
    y: options.layout.y + (outsideCell.y + 0.5) * gridCellPixelSize,
    width: gridCellPixelSize,
    height: gridCellPixelSize,
    rotation: resolvePortChevronRotation(edge),
  };
}

function resolveLayoutGridCellPixelSize(
  layout: RenderSpriteLayout,
  footprint: GridRectSize,
): number | null {
  if (footprint.width <= 0 || footprint.height <= 0) {
    return null;
  }

  const widthSize = layout.width / footprint.width;
  const heightSize = layout.height / footprint.height;

  if (!Number.isFinite(widthSize) || !Number.isFinite(heightSize)) {
    return null;
  }

  if (widthSize <= 0 || heightSize <= 0) {
    return null;
  }

  return (widthSize + heightSize) / 2;
}

function rotateLocalPortCell(options: {
  footprint: GridRectSize;
  port: PortDefinition;
  rotation: GridRotation;
}): {
  x: number;
  y: number;
} {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;

  switch (options.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
}

function rotatePortEdge(edge: PortEdge, rotation: GridRotation): PortEdge {
  const steps = rotation / 90;
  const edges: readonly PortEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
  const currentIndex = edges.indexOf(edge);
  const nextIndex = (currentIndex + steps) % edges.length;
  return edges[nextIndex] ?? edge;
}

function resolveOutsidePortCell(
  portCell: {
    x: number;
    y: number;
  },
  edge: PortEdge,
): {
  x: number;
  y: number;
} {
  switch (edge) {
    case "NORTH":
      return { x: portCell.x, y: portCell.y - 1 };
    case "EAST":
      return { x: portCell.x + 1, y: portCell.y };
    case "SOUTH":
      return { x: portCell.x, y: portCell.y + 1 };
    case "WEST":
      return { x: portCell.x - 1, y: portCell.y };
  }
}

function resolvePortChevronRotation(edge: PortEdge): number {
  switch (edge) {
    case "NORTH":
      return 0;
    case "EAST":
      return 90 * DEGREE_TO_RADIAN;
    case "SOUTH":
      return 180 * DEGREE_TO_RADIAN;
    case "WEST":
      return 270 * DEGREE_TO_RADIAN;
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

function resolveFlowGlowBorderWidth(layout: Pick<RenderSpriteLayout, "width" | "height">): number {
  const width = Math.max(layout.width, layout.height) * 0.08;

  return Math.max(
    FLOW_GLOW_BORDER_MIN_WIDTH,
    Math.min(FLOW_GLOW_BORDER_MAX_WIDTH, width),
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
