import { Container, TilingSprite } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import type { RenderHost } from "../../renderer-host";

const GRASS_TEXTURE_KEY = "texture-Grass005_1K-PNG_Color";
const GRASS_TILE_GRID_CELLS = 5;

export function createGrassBackgroundDecoration(
  renderHost: RenderHost,
): DecorationLayer {
  const container = new Container();
  let grassSprite: TilingSprite | null = null;

  renderHost.textureManager.getTexture(GRASS_TEXTURE_KEY).then((texture) => {
    grassSprite = new TilingSprite({
      texture,
      width: 0,
      height: 0,
    });
    container.addChild(grassSprite);
  });

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      const showGrass =
        ctx.workspace.app!.state.settings.showGrassBackground;

      if (!grassSprite) {
        return;
      }

      grassSprite.visible = showGrass;

      if (!showGrass) {
        return;
      }

      const gridCellSize = ctx.viewportState.gridCellPixelSize;
      const tilePixelSize = gridCellSize * GRASS_TILE_GRID_CELLS;
      const viewportCenterX = ctx.viewportBounds.left + ctx.viewportBounds.width / 2;
      const viewportCenterY = ctx.viewportBounds.top + ctx.viewportBounds.height / 2;

      // Pixel position of grid origin (0, 0) on the viewport
      const gridOriginPxX = viewportCenterX - ctx.viewportState.centerX * gridCellSize;
      const gridOriginPxY = viewportCenterY - ctx.viewportState.centerY * gridCellSize;

      grassSprite.width = ctx.viewportBounds.width;
      grassSprite.height = ctx.viewportBounds.height;
      grassSprite.tileScale.set(
        tilePixelSize / (grassSprite.texture.width || tilePixelSize),
      );

      // Align grass tile corners with grid origin, handling negative modulo
      grassSprite.tilePosition.x = ((gridOriginPxX % tilePixelSize) + tilePixelSize) % tilePixelSize;
      grassSprite.tilePosition.y = ((gridOriginPxY % tilePixelSize) + tilePixelSize) % tilePixelSize;
    },

    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
