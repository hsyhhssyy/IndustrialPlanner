import type { TextStyleOptions } from "pixi.js";
import type { RegionAnnotation } from "@/domain/document/region-annotation";
import type { GridRect } from "@/domain/shared/grid";
import { normalizeRegionRects, resolveRegionShapeSummary } from "./region-rects";
import { resolveViewportRectFromWorldGridRect, type ViewportProjectionLike } from "./viewport-transform";

export function resolveRegionLabelRect(rects: readonly GridRect[]): GridRect | null {
  return normalizeRegionRects(rects)
    .sort((left, right) => (
      right.width * right.height - left.width * left.height
      || left.y - right.y
      || left.x - right.x
    ))[0] ?? null;
}


export function createRegionLabelStyle(color: number): TextStyleOptions {
  return {
    align: "center",
    fill: color,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14,
    stroke: {
      color: 0x101419,
      width: 3,
      alpha: 0.8,
    },
  };
}


export function resolveRegionLabelText(region: RegionAnnotation, showSummary: boolean, cellUnit: string): string {
  return showSummary ? `${region.name}\n${resolveRegionShapeSummary(region.rects, cellUnit)}` : region.name;
}

/** 输入与绘制使用同一矩形；坐标相对于 viewportBounds。 */
export function resolveRegionLabelLayout(options: ViewportProjectionLike & {
  readonly rects: readonly GridRect[];
  readonly labelWidth: number;
  readonly labelHeight: number;
}) {
  const rect = resolveRegionLabelRect(options.rects);
  const layout = rect === null ? null : resolveViewportRectFromWorldGridRect({ ...options, gridRect: rect });
  if (layout === null) return null;
  const margin = 8;
  const width = options.labelWidth;
  const height = options.labelHeight;
  const left = Math.max(options.viewportBounds.left + margin, Math.min(
    layout.left + (layout.width - width) / 2,
    options.viewportBounds.left + options.viewportBounds.width - margin - width,
  ));
  const top = Math.max(options.viewportBounds.top + margin, Math.min(
    layout.top + (layout.height - height) / 2,
    options.viewportBounds.top + options.viewportBounds.height - margin - height,
  ));
  return { left, top, width, height };
}
