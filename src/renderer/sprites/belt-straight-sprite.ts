import {
  Graphics,
} from "pixi.js"

import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

const BELT_TILE_STROKE_WIDTH = 2
const DEFAULT_GHOST_ROOT_ALPHA = 0.2;
const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

export class BeltStraightSprite extends BaseRenderSprite {
  private readonly body = new Graphics({ roundPixels: true })
  private defaultCollectionOverlayGraphics: Graphics | null = null;

  public constructor(entityId: string) {
    super(entityId)
    this.getRootOfLayer("entity").addChild(this.body)
  }

  protected syncSpriteLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void {
    const cornerRadius = Math.min(layout.width, layout.height) * 0.28
    const trackInset = Math.min(layout.width, layout.height) * 0.16
    const laneWidth = Math.max(2, Math.min(layout.width, layout.height) * 0.18)
    const laneInset = Math.max(2, trackInset + laneWidth * 0.5)
    const trackHeight = Math.max(4, layout.height - trackInset * 2)
    const trackTop = layout.y + (layout.height - trackHeight) / 2
    const laneTop = layout.y + (layout.height - laneWidth) / 2

    this.body.clear()

    this.body
      .roundRect(layout.x, layout.y, layout.width, layout.height, cornerRadius)
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTileFillColorKey,
        ),
      })
      .stroke({
        width: BELT_TILE_STROKE_WIDTH,
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTileStrokeColorKey,
        ),
      })

    this.body
      .roundRect(
        layout.x + trackInset,
        trackTop,
        Math.max(4, layout.width - trackInset * 2),
        trackHeight,
        Math.max(2, trackHeight * 0.45),
      )
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTrackColorKey,
        ),
      })

    this.body
      .roundRect(
        layout.x + laneInset,
        laneTop,
        Math.max(2, layout.width - laneInset * 2),
        laneWidth,
        Math.max(1, laneWidth * 0.45),
      )
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltLaneColorKey,
        ),
      })
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
    void layout;
    void context;
    // 传送带暂无 preview 特效
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
