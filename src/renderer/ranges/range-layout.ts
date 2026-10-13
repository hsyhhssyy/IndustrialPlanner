import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { resolveViewportRectFromWorldGridRect, type ViewportProjectionLike } from "@/shared/geometry/viewport-transform";
import type { GridRect } from "@/domain/shared/grid";
import type { RangeOutlineInstance } from "./types";

export function resolveRangeOutlineLayouts(
  ctx: ViewportProjectionLike & { readonly visibleGridRect: GridRect },
  outlines: readonly RangeOutlineInstance[],
) {
  return outlines.flatMap((outline) => {
    if (!areGridRectsIntersecting(outline.gridRect, ctx.visibleGridRect)) return [];
    const rect = resolveViewportRectFromWorldGridRect({ ...ctx, gridRect: outline.gridRect });
    return rect ? [{ ...outline, rect, width: Math.max(1, Math.min(4, ctx.gridCellPixelSize / 8)) * outline.strokeScale }] : [];
  });
}
