import { Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import type { GridRect } from "@/domain/shared/grid";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";
import {
  resolveDisplayRotationRadians,
  resolveViewportPointFromWorldPoint,
} from "@/shared/geometry/viewport-transform";
import {
  BASE_OUTER_WARNING_PADDING_CELLS,
  resolveBaseOuterGridRects,
  resolveCurrentBaseDefinition,
  resolveExpandedGridRect,
} from "./BaseBoundaryDecoration";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveMarqueeGridRectLayout } from "./MarqueeRectDecoration";
import {
  createGrassGroundLayout,
  GRASS_GROUND_BASE_TEXTURE_KEY,
  GRASS_GROUND_TILE_GRID_CELLS,
  type GrassGroundPlacement,
} from "./grass-ground-layout";
import type { RenderHost } from "../../renderer-host";

// AI-REMOVED 2026-09-05:
// Reason: 单图草地改用用户提供的分层地面素材及其 16 格尺度。
// Trigger: ST2-RQ-026 授权接入 pixi-ground-v1。
// Evidence: 素材 manifest 的底图覆盖 16 世界单位；1 世界单位按 1 格接入。
// Replacement: grass-ground-layout.ts 的底图资源键与覆盖格数。
// Risk: 草地视觉尺度变化；已列入三档视口验收。
// Human Review: Required
//
// Original code:
// const GRASS_TEXTURE_KEY = "texture-Grass005_1K-PNG_Color";
// const GRASS_TILE_GRID_CELLS = 5;
const SCANLINE_TEXTURE_KEY = "texture-scanline-45deg-50opacity";
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
  container.label = "grass-background";
  container.eventMode = "none";
  const ground = new Container();
  ground.label = "grass-ground";
  ground.visible = false;
  const patches = new Container();
  patches.label = "grass-patches";
  const gravel = new Container();
  gravel.label = "grass-gravel";
  const groundMask = new Graphics();
  const grassSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  grassSprite.label = "grass-base";
  const warningFill = new Graphics({ roundPixels: true });
  const warningScanlineSprite = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  });
  const warningMask = new Graphics({ roundPixels: true });
  let isGrassTextureReady = false;
  let isWarningTextureReady = false;
  let destroyed = false;
  let textureRevision = 0;
  let layoutKey = "";
  let lastSyncKey = "";
  let visibleInstanceCount = 0;
  const textures = new Map<string, Texture>();
  const requestedTextures = new Set<string>();
  const instances = new Map<string, {
    sprite: Sprite;
    placement: GrassGroundPlacement;
  }>();

  // 矩形遮罩需要参与 Pixi 的边界计算；mask 机制会自行排除其普通绘制。
  groundMask.renderable = true;
  ground.mask = groundMask;
  warningMask.renderable = false;
  warningScanlineSprite.mask = warningMask;
  warningScanlineSprite.alpha = WARNING_SCANLINE_ALPHA;

  ground.addChild(grassSprite, patches, gravel, groundMask);
  container.addChild(ground);
  container.addChild(warningFill);
  container.addChild(warningScanlineSprite);
  container.addChild(warningMask);

  // AI-REMOVED 2026-09-05:
  // Reason: 草地关闭时不应预加载整套地面资源，异步完成也不能写回已销毁的 Sprite。
  // Trigger: ST2-RQ-026 的懒加载、共享纹理与生命周期要求。
  // Evidence: 原回调无销毁检查，且构造装饰层即请求草地纹理。
  // Replacement: 下方 requestGroundTexture，在首次显示草地时调用。
  // Risk: 首次开启草地需要等待资源加载；沿用统一纹理入口的失败语义。
  // Human Review: Required
  //
  // Original code:
  // void renderHost.textureManager.getTexture(GRASS_TEXTURE_KEY).then((texture) => {
  //   grassSprite.texture = texture;
  //   isGrassTextureReady = true;
  // });

  void renderHost.textureManager.getTexture(SCANLINE_TEXTURE_KEY).then((texture) => {
    if (destroyed) return;
    warningScanlineSprite.texture = texture;
    isWarningTextureReady = true;
    textureRevision += 1;
  });

  function requestGroundTexture(key: string): void {
    if (requestedTextures.has(key)) return;
    requestedTextures.add(key);
    void renderHost.textureManager.getTexture(key).then((texture) => {
      if (destroyed) return;
      textures.set(key, texture);
      if (key === GRASS_GROUND_BASE_TEXTURE_KEY) {
        grassSprite.texture = texture;
        isGrassTextureReady = true;
      }
      textureRevision += 1;
    });
  }

  function syncGroundInstances(
    outerRects: readonly GridRect[],
    nextLayoutKey: string,
  ): void {
    if (layoutKey === nextLayoutKey) return;
    layoutKey = nextLayoutKey;
    // AI-REMOVED 2026-09-26:
    // Reason: 按外接框散布装饰会在分离区域的空地浪费候选计算。
    // Trigger: 草稿箱增加不连续建造区。
    // Evidence: 每块外扩区域都能单独使用确定性世界坐标种子生成。
    // Replacement: 下方逐区域生成并按稳定 ID 去重。
    // Risk: 相交分区的装饰绘制顺序以区域声明顺序为准。
    // Human Review: Required
    // Original code:
    // const placements = createGrassGroundLayout(bounds);
    const retainedIds = new Set<string>();
    for (const placement of outerRects.flatMap((rect) => createGrassGroundLayout(rect))) {
      if (retainedIds.has(placement.id)) continue;
      retainedIds.add(placement.id);
      let instance = instances.get(placement.id);
      if (instance === undefined) {
        const sprite = new Sprite(Texture.EMPTY);
        sprite.label = placement.id;
        sprite.anchor.set(0.5);
        sprite.visible = false;
        instance = { sprite, placement };
        instances.set(placement.id, instance);
      }
      instance.placement = placement;
      instance.sprite.position.set(placement.x, placement.y);
      instance.sprite.rotation = resolveDisplayRotationRadians(placement.rotation);
      // 基地范围变化时也按确定性行列顺序重新排列，避免透明混合顺序改变。
      const layer = placement.layer === "patches" ? patches : gravel;
      layer.addChild(instance.sprite);
      requestGroundTexture(placement.textureKey);
    }
    for (const [id, instance] of instances) {
      if (!retainedIds.has(id)) {
        instance.sprite.destroy();
        instances.delete(id);
      }
    }
    // AI-REMOVED 2026-09-26:
    // Reason: 外接矩形遮罩会把分区之间的空地绘成基地草地。
    // Trigger: 草稿箱加入不连续分区。
    // Evidence: outerRects 保留每块实际外扩边界。
    // Replacement: 下方分别填充各区域遮罩。
    // Risk: Low。
    // Human Review: Required
    // Original code:
    // groundMask.clear().rect(bounds.x, bounds.y, bounds.width, bounds.height).fill(0xffffff);
    groundMask.clear();
    for (const rect of outerRects) {
      groundMask.rect(rect.x, rect.y, rect.width, rect.height).fill(0xffffff);
    }
  }

  function hideBackgroundLayers(): void {
    ground.visible = false;
    visibleInstanceCount = 0;
    lastSyncKey = "";
    grassSprite.visible = false;
    warningScanlineSprite.visible = false;
    warningFill.clear();
    warningMask.clear();
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) return;
      ctx.profiler?.count("grass.instances", instances.size);
      ctx.profiler?.count("grass.visible", visibleInstanceCount);
      ctx.profiler?.count("grass.textures", textures.size);
      const app = ctx.renderHost.workspace.app;
      if (app === null) {
        hideBackgroundLayers();
        return;
      }

      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      // AI-REMOVED 2026-09-26:
      // Reason: 单个外扩矩形无法保留分离区域间的空地。
      // Trigger: 草稿箱新增独立分区。
      // Evidence: resolveBaseOuterGridRects 与 resolveBaseOuterBounds 分别提供实际区域与视口外接框。
      // Replacement: 下方 outerGridRects、outerGridRect、warningGridRects。
      // Risk: Low。
      // Human Review: Required
      // Original code:
      // const outerGridRect = baseDefinition === null
      //   ? null
      //   : resolveBaseOuterGridRect(baseDefinition);
      // const warningGridRect = outerGridRect === null
      //   ? null
      //   : resolveExpandedGridRect(
      //     outerGridRect,
      //     BASE_OUTER_WARNING_PADDING_CELLS,
      //   );
      // if (outerGridRect === null || warningGridRect === null) {
      //   hideBackgroundLayers();
      //   return;
      // }
      const outerGridRects = baseDefinition === null
        ? []
        : resolveBaseOuterGridRects(baseDefinition);
      const outerGridRect = baseDefinition === null
        ? null
        : resolveBaseOuterBounds(baseDefinition);
      const warningGridRects = outerGridRects.map((rect) =>
        resolveExpandedGridRect(rect, BASE_OUTER_WARNING_PADDING_CELLS)
      );

      if (outerGridRect === null || outerGridRects.length === 0
        || warningGridRects.some((rect) => rect === null)) {
        hideBackgroundLayers();
        return;
      }

      const showGrass = app.state.settings.showGrassBackground;
      const nextLayoutKey = outerGridRects.flatMap((rect) =>
        [rect.x, rect.y, rect.width, rect.height]
      ).join(":");
      const syncKey = [
        nextLayoutKey, baseDefinition?.tag, showGrass, textureRevision,
        ctx.viewportState.centerX, ctx.viewportState.centerY,
        ctx.viewportState.gridCellPixelSize, ctx.viewportState.displayRotation,
        ctx.viewportBounds.left, ctx.viewportBounds.top,
        ctx.viewportBounds.width, ctx.viewportBounds.height,
      ].join(":");
      // 仿真帧和设备编辑不会改变地面；只在相关输入变化时更新布局及警告几何。
      if (lastSyncKey === syncKey) return;
      lastSyncKey = syncKey;
      ctx.profiler?.count("grass.layoutSyncs");

      const isBlueWarning = baseDefinition?.tag === WARNING_BLUE_TAG;
      const warningFillColor = isBlueWarning ? WARNING_FILL_COLOR_BLUE : WARNING_FILL_COLOR_RED;
      const warningScanlineTint = isBlueWarning ? WARNING_SCANLINE_TINT_BLUE : WARNING_SCANLINE_TINT_RED;

      // AI-REMOVED 2026-09-26:
      // Reason: 单区域布局无法分别绘制两个独立外扩警告环。
      // Trigger: 草稿箱新增不连续分区。
      // Evidence: outerGridRects 逐项对应 warningGridRects。
      // Replacement: 下方 layouts 数组。
      // Risk: Low。
      // Human Review: Required
      // Original code:
      // const outerLayout = resolveMarqueeGridRectLayout({
      //   gridRect: outerGridRect,
      //   viewportBounds: ctx.viewportBounds,
      //   viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
      //   gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      //   displayRotation: ctx.viewportState.displayRotation,
      // });
      // const warningLayout = resolveMarqueeGridRectLayout({
      //   gridRect: warningGridRect,
      //   viewportBounds: ctx.viewportBounds,
      //   viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
      //   gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      //   displayRotation: ctx.viewportState.displayRotation,
      // });
      // if (outerLayout === null || warningLayout === null) {
      //   hideBackgroundLayers();
      //   return;
      // }
      const layouts = outerGridRects.map((rect, index) => ({
        outer: resolveMarqueeGridRectLayout({
          gridRect: rect,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        }),
        warning: resolveMarqueeGridRectLayout({
          gridRect: warningGridRects[index]!,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        }),
      }));

      if (layouts.some((layout) => layout.outer === null || layout.warning === null)) {
        hideBackgroundLayers();
        return;
      }

      const gridCellSize = ctx.viewportState.gridCellPixelSize;
      const tileGridSize = GRASS_GROUND_TILE_GRID_CELLS;
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

      // AI-REMOVED 2026-09-26:
      // Reason: 警告图层必须围绕每个独立区域绘制，不能使用共同外接框。
      // Trigger: 草稿箱增加左上角分区。
      // Evidence: desktop 草地截图可见两块草地与空隙各自独立。
      // Replacement: 下方对 layouts 逐项绘制 warningFill 与 warningMask。
      // Risk: Low。
      // Human Review: Required
      // Original code:
      // warningFill
      //   .clear()
      //   .rect(warningLayout.x, warningLayout.y, warningLayout.width, warningLayout.height)
      //   .fill({ color: warningFillColor, alpha: WARNING_FILL_ALPHA })
      //   .rect(outerLayout.x, outerLayout.y, outerLayout.width, outerLayout.height)
      //   .cut();
      // warningMask
      //   .clear()
      //   .rect(warningLayout.x, warningLayout.y, warningLayout.width, warningLayout.height)
      //   .fill({ color: 0xffffff })
      //   .rect(outerLayout.x, outerLayout.y, outerLayout.width, outerLayout.height)
      //   .cut();
      warningFill.clear();
      warningMask.clear();
      for (const layout of layouts) {
        const outer = layout.outer!;
        const warning = layout.warning!;
        warningFill
          .rect(warning.x, warning.y, warning.width, warning.height)
          .fill({ color: warningFillColor, alpha: WARNING_FILL_ALPHA })
          .rect(outer.x, outer.y, outer.width, outer.height)
          .cut();
        warningMask
          .rect(warning.x, warning.y, warning.width, warning.height)
          .fill({ color: 0xffffff })
          .rect(outer.x, outer.y, outer.width, outer.height)
          .cut();
      }

      grassSprite.visible = showGrass && isGrassTextureReady;
      ground.visible = grassSprite.visible;
      visibleInstanceCount = 0;
      if (showGrass) {
        requestGroundTexture(GRASS_GROUND_BASE_TEXTURE_KEY);
        syncGroundInstances(outerGridRects, nextLayoutKey);
      }
      if (grassSprite.visible) {
        ground.position.set(gridOriginPixelPoint.x, gridOriginPixelPoint.y);
        ground.scale.set(gridCellSize);
        ground.rotation = resolveDisplayRotationRadians(ctx.viewportState.displayRotation);
        grassSprite.x = outerGridRect.x;
        grassSprite.y = outerGridRect.y;
        grassSprite.width = outerGridRect.width;
        grassSprite.height = outerGridRect.height;
        grassSprite.tileScale.set(
          tileGridSize / (grassSprite.texture.width || tileGridSize),
        );

        // Align grass tile corners with grid origin, handling negative modulo
        // AI-CORRECTION 2026-09-05: 地面容器统一承担视口变换；此处相位与尺寸改用世界格，底图和点缀随世界一起旋转。
        grassSprite.tilePosition.x = ((-outerGridRect.x % tileGridSize) + tileGridSize) % tileGridSize;
        grassSprite.tilePosition.y = ((-outerGridRect.y % tileGridSize) + tileGridSize) % tileGridSize;

        for (const { sprite, placement } of instances.values()) {
          const texture = textures.get(placement.textureKey);
          if (texture === undefined) {
            sprite.visible = false;
            continue;
          }
          if (sprite.texture !== texture) {
            sprite.texture = texture;
            sprite.width = placement.size;
            sprite.height = placement.size;
          }
          const point = resolveViewportPointFromWorldPoint({
            worldPoint: placement,
            viewportBounds: ctx.viewportBounds,
            viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
            gridCellPixelSize: gridCellSize,
            displayRotation: ctx.viewportState.displayRotation,
          });
          const radius = placement.size * gridCellSize / 2;
          sprite.visible = point.x + radius > ctx.viewportBounds.left
            && point.x - radius < ctx.viewportBounds.left + ctx.viewportBounds.width
            && point.y + radius > ctx.viewportBounds.top
            && point.y - radius < ctx.viewportBounds.top + ctx.viewportBounds.height;
          if (sprite.visible) visibleInstanceCount += 1;
        }
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
      destroyed = true;
      container.destroy({ children: true });
      instances.clear();
      textures.clear();
      requestedTextures.clear();
    },
  };
}
