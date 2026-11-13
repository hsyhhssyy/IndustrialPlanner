import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { clipSceneBounds, clipSceneBoundarySegment, expandSceneBounds, resolveSceneBoundarySegments } from "@/shared/geometry/scene-space";
import { normalizeRegionRects, subtractRegionRect } from "@/shared/geometry/region-rects";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import type { DecorationSyncContext } from "./DecorationSyncContext";

/** 对齐世界格／地面块，平移时保持纹理相位，所有图形尺寸均来自有限视口。 */
export function resolveSceneViewportGridRect(
  ctx: Pick<DecorationSyncContext, "viewportBounds" | "viewportState">,
  block = 1,
  padding = 2,
): GridRect {
  if (!Number.isFinite(ctx.viewportState.gridCellPixelSize) || ctx.viewportState.gridCellPixelSize <= 0
    || !Number.isFinite(ctx.viewportBounds.width) || !Number.isFinite(ctx.viewportBounds.height)
    || !Number.isFinite(ctx.viewportState.centerX) || !Number.isFinite(ctx.viewportState.centerY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const rotated = ctx.viewportState.displayRotation === 90 || ctx.viewportState.displayRotation === 270;
  const width = (rotated ? ctx.viewportBounds.height : ctx.viewportBounds.width) / ctx.viewportState.gridCellPixelSize;
  const height = (rotated ? ctx.viewportBounds.width : ctx.viewportBounds.height) / ctx.viewportState.gridCellPixelSize;
  const x = Math.floor((ctx.viewportState.centerX - width / 2 - padding) / block) * block;
  const y = Math.floor((ctx.viewportState.centerY - height / 2 - padding) / block) * block;
  return {
    x, y,
    width: Math.ceil((ctx.viewportState.centerX + width / 2 + padding) / block) * block - x,
    height: Math.ceil((ctx.viewportState.centerY + height / 2 + padding) / block) * block - y,
  };
}

export function resolveSceneOuterRects(space: SceneSpace, viewport: GridRect, padding = 0): GridRect[] {
  return resolveBaseAreas(space).flatMap((area) => {
    const bounds = expandSceneBounds(area.outerBounds, {
      top: padding, right: padding, bottom: padding, left: padding,
    });
    const rect = clipSceneBounds(bounds, viewport);
    return rect === null ? [] : [rect];
  });
}

/** 并集外扩减去整个并集，避免重叠区域出现内部警告条或叠加透明度。 */
export function resolveSceneWarningRects(space: SceneSpace, viewport: GridRect, padding: number): GridRect[] {
  let warning = normalizeRegionRects(resolveSceneOuterRects(space, viewport, padding));
  for (const outer of resolveSceneOuterRects(space, viewport)) {
    warning = subtractRegionRect(warning, outer);
  }
  return warning;
}

export function resolveSceneBoundaryLines(
  space: SceneSpace,
  ctx: Pick<DecorationSyncContext, "viewportBounds" | "viewportState">,
): Array<{ from: GridPoint; to: GridPoint }> {
  const viewport = resolveSceneViewportGridRect(ctx);
  const project = (worldPoint: GridPoint) => resolveViewportPointFromWorldPoint({
    worldPoint,
    viewportBounds: ctx.viewportBounds,
    viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  });
  return resolveSceneBoundarySegments(space.areas).flatMap((segment) => {
    const clipped = clipSceneBoundarySegment(segment, viewport);
    return clipped === null ? [] : [{ from: project(clipped.from), to: project(clipped.to) }];
  });
}
