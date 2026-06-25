import { Container, Graphics, Texture, TilingSprite } from "pixi.js";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import {
  BASE_OUTER_WARNING_PADDING_CELLS,
  resolveBaseOuterGridRect,
  resolveCurrentBaseDefinition,
  resolveExpandedGridRect,
} from "./BaseBoundaryDecoration";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveMarqueeGridRectLayout } from "./MarqueeRectDecoration";
import type { RenderHost } from "../../renderer-host";

const GRASS_TEXTURE_KEY = "texture-Grass005_1K-PNG_Color";
const SCANLINE_TEXTURE_KEY = "texture-scanline-45deg-50opacity";
const GRASS_TILE_GRID_CELLS = 5;
const WARNING_FILL_COLOR_RED = 0xff4d4f;
const WARNING_FILL_COLOR_BLUE = 0x4d7fff;
const WARNING_FILL_ALPHA = 0.18;
const WARNING_SCANLINE_TINT_RED = 0xff4d4f;
const WARNING_SCANLINE_TINT_BLUE = 0x4d7fff;
const WARNING_SCANLINE_ALPHA = 0.92;
const WARNING_BLUE_TAG = "武陵";

export function createGrassBackgroundDecoration(
  renderHost: RenderHost,
): DecorationLayer {
  const container = new Container();
  const grassSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  const warningFill = new Graphics({ roundPixels: true });
  const warningScanlineSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  const warningMask = new Graphics({ roundPixels: true });
  let isGrassTextureReady = false;
  let isWarningTextureReady = false;

  warningMask.renderable = false;
  warningScanlineSprite.mask = warningMask;
  warningScanlineSprite.alpha = WARNING_SCANLINE_ALPHA;

  container.addChild(grassSprite);
  container.addChild(warningFill);
  container.addChild(warningScanlineSprite);
  container.addChild(warningMask);

  void renderHost.textureManager.getTexture(GRASS_TEXTURE_KEY).then((texture) => {
    grassSprite.texture = texture;
    isGrassTextureReady = true;
  });

  void renderHost.textureManager.getTexture(SCANLINE_TEXTURE_KEY).then((texture) => {
    warningScanlineSprite.texture = texture;
    isWarningTextureReady = true;
  });

  function hideBackgroundLayers(): void {
    grassSprite.visible = false;
    warningScanlineSprite.visible = false;
    warningFill.clear();
    warningMask.clear();
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      const app = ctx.renderHost.workspace.app;
      if (app === null) {
        hideBackgroundLayers();
        return;
      }

      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      const outerGridRect = baseDefinition === null
        ? null
        : resolveBaseOuterGridRect(baseDefinition);
      const warningGridRect = outerGridRect === null
        ? null
        : resolveExpandedGridRect(
          outerGridRect,
          BASE_OUTER_WARNING_PADDING_CELLS,
        );

      if (outerGridRect === null || warningGridRect === null) {
        hideBackgroundLayers();
        return;
      }

      const isBlueWarning = baseDefinition?.tag === WARNING_BLUE_TAG;
      const warningFillColor = isBlueWarning ? WARNING_FILL_COLOR_BLUE : WARNING_FILL_COLOR_RED;
      const warningScanlineTint = isBlueWarning ? WARNING_SCANLINE_TINT_BLUE : WARNING_SCANLINE_TINT_RED;

      const outerLayout = resolveMarqueeGridRectLayout({
        gridRect: outerGridRect,
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
      });
      const warningLayout = resolveMarqueeGridRectLayout({
        gridRect: warningGridRect,
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
      });

      if (outerLayout === null || warningLayout === null) {
        hideBackgroundLayers();
        return;
      }

      const showGrass = app.state.settings.showGrassBackground;

      const gridCellSize = ctx.viewportState.gridCellPixelSize;
      const tilePixelSize = gridCellSize * GRASS_TILE_GRID_CELLS;
      const gridOriginPixelPoint = resolveViewportPointFromWorldPoint({
        worldPoint: {
          x: 0,
          y: 0,
        },
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: gridCellSize,
        displayRotation: ctx.viewportState.displayRotation,
      });

      warningScanlineSprite.tint = warningScanlineTint;

      warningFill
        .clear()
        .rect(warningLayout.x, warningLayout.y, warningLayout.width, warningLayout.height)
        .fill({
          color: warningFillColor,
          alpha: WARNING_FILL_ALPHA,
        })
        .rect(outerLayout.x, outerLayout.y, outerLayout.width, outerLayout.height)
        .cut();

      warningMask
        .clear()
        .rect(warningLayout.x, warningLayout.y, warningLayout.width, warningLayout.height)
        .fill({ color: 0xffffff })
        .rect(outerLayout.x, outerLayout.y, outerLayout.width, outerLayout.height)
        .cut();

      grassSprite.visible = showGrass && isGrassTextureReady;
      if (grassSprite.visible) {
        grassSprite.x = outerLayout.x;
        grassSprite.y = outerLayout.y;
        grassSprite.width = outerLayout.width;
        grassSprite.height = outerLayout.height;
        grassSprite.tileScale.set(
          tilePixelSize / (grassSprite.texture.width || tilePixelSize),
        );

        // Align grass tile corners with grid origin, handling negative modulo
        grassSprite.tilePosition.x = ((gridOriginPixelPoint.x - outerLayout.x) % tilePixelSize + tilePixelSize) % tilePixelSize;
        grassSprite.tilePosition.y = ((gridOriginPixelPoint.y - outerLayout.y) % tilePixelSize + tilePixelSize) % tilePixelSize;
      }

      warningScanlineSprite.visible = isWarningTextureReady;
      if (warningScanlineSprite.visible) {
        const warningTilePixelSize = warningScanlineSprite.texture.width || 64;

        warningScanlineSprite.width = ctx.viewportBounds.width;
        warningScanlineSprite.height = ctx.viewportBounds.height;
        warningScanlineSprite.tileScale.set(1);
        warningScanlineSprite.tilePosition.x = ((gridOriginPixelPoint.x % warningTilePixelSize) + warningTilePixelSize) % warningTilePixelSize;
        warningScanlineSprite.tilePosition.y = ((gridOriginPixelPoint.y % warningTilePixelSize) + warningTilePixelSize) % warningTilePixelSize;
      }
    },

    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
