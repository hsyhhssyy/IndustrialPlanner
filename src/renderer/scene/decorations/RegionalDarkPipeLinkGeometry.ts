import type { ViewportRect } from "./DarkPipeLinkGeometry";

/** 优先放在设备上方；边缘和密集场景改用其他方向，始终把标牌留在可视范围内。 */
export function layoutRegionalDarkPipeBadge(options: {
  readonly entity: ViewportRect;
  readonly viewport: ViewportRect;
  readonly width: number;
  readonly height: number;
  readonly occupied: readonly ViewportRect[];
}): ViewportRect {
  const { entity, viewport, width, height } = options;
  const gap = 10;
  const centerX = entity.left + entity.width / 2;
  const centerY = entity.top + entity.height / 2;
  const candidates = [
    { left: centerX - width / 2, top: entity.top - height - gap },
    { left: centerX - width / 2, top: entity.top + entity.height + gap },
    { left: entity.left + entity.width + gap, top: centerY - height / 2 },
    { left: entity.left - width - gap, top: centerY - height / 2 },
  ].map((position) => ({
    left: Math.max(viewport.left + 4, Math.min(position.left, viewport.left + viewport.width - width - 4)),
    top: Math.max(viewport.top + 4, Math.min(position.top, viewport.top + viewport.height - height - 4)),
    width,
    height,
  }));
  const overlapArea = (left: ViewportRect, right: ViewportRect) =>
    Math.max(0, Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left))
    * Math.max(0, Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top));
  const score = (rect: ViewportRect) => overlapArea(rect, entity)
    + options.occupied.reduce((total, other) => total + overlapArea(rect, other), 0);
  return candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
}
