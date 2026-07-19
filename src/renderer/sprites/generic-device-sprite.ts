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
import {
  getRotatedGridFootprint,
  rotateSpriteOffset,
  resolveSpriteGridRect,
} from "@/shared/geometry/grid"
import { WORLD_GRID_CELL_PIXEL_SIZE, resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform"
import type { GridRectSize, GridRotation } from "@/domain/shared/grid"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url"
import {
  readSimplifiedDeviceIconPreference,
  resolveDeviceBodyTextureKey,
  resolveDeviceLabelIconTextureKey,
  resolveDeviceMaskTextureKey,
} from "@/renderer/sprites/device-texture-key"
import { applyBitmapTextureConfig, type RenderTextureConfig } from "@/renderer/texture/texture-config"
import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180

const BLUEPRINT_SPRITE_TEXTURE_PREFIX = "blueprint-sprite-"
const BLUEPRINT_MASK_TEXTURE_PREFIX = "blueprint-masks-"
const FORCE_BLUEPRINT_PREVIEW_DEFINITION_IDS = new Set([
  "log_splitter",
  "log_converger",
  "log_connector",
  "log_admission",
  "pipe_splitter",
  "pipe_converger",
  "pipe_connector",
  "pipe_admission",
])

const DEFAULT_GHOST_ROOT_ALPHA = 0.2;
const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

const SCANLINE_TEXTURE_PATH = createPublicAssetUrl("textures/scanline-45deg-50opacity.png");
/** 扫描线超出设备边界的像素 padding（按 tile 个数 × 纹理原始宽度） */
const SCANLINE_PADDING_TILES = 2;
const SCANLINE_SCROLL_INTERVAL_MS = 2000;

// AI-REMOVED 2026-06-14:
// Reason: selection 不再使用 blueprint-mask 纹理，改为 scanline
// Trigger: 用户需求"线框+扫描线线"
// Replacement: drawSelectionOverlay 走 scanline 路径
// Risk: Low
// Human Review: Not Required
//
// Original code:
// const BLUEPRINT_MASK_TEXTURE_PATH = "/textures/blueprint-mask-50opacity.png";
const PREVIEW_BORDER_WIDTH = 1;
const PREVIEW_BORDER_ALPHA = 0.5;

// ---- Fallback 精灵纹理 ----
const FALLBACK_SPRITE_TEXTURE_PATH = createPublicAssetUrl("textures/missing-sprite-texture.png");
/** Fallback 纹理生成时每格像素密度（世界像素） */
const FALLBACK_PX_PER_CELL = 128;
/** Footprint 内收 padding（世界像素） */
const FALLBACK_PADDING = 5;
/** 描边宽度（世界像素） */
const FALLBACK_STROKE = 2;

export const DEVICE_LABEL_ICON_SIZE = 14;
const DEVICE_LABEL_FONT_SIZE = 8;

// ---- 主要产物图标 ----
/** 预生成的圆圈纹理尺寸（px），所有实例共享 */
const PRIMARY_OUTPUT_CIRCLE_TEXTURE_SIZE = 64;
/** 预生成的加号纹理尺寸（px） */
const PRIMARY_OUTPUT_PLUS_TEXTURE_SIZE = 32;

/** 加号宽度占圆圈外径的比例 */
const PRIMARY_OUTPUT_PLUS_WIDTH_RATIO = 0.3;
/** 圆圈描边颜色 */
const PRIMARY_OUTPUT_CIRCLE_STROKE = 0x333333;
/** 圆圈描边宽度（px，在 64px 纹理上的值） */
const PRIMARY_OUTPUT_CIRCLE_STROKE_WIDTH = 2;

let cachedCircleTexture: Texture | null = null;
export function getPrimaryOutputCircleTexture(textureConfig: RenderTextureConfig): Texture {
  if (cachedCircleTexture === null) {
    const size = PRIMARY_OUTPUT_CIRCLE_TEXTURE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const radius = size / 2 - PRIMARY_OUTPUT_CIRCLE_STROKE_WIDTH / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = `#${PRIMARY_OUTPUT_CIRCLE_STROKE.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = PRIMARY_OUTPUT_CIRCLE_STROKE_WIDTH;
    ctx.stroke();
    cachedCircleTexture = Texture.from(canvas);
    applyBitmapTextureConfig(cachedCircleTexture, textureConfig);
  }
  return cachedCircleTexture;
}

let cachedPlusTexture: Texture | null = null;
function getPrimaryOutputPlusTexture(textureConfig: RenderTextureConfig): Texture {
  if (cachedPlusTexture === null) {
    const size = PRIMARY_OUTPUT_PLUS_TEXTURE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const fontSize = Math.round(size * 0.75);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = `#${PRIMARY_OUTPUT_CIRCLE_STROKE.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 3;
    ctx.strokeText("+", size / 2, size / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("+", size / 2, size / 2);
    cachedPlusTexture = Texture.from(canvas);
    applyBitmapTextureConfig(cachedPlusTexture, textureConfig);
  }
  return cachedPlusTexture;
}
const DEVICE_LABEL_TEXT_WIDTH_RATIO = 0.88;
const DEVICE_LABEL_MIN_TEXT_WIDTH = 24;
const DEVICE_LABEL_GAP = 2;
const DEVICE_LABEL_LINE_HEIGHT_RATIO = 1.16;
const DEVICE_LABEL_DEFAULT_TEXT_COLOR = 0xffffff;
const DEVICE_LABEL_DEFAULT_STROKE_COLOR = 0x20242a;
const DEVICE_LABEL_BLUEPRINT_TEXT_COLOR = 0x111111;

// AI-REMOVED 2026-06-14:
// Reason: 边缘流光特效已移除
// Trigger: 用户需求"不再做流光特效"
// Replacement: None
// Risk: Low
// Human Review: Not Required
//
// Original code:
// const FLOW_GLOW_TEXTURE_PATH = "/textures/flow-glow.png";
// AI-REMOVED 2026-06-14:
// Reason: 未使用，ESLint no-unused-vars；resolveFlowGlowBorderWidth 被注释删除后无引用
// Trigger: ESLint 检查报错（resolveFlowGlowBorderWidth 注释后级联暴露）
// Evidence: 全局搜索仅在被注释的 resolveFlowGlowBorderWidth 中有引用
// Replacement: None
// Risk: Low — 边缘流光线宽参数，等待流光功能实现后恢复
// Human Review: Not Required
//
// Original code:
// /** 边缘流光内边框粗细（px），默认 5px */
// /** 2026-05-05: 现改为动态计算后的上限值，真实线宽按实体渲染后最长边的 8% 决定，并夹取到 1-5px。 */
// const FLOW_GLOW_BORDER_MAX_WIDTH = 5;
// const FLOW_GLOW_BORDER_MIN_WIDTH = 1;
// AI-REMOVED 2026-06-14:
// Reason: 未使用，ESLint no-unused-vars
// Trigger: ESLint 检查报错
// Evidence: 全局搜索无引用，功能可能未实现或重构遗留
// Replacement: None
// Risk: Low — 仅用于流光滑动动画，当前无调用者
// Human Review: Not Required
//
// Original code:
// /** 流光滑动周期（ms） */
// const FLOW_GLOW_SCROLL_INTERVAL_MS = 5000;

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

type PortKind = "item" | "fluid";

interface AppWithLogisticsPlacementRuntime {
  internalState: {
    runtime: {
      logisticsPlacement: {
        kind: "belt" | "pipe" | null;
      };
    };
  };
}

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly spriteId: string
  private readonly body: Sprite
  private readonly previewEffectRoot: Container
  private readonly previewMask: Sprite
  private readonly deviceLabelRoot: Container
  private readonly deviceIcon: Sprite
  private readonly deviceNameText: Text
  private currentLayout: RenderSpriteLayout | null = null
  /** 足迹（不含 spriteOffset）在视口中的布局，用于绘制线框。仅有 spriteOffset 的设备才需要计算。 */
  /** AI-CORRECTION 2026-07-11: 该布局现在也作为设备信息层的居中基准，避免图标/名称跟随偏移后的精灵中心。 */
  private currentFootprintLayout: { x: number; y: number; width: number; height: number } | null = null
  private disposed = false
  private isTextureReady = false
  private currentBodyTextureKey: string | null = null
  private currentMaskTextureKey: string | null = null
  private currentDeviceIconTextureKey: string | null = null
  private currentDeviceNameText: string | null = null
  private currentDeviceNameStyleKey: string | null = null
  private currentGridCellPixelSize = WORLD_GRID_CELL_PIXEL_SIZE
  private textureLoadVersion = 0
  private deviceIconLoadVersion = 0
  private isDeviceIconReady = false

  /** 扫描线 TilingSprite，完全由 GenericDeviceSprite 自己管理 */
  protected readonly scanlineTiling: TilingSprite;
  private scanlineTexture: Texture | null = null;
  private scanlineLoadStarted = false;

  /** 蓝图模式下扫描线的矩形遮罩，替代 previewMask 纹理遮罩 */
  private readonly scanlineRectMask: Graphics;

  /** preview 白色固定宽度边框线 */
  private readonly previewBorderGraphics: Graphics;

  /** selection 特效：blueprint mask 平铺 + device mask 裁剪 */
  /** AI-CORRECTION 2026-05-10: 开启蓝图样式设备图片后，此处裁剪遮罩改为 blueprint-view/sprite-masks；关闭时仍使用 device mask。 */
  private readonly selectionEffectRoot: Container;
  private readonly selectionMask: Sprite;
  protected readonly selectionTiling: TilingSprite;
  private selectionTexture: Texture | null = null;
  private selectionTextureLoadStarted = false;

  /** 蓝图模式下框选特效的矩形遮罩，替代 selectionMask 纹理遮罩 */
  private readonly selectionRectMask: Graphics;

  // AI-REMOVED 2026-06-14:
  // Reason: 边缘流光特效改为扫描线+线框方案
  // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
  // Evidence: 单选改用 drawSelectionOverlay (扫描线+drawCollectionOverlayStroke)
  // Replacement: selection 特效统一走 drawSelectionOverlay 的扫描线+线框路径
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // /** 边缘流光特效 */
  // private readonly flowGlowEffectRoot: Container;
  // /** 内边框底色 Graphics */
  // private readonly flowGlowBorderGraphics: Graphics;
  // /** 矩形遮罩 Graphics，将流光裁剪到设备矩形区域内 */
  // private readonly flowGlowMask: Graphics;
  // /** 扇形光束 TilingSprite，从设备中心旋转，纹理平铺填充 */
  // private readonly flowGlowBeam: TilingSprite;
  // private flowGlowTexture: Texture | null = null;
  // private flowGlowTextureLoadStarted = false;

  private defaultCollectionOverlayGraphics: Graphics | null = null;

  private readonly portOverlayRoot: Container;
  private readonly portChevronSprites: Sprite[] = [];
  private readonly portChevronTextures = new Map<PortChevronTextureKey, Texture>();
  private portChevronTextureLoadStarted = false;
  private portChevronTexturesUseMobile: boolean | null = null;
  private arePortChevronTexturesReady = false;

  private readonly portCrossSprites: Sprite[] = [];
  private portCrossTexture: Texture | null = null;
  private portCrossTextureLoadStarted = false;
  private portCrossTextureUseMobile: boolean | null = null;
  private isPortCrossTextureReady = false;

  /** 主要产物图标根容器，放置在 deviceLabelRoot 内。仿真运行时，若有主产物则替换 deviceIcon 显示 */
  private readonly primaryOutputRoot: Container;
  private readonly primaryOutputCircleSprites: Sprite[] = [];
  private readonly primaryOutputPlusSprites: Sprite[] = [];
  private readonly primaryOutputItemIconSprites: Sprite[] = [];
  private currentPrimaryOutputItemIds: string[] | null = null;

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

    // 主要产物图标容器：仿真正运行时替换 deviceIcon
    this.primaryOutputRoot = new Container()
    this.primaryOutputRoot.visible = false
    this.deviceLabelRoot.addChild(this.primaryOutputRoot)

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

    // 蓝图模式下扫描线的矩形遮罩，不参与可见渲染
    this.scanlineRectMask = new Graphics({ roundPixels: true });
    this.scanlineRectMask.renderable = false;

    // preview 白色固定边框线，位于扫描线之上
    this.previewBorderGraphics = new Graphics({ roundPixels: true });
    this.previewBorderGraphics.visible = false;

    this.previewEffectRoot.addChild(this.scanlineTiling)
    this.previewEffectRoot.addChild(this.previewMask)
    this.previewEffectRoot.addChild(this.scanlineRectMask)
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

    // 蓝图模式下框选特效的矩形遮罩，不参与可见渲染
    this.selectionRectMask = new Graphics({ roundPixels: true });
    this.selectionRectMask.renderable = false;

    this.selectionEffectRoot.addChild(this.selectionTiling)
    this.selectionEffectRoot.addChild(this.selectionMask)
    this.selectionEffectRoot.addChild(this.selectionRectMask)
    this.getRootOfLayer("overlay").addChild(this.selectionEffectRoot)

    // AI-REMOVED 2026-06-14:
    // Reason: 边缘流光特效改为扫描线+线框方案
    // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
    // Evidence: 单选改用 drawSelectionOverlay (扫描线+drawCollectionOverlayStroke)
    // Replacement: selection 特效统一走 drawSelectionOverlay 的扫描线+线框路径
    // Risk: Low
    // Human Review: Not Required
    //
    // Original code:
    // // 边缘流光特效：内边框底色 + 扇形光束从中心旋转，矩形遮罩裁剪
    // this.flowGlowEffectRoot = new Container()
    // this.flowGlowEffectRoot.visible = false
    //
    // this.flowGlowBorderGraphics = new Graphics({ roundPixels: true });
    //
    // this.flowGlowMask = new Graphics({ roundPixels: true });
    // this.flowGlowEffectRoot.addChild(this.flowGlowMask);
    // this.flowGlowEffectRoot.mask = this.flowGlowMask;
    //
    // this.flowGlowBeam = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 });
    // this.flowGlowBeam.anchor.set(0.5);
    // this.flowGlowBeam.roundPixels = true;
    // this.flowGlowBeam.visible = false;
    //
    // this.flowGlowEffectRoot.addChild(this.flowGlowBorderGraphics);
    // this.flowGlowEffectRoot.addChild(this.flowGlowBeam);
    // this.getRootOfLayer("overlay").addChild(this.flowGlowEffectRoot);

    this.portOverlayRoot = new Container()
    this.portOverlayRoot.visible = false
    this.getRootOfLayer("overlay").addChild(this.portOverlayRoot)

    this.syncDeviceTextures()
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.currentLayout = layout
    this.currentGridCellPixelSize = this.resolveWorkspaceGridCellPixelSize(context)
    this.currentFootprintLayout = this.computeFootprintLayout(layout, context)
    this.syncDeviceTextures(context)

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
  }

  public syncRuntime(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void context
    this.syncDeviceLabel(layout)
  }

  public syncAnimation(context: RenderSpriteSyncContext): void {
    const tilePixelSize = this.scanlineTexture?.width ?? 64
    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS

    if (this.scanlineTiling.visible) {
      this.scanlineTiling.tilePosition.x = phase * tilePixelSize
    }
    if (this.selectionTiling.visible) {
      this.selectionTiling.tilePosition.x = phase * tilePixelSize
    }
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
    // AI-REMOVED 2026-06-14: 边缘流光特效已移除
    // this.flowGlowBorderGraphics.clear();
    // this.flowGlowEffectRoot.visible = false;
    this.portOverlayRoot.visible = false;
    this.hidePortChevronSprites();
    this.hidePortCrossSprites();
    // 隐藏主要产物
    this.primaryOutputRoot.visible = false;
    this.hidePrimaryOutputSprites();
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
    if (
      previewCollection
      && previewCollection.length > 1
      && !this.shouldForceBlueprintPreviewTexture(context)
    ) {
      this.drawSelectionOverlay(layout, context);
      return;
    }

    // 单元素 preview：使用白色系动画遮罩
    this.drawScanlineOverlay(layout, context);
  }

  private drawScanlineOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isTextureReady) {
      return;
    }

    this.loadScanlineTexture();

    // AI-CORRECTION 2026-06-09:
    // Reason: invalid 红色边框已统一迁移至 InvalidPlacementDecoration（基于 footprint 布局），
    // 精灵层 scanline overlay 不再根据 invalidPlacement 切换颜色，始终为白色预览特效。
    // 原始逻辑（2026-05-24 版）根据 invalidPlacement 切换白/红色，已被当前装饰层替代。
    const borderColor = 0xffffff;
    const scanlineTint = 0xffffff;

    // 以纹理原始像素尺寸平铺，不做 zoom 缩放
    const tilePixelSize = this.scanlineTexture?.width ?? 64;
    const paddingPixels = SCANLINE_PADDING_TILES * tilePixelSize;

    this.scanlineTiling.visible = true;
    this.scanlineTiling.x = layout.x + layout.width / 2;
    this.scanlineTiling.y = layout.y + layout.height / 2;
    this.scanlineTiling.rotation = 0;
    this.scanlineTiling.width = layout.width + paddingPixels * 2;
    this.scanlineTiling.height = layout.height + paddingPixels * 2;
    this.scanlineTiling.tint = scanlineTint;

    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS;
    this.scanlineTiling.tilePosition.x = phase * tilePixelSize;

    // 蓝图模式下使用 footprint 矩形遮罩，替代 blueprint-masks 纹理遮罩
    // 因为蓝图精灵是大块透明线框图，对应 mask 同样大面积透明，会错误裁剪扫描线
    // AI-CORRECTION 2026-05-25: Pixi v8 WebGL 下 Graphics 矩形 mask 会把蓝图样式的 TilingSprite 裁成不可见；现在直接用 TilingSprite 自身尺寸作为 footprint 矩形裁剪。
    if (readSimplifiedDeviceIconPreference(context.workspace.app)) {
      this.scanlineTiling.width = layout.width;
      this.scanlineTiling.height = layout.height;
      this.scanlineRectMask.clear();
      // AI-REMOVED 2026-05-25:
      // Reason: Pixi v8 WebGL 中该 Graphics mask 会导致蓝图样式扫描线完全不可见。
      // Trigger: 用户反馈采种机、种植机等蓝图样式设备在框选/预览时没有蓝图特效；Playwright 截图复现。
      // Evidence: 蓝图样式下 TilingSprite 本身已经按 footprint 矩形布局，移除 mask 后矩形特效不再依赖透明 sprite mask。
      // Replacement: 当前分支的 scanlineTiling.mask = null 与 width/height = layout 尺寸。
      // Risk: Low；蓝图样式扫描线不再带额外 padding，但可见区域符合 footprint 矩形。
      // Human Review: Required
      //
      // Original code:
      // this.scanlineRectMask
      //   .rect(layout.x, layout.y, layout.width, layout.height)
      //   .fill({ color: 0xffffff });
      // this.scanlineTiling.mask = this.scanlineRectMask;
      this.scanlineTiling.mask = null;
    } else {
      this.scanlineTiling.mask = this.previewMask;
    }

    // 固定宽度边框线，50% 不透明度。始终为白色预览边框，红色 invalid 边框由 InvalidPlacementDecoration 统一绘制。
    // 2026-06-14: 边框改用足迹布局（不含 spriteOffset），避免仓库等大偏移设备边框超出 footprint。
    this.previewBorderGraphics.visible = true;
    const borderLayout = this.currentFootprintLayout ?? layout;
    this.previewBorderGraphics
      .rect(borderLayout.x, borderLayout.y, borderLayout.width, borderLayout.height)
      .stroke({
        width: PREVIEW_BORDER_WIDTH,
        color: borderColor,
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

    // AI-REMOVED 2026-06-14:
    // Reason: 边缘流光特效改为扫描线+线框方案
    // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
    // Evidence: 单选/多选/marquee 统一走此路径
    // Replacement: 扫描线平铺 + drawCollectionOverlayStroke 线框
    // Risk: Low
    // Human Review: Not Required
    //
    // Original code (流光分支):
    // if (this.shouldDrawFlowGlowOverlay(context)) {
    //   this.drawFlowGlowOverlay(layout, context);
    //   return;
    // }

    // 加载扫描线纹理（与 preview 共用同一纹理）
    this.loadScanlineTexture();

    const tilePixelSize = this.scanlineTexture?.width ?? 64;

    this.selectionTiling.visible = true;
    this.selectionTiling.x = layout.x + layout.width / 2;
    this.selectionTiling.y = layout.y + layout.height / 2;
    this.selectionTiling.rotation = 0;
    this.selectionTiling.width = layout.width;
    this.selectionTiling.height = layout.height;
    this.selectionTiling.tint = 0xffffff;

    // 扫描线水平滚动（复用 SCANLINE_SCROLL_INTERVAL_MS 周期）
    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS;
    this.selectionTiling.tilePosition.x = phase * tilePixelSize;

    // 蓝图模式下使用 footprint 矩形遮罩，替代 blueprint-masks 纹理遮罩
    if (readSimplifiedDeviceIconPreference(context.workspace.app)) {
      this.selectionRectMask.clear();
      // AI-REMOVED 2026-05-25: 已由更早提交处理
      this.selectionTiling.mask = null;
    } else {
      this.selectionTiling.mask = this.selectionMask;
    }

    // 线框（足迹布局，不含 spriteOffset）
    const strokeLayout = this.currentFootprintLayout ?? layout;
    this.drawCollectionOverlayStroke({
      layout: { x: strokeLayout.x, y: strokeLayout.y, width: strokeLayout.width, height: strokeLayout.height, rotation: layout.rotation },
      color: this.resolveSelectionCollectionOverlayColor(context),
      width: this.resolveSelectionCollectionOverlayStrokeWidth(context),
    });

    this.selectionEffectRoot.visible = true;
  }

  protected afterSyncLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.syncDeviceLabel(layout);

    if (this.shouldDrawLogisticsEndpointOverlay(context)) {
      this.drawScanlineOverlay(layout, context);
    }

    // AI-CORRECTION 2026-06-18:
    // 端口箭头与红叉改由 PortOverlayDecoration 全局计算和绘制。
    // 旧方法保留用于删除审计，但不再由每个设备 sprite 重复执行端口拓扑判断。
    if (context.portOverlayManagedGlobally !== true) {
      this.syncPortOverlay(layout, context);
    }
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
      this.selectionTiling.texture = texture;
    }).catch(() => {
      // 扫描线纹理加载失败，无伤大雅
    });
  }

  private syncDeviceTextures(context?: RenderSpriteSyncContext): void {
    const forceBlueprintPreview = context !== undefined
      && this.shouldForceBlueprintPreviewTexture(context)
    const bodyTextureKey = forceBlueprintPreview
      ? `${BLUEPRINT_SPRITE_TEXTURE_PREFIX}${this.spriteId}`
      : resolveDeviceBodyTextureKey(
          this.spriteId,
          this.renderHost.workspace.app,
        )
    const maskTextureKey = forceBlueprintPreview
      ? `${BLUEPRINT_MASK_TEXTURE_PREFIX}${this.spriteId}`
      : resolveDeviceMaskTextureKey(
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

      // TextureManager 加载失败时返回 16×16 红色 fallback，Promise 不 reject。
      // 通过尺寸判断 body 纹理是否为 fallback，若是则走自定义 fallback 渲染。
      if (bodyTexture.width === 16 && bodyTexture.height === 16) {
        this.loadFallbackTexture(activeLoadVersion)
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

      this.loadFallbackTexture(activeLoadVersion)
    })
  }

  /**
   * 当设备 3D-top 精灵纹理加载失败时，使用 missing-sprite-texture.png 生成 fallback。
   * 按 footprint 比例裁剪原图（保持高度，左右均匀裁切），内收 padding 后外描边。
   */
  private async loadFallbackTexture(activeLoadVersion: number): Promise<void> {
    try {
      const img = new Image()
      img.src = FALLBACK_SPRITE_TEXTURE_PATH
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("Fallback image load failed"))
      })

      if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
        return
      }

      const footprint = this.definition.footprint
      const pxPerCell = FALLBACK_PX_PER_CELL
      const canvasW = footprint.width * pxPerCell
      const canvasH = footprint.height * pxPerCell

      // 按 footprint 比例裁剪：保持高度，左右均匀裁切
      const targetAspect = footprint.width / footprint.height
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      const iAspect = iw / ih
      let sx = 0, sy = 0, sw = iw, sh = ih

      if (iAspect > targetAspect) {
        // 原图更宽 → 裁左右
        sw = ih * targetAspect
        sx = (iw - sw) / 2
      } else {
        // 原图更高 → 裁上下
        sh = iw / targetAspect
        sy = (ih - sh) / 2
      }

      const padding = FALLBACK_PADDING
      const stroke = FALLBACK_STROKE

      // Body Canvas：裁剪后的图 → padding → 描边
      const bodyCanvas = document.createElement("canvas")
      bodyCanvas.width = canvasW
      bodyCanvas.height = canvasH
      const bctx = bodyCanvas.getContext("2d")!
      bctx.drawImage(img, sx, sy, sw, sh, padding, padding, canvasW - padding * 2, canvasH - padding * 2)
      bctx.strokeStyle = "#000000"
      bctx.lineWidth = stroke
      bctx.strokeRect(padding, padding, canvasW - padding * 2, canvasH - padding * 2)

      const bodyTexture = Texture.from(bodyCanvas)

      // Mask Canvas：白色矩形（与 body 同尺寸，用于 scanline 矩形裁剪）
      const maskCanvas = document.createElement("canvas")
      maskCanvas.width = canvasW
      maskCanvas.height = canvasH
      const mctx = maskCanvas.getContext("2d")!
      mctx.fillStyle = "#ffffff"
      mctx.fillRect(0, 0, canvasW, canvasH)
      const maskTexture = Texture.from(maskCanvas)

      this.body.texture = bodyTexture
      this.previewMask.texture = maskTexture
      this.selectionMask.texture = maskTexture
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
      }
    } catch {
      // Fallback 也失败了，回退到隐藏设备
      if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
        return
      }

      this.body.visible = false
      this.previewEffectRoot.visible = false
      this.selectionEffectRoot.visible = false
      this.portOverlayRoot.visible = false
      this.deviceLabelRoot.visible = false
      this.hidePortChevronSprites()
    }
  }

  private syncDeviceLabel(layout: RenderSpriteLayout): void {
    const app = this.renderHost.workspace.app;
    if (!shouldRenderDeviceLabel(this.definition)) {
      this.deviceLabelRoot.visible = false;
      this.deviceIcon.visible = false;
      this.deviceNameText.visible = false;
      this.primaryOutputRoot.visible = false;
      return;
    }

    const useBlueprintStyle = app?.state.settings.gameUseBlueprintStyleDeviceImages ?? false;
    const avatarHidden = this.definition.tags.includes("AvatarHidden");
    const showDeviceName = avatarHidden ? false : (app?.state.settings.gameShowDeviceNames ?? true);
    const showDeviceIconSetting = avatarHidden ? false : (app?.state.settings.gameShowDeviceIcons ?? false);

    // 仿真正运行中：尝试获取主要产物
    const primaryOutputIds = this.resolvePrimaryOutputItemIds();

    // 主要产物存在 → 始终显示（不受 showDeviceIcon 设置控制）
    const hasPrimaryOutput = primaryOutputIds !== null && primaryOutputIds.length > 0;

    if (!this.isTextureReady || (!showDeviceName && !showDeviceIconSetting && !hasPrimaryOutput)) {
      this.deviceLabelRoot.visible = false;
      this.deviceIcon.visible = false;
      this.deviceNameText.visible = false;
      this.primaryOutputRoot.visible = false;
      return;
    }

    const effectiveShowIcon = hasPrimaryOutput || showDeviceIconSetting;
    const labelAnchorLayout = this.currentFootprintLayout ?? layout;
    const labelLayout = resolveDeviceLabelLayout({
      layout: labelAnchorLayout,
      showDeviceIcon: effectiveShowIcon,
      showDeviceName,
      gridCellPixelSize: this.currentGridCellPixelSize,
    });

    this.deviceLabelRoot.visible = true;

    // 处理图标区域：主要产物 或 普通设备图标
    if (hasPrimaryOutput) {
      this.deviceIcon.visible = false;
      this.syncPrimaryOutputSprites(primaryOutputIds, labelLayout);
    } else if (showDeviceIconSetting) {
      this.primaryOutputRoot.visible = false;
      this.hidePrimaryOutputSprites();
      this.syncDeviceIconTexture();
      this.deviceIcon.x = labelLayout.icon.x;
      this.deviceIcon.y = labelLayout.icon.y;
      this.deviceIcon.width = labelLayout.icon.size;
      this.deviceIcon.height = labelLayout.icon.size;
      this.deviceIcon.rotation = 0;
      this.deviceIcon.visible = this.isDeviceIconReady;
    } else {
      this.deviceIcon.visible = false;
      this.primaryOutputRoot.visible = false;
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
      this.definition.spriteId,
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

  // ---- 主要产物图标 ----

  /**
   * 查询仿真运行时该设备正在执行的配方的 primaryOutputs。
   * 返回 null 表示无主要产物可显示（仿真未运行 / 无运行中配方 / 配方无 primaryOutputs）。
   */
  private resolvePrimaryOutputItemIds(): string[] | null {
    const simulation = this.renderHost.workspace.simulation;
    if (!simulation || simulation.state.runningState === "stop") {
      return null;
    }

    const status = simulation.queries.getDeviceRuntimeStatus(this.entityId);
    if (!status) {
      return null;
    }

    const channelRecipes = status.channelRecipes;
    if (!channelRecipes) {
      return null;
    }

    const recipeDefs = this.renderHost.workspace.registry.recipeDefinitions;

    for (const channelKey of Object.keys(channelRecipes)) {
      const channel = channelRecipes[channelKey];
      if (!channel || !channel.recipeId) {
        continue;
      }

      // 仅处理正在运行的 channel（running 或 waiting-output）
      if (channel.state !== "running" && channel.state !== "waiting-output") {
        continue;
      }

      const recipe = recipeDefs.find((r) => r.id === channel.recipeId);
      if (recipe && recipe.primaryOutputs && recipe.primaryOutputs.length > 0) {
        return recipe.primaryOutputs;
      }
    }

    return null;
  }

  private syncPrimaryOutputSprites(
    itemIds: string[],
    labelLayout: ReturnType<typeof resolveDeviceLabelLayout>,
  ): void {
    const iconSize = labelLayout.icon.size;
    const circleRadius = iconSize / 2;
    const textureConfig = this.renderHost.internalState.textureConfig as RenderTextureConfig;
    const circleTex = getPrimaryOutputCircleTexture(textureConfig);
    const plusTex = getPrimaryOutputPlusTexture(textureConfig);
    // 物品图标内接于圆：正方形边长 = 直径 / √2，再 -4px 减少空白
    const itemIconInsideSize = Math.max(4, Math.floor(iconSize / Math.SQRT2) - 4);
    const plusWidth = iconSize * PRIMARY_OUTPUT_PLUS_WIDTH_RATIO;
    const gapWidth = iconSize * 0.04;
    const totalWidth = itemIds.length * iconSize + (itemIds.length - 1) * (plusWidth + gapWidth * 2);
    const startX = labelLayout.icon.x - totalWidth / 2;
    const centerY = labelLayout.icon.y;

    // 如果主产物列表变化，清理旧状态
    if (!this.currentPrimaryOutputItemIds
      || this.currentPrimaryOutputItemIds.length !== itemIds.length
      || this.currentPrimaryOutputItemIds.some((id, i) => id !== itemIds[i])
    ) {
      this.currentPrimaryOutputItemIds = itemIds;
      // 重置 item icon 加载版本，触发重新加载
      this.primaryOutputIconLoadVersions = itemIds.map(() => 0);
    }

    let xOffset = 0;

    for (let i = 0; i < itemIds.length; i += 1) {
      const itemId = itemIds[i]!;
      const cx = startX + xOffset + circleRadius;

      // 圆圈精灵
      const circleSprite = this.getPrimaryOutputCircleSprite(i);
      circleSprite.texture = circleTex;
      circleSprite.x = cx;
      circleSprite.y = centerY;
      circleSprite.width = iconSize;
      circleSprite.height = iconSize;
      circleSprite.anchor.set(0.5);
      circleSprite.visible = true;

      // 物品图标精灵
      this.syncPrimaryOutputItemIcon(i, itemId, cx, centerY, itemIconInsideSize);

      xOffset += iconSize;

      // 加号（如果还有下一个）
      if (i < itemIds.length - 1) {
        xOffset += gapWidth;
        const plusSprite = this.getPrimaryOutputPlusSprite(i);
        plusSprite.texture = plusTex;
        plusSprite.x = startX + xOffset + plusWidth / 2;
        plusSprite.y = centerY;
        plusSprite.width = plusWidth;
        plusSprite.height = plusWidth;
        plusSprite.anchor.set(0.5);
        plusSprite.visible = true;
        xOffset += plusWidth + gapWidth;
      }
    }

    // 隐藏多余的精灵
    for (let i = itemIds.length; i < this.primaryOutputCircleSprites.length; i += 1) {
      const s = this.primaryOutputCircleSprites[i];
      if (s) s.visible = false;
    }
    for (let i = itemIds.length; i < this.primaryOutputItemIconSprites.length; i += 1) {
      const s = this.primaryOutputItemIconSprites[i];
      if (s) s.visible = false;
    }
    for (let i = itemIds.length - 1; i < this.primaryOutputPlusSprites.length; i += 1) {
      const s = this.primaryOutputPlusSprites[i];
      if (s) s.visible = false;
    }

    this.primaryOutputRoot.visible = true;
  }

  private primaryOutputIconLoadVersions: number[] = [];

  private syncPrimaryOutputItemIcon(
    index: number,
    itemId: string,
    cx: number,
    cy: number,
    size: number,
  ): void {
    const sprite = this.getPrimaryOutputItemIconSprite(index);
    const textureKey = `item-icon-${itemId}`;
    const loadVersion = (this.primaryOutputIconLoadVersions[index] ?? 0);

    // 设置位置和大小（即使纹理尚未加载，也先布局）
    sprite.x = cx;
    sprite.y = cy;
    sprite.width = size;
    sprite.height = size;
    sprite.anchor.set(0.5);

    // 如果当前位置已有正确纹理，直接显示
    if (sprite.texture !== Texture.EMPTY
      && this.currentPrimaryOutputItemIds?.[index] === itemId
    ) {
      sprite.visible = true;
      return;
    }

    // 启动异步加载
    const activeVersion = loadVersion + 1;
    this.primaryOutputIconLoadVersions[index] = activeVersion;

    void this.renderHost.textureManager.getTexture(textureKey).then((texture) => {
      if (
        this.disposed
        || this.primaryOutputIconLoadVersions[index] !== activeVersion
        || this.currentPrimaryOutputItemIds?.[index] !== itemId
      ) {
        return;
      }

      sprite.texture = texture;
      sprite.visible = true;
    }).catch(() => {
      if (this.disposed || this.primaryOutputIconLoadVersions[index] !== activeVersion) {
        return;
      }
      sprite.visible = false;
    });
  }

  private getPrimaryOutputCircleSprite(index: number): Sprite {
    const existing = this.primaryOutputCircleSprites[index];
    if (existing) return existing;

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.primaryOutputRoot.addChild(sprite);
    this.primaryOutputCircleSprites[index] = sprite;
    return sprite;
  }

  private getPrimaryOutputPlusSprite(index: number): Sprite {
    const existing = this.primaryOutputPlusSprites[index];
    if (existing) return existing;

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.primaryOutputRoot.addChild(sprite);
    this.primaryOutputPlusSprites[index] = sprite;
    return sprite;
  }

  private getPrimaryOutputItemIconSprite(index: number): Sprite {
    const existing = this.primaryOutputItemIconSprites[index];
    if (existing) return existing;

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.primaryOutputRoot.addChild(sprite);
    this.primaryOutputItemIconSprites[index] = sprite;
    return sprite;
  }

  private hidePrimaryOutputSprites(): void {
    for (const sprite of this.primaryOutputCircleSprites) {
      sprite.visible = false;
    }
    for (const sprite of this.primaryOutputPlusSprites) {
      sprite.visible = false;
    }
    for (const sprite of this.primaryOutputItemIconSprites) {
      sprite.visible = false;
    }
  }

  // AI-REMOVED 2026-06-14:
  // Reason: selection 不再使用 blueprint-mask 纹理，改为 scanline 扫描线
  // Trigger: 用户需求"线框+扫描线线"
  // Replacement: drawSelectionOverlay 直接调用 loadScanlineTexture() 加载扫描线纹理
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // private loadSelectionTexture(): void {
  //   if (this.selectionTextureLoadStarted) {
  //     return;
  //   }
  //
  //   this.selectionTextureLoadStarted = true;
  //
  //   void Assets.load<Texture>(BLUEPRINT_MASK_TEXTURE_PATH).then((texture) => {
  //     if (this.disposed) {
  //       return;
  //     }
  //
  //     this.selectionTexture = texture;
  //     this.selectionTiling.texture = texture;
  //   }).catch(() => {
  //     // blueprint mask 纹理加载失败，无伤大雅
  //   });
  // }

  // AI-REMOVED 2026-06-14:
  // Reason: 边缘流光特效改为扫描线+线框方案
  // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
  // Replacement: None；selection 统一走 drawSelectionOverlay 的扫描线+线框路径
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // private shouldDrawFlowGlowOverlay(context: RenderSpriteSyncContext): boolean {
  //   const collections = context.workspace.editor?.state.collections;
  //   if (!collections) {
  //     return false;
  //   }
  //
  //   // 只有自己处于 selection 中
  //   const selectionCollection = collections[EntityCollectionType.selection];
  //   if (!isOnlyEntityInCollection(selectionCollection, this.entityId)) {
  //     return false;
  //   }
  //
  //   // 不是 marquee 模式
  //   const activeTool = context.workspace.app?.state.activeTool;
  //   if (activeTool === "marquee" || activeTool === "move") {
  //     return false;
  //   }
  //
  //   return true;
  // }

  // AI-REMOVED 2026-06-14:
  // Reason: 边缘流光特效改为扫描线+线框方案
  // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
  // Replacement: None；selection 统一走 drawSelectionOverlay 的扫描线+线框路径
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // private drawFlowGlowOverlay(
  //   layout: RenderSpriteLayout,
  //   context: RenderSpriteSyncContext,
  // ): void {
  //   if (!this.isTextureReady) {
  //     return;
  //   }
  //
  //   this.loadFlowGlowTexture();
  //
  //   const bw = resolveFlowGlowBorderWidth(layout);
  //   const x0 = layout.x;
  //   const y0 = layout.y;
  //   const w = layout.width;
  //   const h = layout.height;
  //   const cx = x0 + w / 2;
  //   const cy = y0 + h / 2;
  //   const halfBw = bw / 2;
  //
  //   // 1. 内边框底色（向内缩进半线宽 stroke）
  //   this.flowGlowBorderGraphics.clear();
  //   const strokeColor = resolveAppThemeColorNumber(
  //     context.theme,
  //     context.theme.renderer.flowGlowStrokeColorKey,
  //   );
  //   this.flowGlowBorderGraphics
  //     .rect(x0 + halfBw, y0 + halfBw, w - bw, h - bw)
  //     .stroke({ width: bw, color: strokeColor });
  //
  //   // 2. 矩形边框环遮罩：光束只在边缘边框区域可见（挖空内部）
  //   this.flowGlowMask.clear();
  //   this.flowGlowMask
  //     .rect(x0, y0, w, h).fill({ color: 0xffffff })
  //     .rect(x0 + bw, y0 + bw, w - 2 * bw, h - 2 * bw).cut();
  //
  //   // 3. 扇形光束 TilingSprite：从设备中心旋转，纹理平铺
  //   if (this.flowGlowTexture !== null) {
  //     const texSize = this.flowGlowTexture.width; // 512
  //
  //     // 边长至少覆盖设备对角线，确保旋转 45° 时仍填满矩形
  //     const diag = Math.sqrt(w * w + h * h);
  //     const tileSize = Math.max(diag, texSize);
  //
  //     // 旋转相位：一个周期完成 360° 旋转
  //     const phase = ((context.time.nowMs % FLOW_GLOW_SCROLL_INTERVAL_MS) / FLOW_GLOW_SCROLL_INTERVAL_MS);
  //     const rotation = phase * Math.PI * 2;
  //
  //     const tintColor = resolveAppThemeColorNumber(
  //       context.theme,
  //       context.theme.renderer.flowGlowTintColorKey,
  //     );
  //
  //     this.flowGlowBeam.visible = true;
  //     this.flowGlowBeam.x = cx;
  //     this.flowGlowBeam.y = cy;
  //     this.flowGlowBeam.width = tileSize;
  //     this.flowGlowBeam.height = tileSize;
  //     this.flowGlowBeam.tileScale.set(1);
  //     this.flowGlowBeam.rotation = rotation;
  //     this.flowGlowBeam.tint = tintColor;
  //   } else {
  //     this.flowGlowBeam.visible = false;
  //   }
  //
  //   this.flowGlowEffectRoot.visible = true;
  // }

  // AI-REMOVED 2026-06-14:
  // Reason: 边缘流光特效改为扫描线+线框方案
  // Trigger: 用户需求"线框+扫描线线，不再做流光特效"
  // Replacement: None；selection 统一走 drawSelectionOverlay 的扫描线+线框路径
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // private loadFlowGlowTexture(): void {
  //   if (this.flowGlowTextureLoadStarted) {
  //     return;
  //   }
  //
  //   this.flowGlowTextureLoadStarted = true;
  //
  //   void Assets.load<Texture>(FLOW_GLOW_TEXTURE_PATH).then((texture) => {
  //     if (this.disposed) {
  //       return;
  //     }
  //
  //     this.flowGlowTexture = texture;
  //     this.flowGlowBeam.texture = texture;
  //   }).catch(() => {
  //     // flow-glow 纹理加载失败，无伤大雅
  //   });
  // }

  private loadPortChevronTextures(useMobile: boolean): void {
    // 同变体已加载，跳过
    if (this.portChevronTextureLoadStarted && this.portChevronTexturesUseMobile === useMobile) {
      return;
    }

    // 变体切换：清空旧纹理缓存，重置状态
    if (this.portChevronTextureLoadStarted) {
      this.portChevronTextures.clear();
      this.arePortChevronTexturesReady = false;
      this.hidePortChevronSprites();
    }

    this.portChevronTextureLoadStarted = true;
    this.portChevronTexturesUseMobile = useMobile;

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
    // 物流模式下获取当前物流类型对应的端口 kind（belt→item, pipe→fluid）
    const kindFilter = directionFilter !== null
      ? this.resolveLogisticsPortKindFilter(context)
      : null;

    const portLayout = resolvePortOverlayLayout({
      definition: this.definition,
      layout,
      app: context.workspace.app,
    });

    // 可用端口（方向 + kind 均匹配）→ 箭头
    // 不可用端口（方向或 kind 不匹配）→ 红叉
    // 物流模式下，已连接端口（物理连接或虚影占用）→ 不显示任何符号
    const isLogisticsMode = context.workspace.app?.state.activeTool === "logistics-placement";
    const excludedPortKeys: ReadonlySet<string> | undefined = isLogisticsMode
      ? context.logisticsPortOccupancy?.get(this.entityId)
      : undefined;
    const { chevrons: portChevronSpecs, crosses: portCrossSpecs } = resolvePortOverlaySpecs({
      definition: this.definition,
      layout: portLayout,
      directionFilter,
      kindFilter,
      excludedPortKeys,
    });

    if (portChevronSpecs.length === 0 && portCrossSpecs.length === 0) {
      return;
    }

    const deviceClass = context.workspace.app?.state.screenProfile.deviceClass;
    const useMobile = deviceClass === "mobile" || deviceClass === "tablet";

    // 变体切换：已缓存的纹理与当前 useMobile 不一致时，触发重载
    if (portChevronSpecs.length > 0 && this.arePortChevronTexturesReady && this.portChevronTexturesUseMobile !== useMobile) {
      this.loadPortChevronTextures(useMobile);
      return;
    }
    if (portCrossSpecs.length > 0 && this.isPortCrossTextureReady && this.portCrossTextureUseMobile !== useMobile) {
      this.loadPortCrossTexture(useMobile);
      return;
    }

    // 加载箭头纹理
    if (portChevronSpecs.length > 0 && !this.arePortChevronTexturesReady) {
      this.loadPortChevronTextures(useMobile);
      return;
    }

    // 加载红叉纹理
    if (portCrossSpecs.length > 0 && !this.isPortCrossTextureReady) {
      this.loadPortCrossTexture(useMobile);
      return;
    }

    // 绘制箭头
    if (portChevronSpecs.length > 0 && this.arePortChevronTexturesReady) {
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
    } else {
      this.hidePortChevronSprites();
    }

    // 绘制红叉
    if (portCrossSpecs.length > 0 && this.isPortCrossTextureReady && this.portCrossTexture !== null) {
      // AI-CORRECTION 2026-06-18: 实机端口叉号使用高亮橙红色而非纯红色，配合贴图中的 alpha 柔光还原发光标记。
      const crossTint = 0xff4b24;

      for (let index = 0; index < portCrossSpecs.length; index += 1) {
        const spec = portCrossSpecs[index];

        if (spec === undefined) {
          continue;
        }

        const sprite = this.getPortCrossSprite(index);
        sprite.texture = this.portCrossTexture;
        sprite.tint = crossTint;
        sprite.visible = true;
        sprite.x = spec.x;
        sprite.y = spec.y;
        sprite.width = spec.width;
        sprite.height = spec.height;
        sprite.rotation = spec.rotation;
      }

      for (let index = portCrossSpecs.length; index < this.portCrossSprites.length; index += 1) {
        const sprite = this.portCrossSprites[index];

        if (sprite !== undefined) {
          sprite.visible = false;
        }
      }
    } else {
      this.hidePortCrossSprites();
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
   * 物流模式下，获取当前物流类型对应的端口 kind：
   * - belt → "item"
   * - pipe → "fluid"
   * - 非物流模式返回 null
   */
  private resolveLogisticsPortKindFilter(
    context: RenderSpriteSyncContext,
  ): PortKind | null {
    // 优先从 draft 获取（已起笔时最准确）
    const draft = context.workspace.editor?.queries?.resolveLogisticsDraftState?.();

    if (draft !== undefined && draft !== null) {
      return draft.kind === "belt" ? "item" : "fluid";
    }

    // 未起笔时从 app 运行时状态获取 logisticsPlacement.kind
    const app = context.workspace.app;

    if (app !== null && "internalState" in app) {
      const kind = (app as AppWithLogisticsPlacementRuntime)
        .internalState.runtime.logisticsPlacement.kind;

      if (kind === "belt") return "item";
      if (kind === "pipe") return "fluid";
    }

    return null;
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

  private shouldForceBlueprintPreviewTexture(context: RenderSpriteSyncContext): boolean {
    if (!FORCE_BLUEPRINT_PREVIEW_DEFINITION_IDS.has(this.definition.id)) {
      return false
    }

    const collections = context.workspace.editor?.state.collections
    const isPreview = collections?.[EntityCollectionType.preview]?.contains(this.entityId) ?? false
    return isPreview || this.shouldDrawLogisticsEndpointOverlay(context)
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

  private getPortCrossSprite(index: number): Sprite {
    const existingSprite = this.portCrossSprites[index];

    if (existingSprite !== undefined) {
      return existingSprite;
    }

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.portOverlayRoot.addChild(sprite);
    this.portCrossSprites[index] = sprite;
    return sprite;
  }

  private hidePortCrossSprites(): void {
    for (const sprite of this.portCrossSprites) {
      sprite.visible = false;
    }
  }

  private loadPortCrossTexture(useMobile: boolean): void {
    // 同变体已加载，跳过
    if (this.portCrossTextureLoadStarted && this.portCrossTextureUseMobile === useMobile) {
      return;
    }

    // 变体切换：清空旧纹理，重置状态
    if (this.portCrossTextureLoadStarted) {
      this.portCrossTexture = null;
      this.isPortCrossTextureReady = false;
      this.hidePortCrossSprites();
    }

    this.portCrossTextureLoadStarted = true;
    this.portCrossTextureUseMobile = useMobile;

    void this.renderHost.textureManager.getTexture(
      resolvePortCrossTextureResourceKey(useMobile),
    ).then((texture) => {
      if (this.disposed) {
        return;
      }

      this.portCrossTexture = texture;
      this.isPortCrossTextureReady = true;
    }).catch(() => {
      // 红叉纹理加载失败，无伤大雅
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
    applyCenteredSpriteLayout(this.previewMask, normalizedLayout)
    applyCenteredSpriteLayout(this.selectionMask, normalizedLayout)
    this.syncDeviceLabel(layout)
  }

  /**
   * 计算足迹（不含 spriteOffset）在视口中的像素矩形。
   * 仅当 definition.spriteOffset 存在时才计算（此时足迹 ≠ 精灵矩形），
   * 否则返回 null，表示可直接使用 layout。
   */
  private computeFootprintLayout(
    spriteLayout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.definition.spriteOffset) {
      return null
    }

    const editor = context.workspace.editor
    if (!editor) {
      return null
    }

    const entity = editor.queries?.getEntityById?.(this.entityId)
    if (!entity) {
      return null
    }

    const viewport = editor.state.viewport

    const footprintGridRect = resolveSpriteGridRect(
      { x: entity.position.x, y: entity.position.y },
      this.definition.footprint,
      null,
      entity.rotation,
    )

    const viewportRect = resolveViewportRectFromWorldGridRect({
      gridRect: footprintGridRect,
      viewportBounds: {
        left: 0,
        top: 0,
        width: viewport.clientRect.width,
        height: viewport.clientRect.height,
      },
      viewportCenter: { x: viewport.center.x, y: viewport.center.y },
      gridCellPixelSize: viewport.gridCellPixelSize,
      displayRotation: viewport.displayRotation,
    })

    if (!viewportRect) {
      return null
    }

    return {
      x: viewportRect.left,
      y: viewportRect.top,
      width: viewportRect.width,
      height: viewportRect.height,
    }
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
  layout: Pick<RenderSpriteLayout, "x" | "y" | "width" | "height">;
  showDeviceIcon: boolean;
  showDeviceName: boolean;
  gridCellPixelSize: number;
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
  const { layout, showDeviceIcon, showDeviceName, gridCellPixelSize } = options;
  const centerX = layout.x + layout.width / 2;
  const centerY = layout.y + layout.height / 2;
  const zoomRatio = Number.isFinite(gridCellPixelSize) && gridCellPixelSize > 0
    ? gridCellPixelSize / WORLD_GRID_CELL_PIXEL_SIZE
    : 1;
  const iconSize = showDeviceIcon ? DEVICE_LABEL_ICON_SIZE * zoomRatio : 0;
  const fontSize = DEVICE_LABEL_FONT_SIZE * zoomRatio;
  const lineHeight = showDeviceName ? fontSize * DEVICE_LABEL_LINE_HEIGHT_RATIO : 0;
  const gap = showDeviceIcon && showDeviceName ? DEVICE_LABEL_GAP * zoomRatio : 0;
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
      maxWidth: Math.max(
        DEVICE_LABEL_MIN_TEXT_WIDTH * zoomRatio,
        layout.width * DEVICE_LABEL_TEXT_WIDTH_RATIO,
      ),
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

function resolvePortOverlaySpecs(options: {
  definition: EntityDefinition;
  layout: RenderSpriteLayout;
  directionFilter?: "input" | "output" | null;
  kindFilter?: PortKind | null;
  excludedPortKeys?: ReadonlySet<string>;
}): {
  chevrons: {
    textureKey: PortChevronTextureKey;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[];
  crosses: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[];
} {
  const chevrons: {
    textureKey: PortChevronTextureKey;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[] = [];
  const crosses: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[] = [];

  const hasDirectionFilter = options.directionFilter !== null
    && options.directionFilter !== undefined;
  const hasKindFilter = options.kindFilter !== null
    && options.kindFilter !== undefined;
  const excludedPortKeys = options.excludedPortKeys;

  for (const portGroup of options.definition.portGroups) {
    const directionMatch = !hasDirectionFilter
      || portGroup.direction === options.directionFilter
      || portGroup.direction === "bidirectional";
    const kindMatch = !hasKindFilter
      || portGroup.kind === options.kindFilter;
    const available = directionMatch && kindMatch;

    const material = resolvePortChevronMaterial(options.definition, portGroup);
    const direction = resolvePortChevronDirection(portGroup.direction);
    const textureKey = available
      ? `${material}-${direction}` as PortChevronTextureKey
      : null;

    for (const port of portGroup.ports) {
      // 物流模式下已连接端口 → 不显示任何符号
      if (excludedPortKeys !== undefined && excludedPortKeys.has(`${portGroup.id}:${port.id}`)) {
        continue;
      }

      const chevronLayout = resolvePortChevronLayout({
        footprint: options.definition.footprint,
        layout: options.layout,
        port,
      });

      if (chevronLayout === null) {
        continue;
      }

      if (available && textureKey !== null) {
        chevrons.push({
          textureKey,
          ...chevronLayout,
        });
      } else {
        crosses.push({
          x: chevronLayout.x,
          y: chevronLayout.y,
          width: chevronLayout.width,
          height: chevronLayout.height,
          rotation: chevronLayout.rotation,
        });
      }
    }
  }

  return { chevrons, crosses };
}

function resolvePortOverlayLayout(options: {
  definition: EntityDefinition;
  layout: RenderSpriteLayout;
  app: RenderSpriteSyncContext["workspace"]["app"];
}): RenderSpriteLayout {
  const spriteOffset = resolveEffectiveSpriteOffsetForPortOverlay(
    options.definition,
    options.app,
  );

  if (spriteOffset === undefined) {
    return options.layout;
  }

  const rotatedOffset = rotateSpriteOffset(
    spriteOffset,
    options.definition.footprint,
    options.layout.rotation,
  );
  const gridCellPixelSize = resolveLayoutGridCellPixelSize(options.layout, {
    width: rotatedOffset.width,
    height: rotatedOffset.height,
  });

  if (gridCellPixelSize === null) {
    return options.layout;
  }

  const rotatedFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.layout.rotation,
  );

  return {
    x: options.layout.x - rotatedOffset.x * gridCellPixelSize,
    y: options.layout.y - rotatedOffset.y * gridCellPixelSize,
    width: rotatedFootprint.width * gridCellPixelSize,
    height: rotatedFootprint.height * gridCellPixelSize,
    rotation: options.layout.rotation,
  };
}

function resolveEffectiveSpriteOffsetForPortOverlay(
  definition: EntityDefinition,
  app: RenderSpriteSyncContext["workspace"]["app"],
): { x: number; y: number; width: number; height: number } | undefined {
  if (definition.spriteOffset === undefined) {
    return undefined;
  }

  return readSimplifiedDeviceIconPreference(app)
    ? definition.spriteOffset.blueprint
    : definition.spriteOffset.topView;
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

    if (storageSlotGroup.slots.some((slot) => isFluidSlotFilter(slot.itemFilterType))) {
      return "liquid";
    }
  }

  return "solid";
}

function isFluidSlotFilter(
  itemFilterType: EntityDefinition["storageSlotGroups"][number]["slots"][number]["itemFilterType"],
): boolean {
  return itemFilterType === "liquid"
    || itemFilterType === "gas"
    || itemFilterType === "fluid";
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

function resolvePortCrossTextureResourceKey(useMobile: boolean): string {
  const suffix = useMobile ? "-mobile" : "";
  return `texture-port-cross${suffix}`;
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

// AI-REMOVED 2026-06-14:
// Reason: 未使用，ESLint no-unused-vars
// Trigger: ESLint 检查报错
// Evidence: 全局搜索无调用者，与 resolveWorldEntitySelectionStrokeWidth 结构对称但无引用
// Replacement: None
// Risk: Low — 边缘流光线宽计算，当前无调用者
// Human Review: Not Required
//
// Original code:
// function resolveFlowGlowBorderWidth(layout: Pick<RenderSpriteLayout, "width" | "height">): number {
//   const width = Math.max(layout.width, layout.height) * 0.08;
//
//   return Math.max(
//     FLOW_GLOW_BORDER_MIN_WIDTH,
//     Math.min(FLOW_GLOW_BORDER_MAX_WIDTH, width),
//   );
// }

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
