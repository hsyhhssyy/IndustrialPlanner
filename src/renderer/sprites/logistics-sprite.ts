import {
  Graphics,
} from "pixi.js"

import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import { EntityCollectionType, type EntityCollectionType as EntityCollectionTypeValue } from "@/domain/state/types"

const DEFAULT_GHOST_ROOT_ALPHA = 0.2;
const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

export type LogisticsSpriteId =
  | "belt_straight_1x1"
  | "belt_turn_cw_1x1"
  | "belt_turn_ccw_1x1"
  | "pipe_straight_1x1"
  | "pipe_turn_cw_1x1"
  | "pipe_turn_ccw_1x1";

const BELT_COLOR = 0xffcc00;  // 黄色（传送带）
const PIPE_COLOR = 0x3388ff;  // 蓝色（管道）
const ARROW_STROKE_COLOR = 0x222222;  // 深灰色箭头描边
const LOGISTICS_PREVIEW_VALID_COLOR = 0xffffff;
const LOGISTICS_PREVIEW_INVALID_COLOR = 0xff3b30;
const LOGISTICS_HEAD_STROKE_COLOR = 0xffd633;
const DEGREE_TO_RADIAN = Math.PI / 180;

function isPipe(spriteId: LogisticsSpriteId): boolean {
  return spriteId.startsWith("pipe_");
}

function resolveLogisticsColor(spriteId: LogisticsSpriteId): number {
  return isPipe(spriteId) ? PIPE_COLOR : BELT_COLOR;
}

function isTurn(spriteId: LogisticsSpriteId): boolean {
  return spriteId.includes("_turn_");
}

function isCw(spriteId: LogisticsSpriteId): boolean {
  return spriteId.includes("_cw_");
}

/**
 * 临时管带渲染精灵：绘制方向箭头
 * - 直行 → 右箭头
 * - 顺时针转弯 → 下弯箭头
 * - 逆时针转弯 → 上弯箭头
 * - 传送带用黄色，管道用蓝色
 */
export class LogisticsSprite extends BaseRenderSprite {
  private readonly body = new Graphics({ roundPixels: true })
  private readonly arrow = new Graphics({ roundPixels: true })
  private defaultCollectionOverlayGraphics: Graphics | null = null;
  private previewOverlayGraphics: Graphics | null = null;
  private headOverlayGraphics: Graphics | null = null;
  private readonly spriteId: LogisticsSpriteId;

  public constructor(entityId: string, spriteId: LogisticsSpriteId) {
    super(entityId)
    this.spriteId = spriteId;

    const entityRoot = this.getRootOfLayer("entity")
    entityRoot.addChild(this.body)
    entityRoot.addChild(this.arrow)
  }

  protected syncSpriteLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void {
    void context;
    const { x, y, width, height } = layout;
    const color = resolveLogisticsColor(this.spriteId);
    const cornerRadius = Math.min(width, height) * 0.15;

    // 背景方块
    this.body.clear();
    this.body
      .roundRect(x, y, width, height, cornerRadius)
      .fill({ color });

    // 方向箭头
    this.arrow.clear();
    if (isTurn(this.spriteId)) {
      this.drawTurnArrow(x, y, width, height, isCw(this.spriteId));
    } else {
      this.drawStraightArrow(x, y, width, height);
    }
    this.applyArrowRotation(layout);
  }

  /**
   * 绘制直行右箭头 (→)
   */
  private drawStraightArrow(x: number, y: number, w: number, h: number): void {
    const arrowBodyWidth = Math.max(2, Math.min(w, h) * 0.12);
    const headSize = Math.max(3, Math.min(w, h) * 0.28);
    const padding = Math.min(w, h) * 0.15;
    const midY = y + h / 2;
    const shaftEnd = x + w - padding - headSize;
    const shaftStart = x + padding;

    // 箭头杆
    this.arrow
      .rect(shaftStart, midY - arrowBodyWidth / 2, shaftEnd - shaftStart, arrowBodyWidth)
      .fill({ color: ARROW_STROKE_COLOR });

    // 箭头三角形
    this.arrow
      .poly([
        shaftEnd, midY - headSize,
        x + w - padding, midY,
        shaftEnd, midY + headSize,
      ])
      .fill({ color: ARROW_STROKE_COLOR });
  }

  /**
   * 绘制转弯箭头
   * - isCw=true:  从左边进入，向下弯曲   ↳
   * - isCw=false: 从左边进入，向上弯曲   ↰
   */
  private drawTurnArrow(x: number, y: number, w: number, h: number, isClockwise: boolean): void {
    const arrowBodyWidth = Math.max(2, Math.min(w, h) * 0.12);
    const headSize = Math.max(3, Math.min(w, h) * 0.25);
    const padding = Math.min(w, h) * 0.15;
    const midX = x + w / 2;
    const midY = y + h / 2;

    // 控制点坐标
    const startX = x + padding;
    const endX = isClockwise ? midX : midX;
    const endY = isClockwise ? y + h - padding : y + padding;

    // 用两条贝塞尔曲线近似 90° 弧线（入口水平 → 出口垂直）
    const cp1X = isClockwise ? startX : startX;
    const cp2Y = isClockwise ? endY : endY;

    // 绘制圆弧箭头主体（用二次贝塞尔曲线近似 90° 弯）
    this.arrow.moveTo(startX, midY);
    this.arrow.quadraticCurveTo(cp1X, cp2Y, endX, endY);
    this.arrow.stroke({
      width: arrowBodyWidth * 2,
      color: ARROW_STROKE_COLOR,
      cap: "round",
    });

    // 箭头三角形
    if (isClockwise) {
      // 指向下方
      this.arrow
        .poly([
          endX - headSize, endY - headSize * 0.6,
          endX, endY,
          endX + headSize, endY - headSize * 0.6,
        ])
        .fill({ color: ARROW_STROKE_COLOR });
    } else {
      // 指向上方
      this.arrow
        .poly([
          endX - headSize, endY + headSize * 0.6,
          endX, endY,
          endX + headSize, endY + headSize * 0.6,
        ])
        .fill({ color: ARROW_STROKE_COLOR });
    }
  }

  private applyArrowRotation(layout: RenderSpriteLayout): void {
    const centerX = layout.x + layout.width / 2;
    const centerY = layout.y + layout.height / 2;

    this.arrow.pivot.set(centerX, centerY);
    this.arrow.position.set(centerX, centerY);
    this.arrow.rotation = layout.rotation * DEGREE_TO_RADIAN;
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
    this.previewOverlayGraphics?.clear();
    this.headOverlayGraphics?.clear();
  }

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
    const draft = context.workspace.editor?.queries.resolveLogisticsDraftState();
    const isInvalid = draft?.canApply === false;
    const color = isInvalid ? LOGISTICS_PREVIEW_INVALID_COLOR : LOGISTICS_PREVIEW_VALID_COLOR;
    const width = resolveWorldEntitySelectionStrokeWidth(this.resolveWorkspaceGridCellPixelSize(context));
    const innerRect = resolveInnerStrokeRect(layout, width);

    if (innerRect === null) {
      return;
    }

    this.getPreviewOverlayGraphics()
      .rect(innerRect.x, innerRect.y, innerRect.width, innerRect.height)
      .fill({
        color,
        alpha: isInvalid ? 0.45 : 0.25,
      })
      .stroke({
        width,
        color,
        alpha: isInvalid ? 0.95 : 0.75,
      });
  }

  protected drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    const color = resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.worldEntitySelectionStrokeColorKey,
    );
    const width = resolveWorldEntitySelectionStrokeWidth(this.resolveWorkspaceGridCellPixelSize(context));
    const innerRect = resolveInnerStrokeRect(layout, width);

    if (innerRect === null) {
      return;
    }

    this.getCollectionOverlayGraphics()
      .rect(innerRect.x, innerRect.y, innerRect.width, innerRect.height)
      .stroke({
        width,
        color,
      });
  }

  protected getCollectionOverlayGraphics(): Graphics {
    if (this.defaultCollectionOverlayGraphics !== null) {
      return this.defaultCollectionOverlayGraphics;
    }

    const graphics = new Graphics({ roundPixels: true });
    this.getRootOfLayer("overlay").addChild(graphics);
    this.defaultCollectionOverlayGraphics = graphics;
    return graphics;
  }

  protected getPreviewOverlayGraphics(): Graphics {
    if (this.previewOverlayGraphics !== null) {
      return this.previewOverlayGraphics;
    }

    const graphics = new Graphics({ roundPixels: true });
    this.getRootOfLayer("overlay").addChild(graphics);
    this.previewOverlayGraphics = graphics;
    return graphics;
  }

  protected getHeadOverlayGraphics(): Graphics {
    if (this.headOverlayGraphics !== null) {
      return this.headOverlayGraphics;
    }

    const graphics = new Graphics({ roundPixels: true });
    this.getRootOfLayer("overlay").addChild(graphics);
    this.headOverlayGraphics = graphics;
    return graphics;
  }

  protected override resolveCollectionSyncOrder(
    context: RenderSpriteSyncContext,
  ): readonly EntityCollectionTypeValue[] {
    void context;
    return [
      EntityCollectionType.ghost,
      EntityCollectionType.preview,
      EntityCollectionType.logisticsHead,
      EntityCollectionType.marquee,
      EntityCollectionType.reverseMarquee,
      EntityCollectionType.selection,
    ];
  }

  protected override syncCollectionOverlay(
    collectionTypes: readonly EntityCollectionTypeValue[],
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    super.syncCollectionOverlay(collectionTypes, layout, context);

    if (collectionTypes.includes(EntityCollectionType.logisticsHead)) {
      this.drawHeadOverlay(layout, context);
    }
  }

  private drawHeadOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    const width = Math.max(
      WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
      resolveWorldEntitySelectionStrokeWidth(this.resolveWorkspaceGridCellPixelSize(context)),
    );
    const innerRect = resolveInnerStrokeRect(layout, width);

    if (innerRect === null) {
      return;
    }

    this.getHeadOverlayGraphics()
      .rect(innerRect.x, innerRect.y, innerRect.width, innerRect.height)
      .stroke({
        width,
        color: LOGISTICS_HEAD_STROKE_COLOR,
      });
  }
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
