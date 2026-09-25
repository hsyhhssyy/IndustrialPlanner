import { describe, expect, it } from "vitest";
import { layoutRegionalDarkPipeBadge } from "@/renderer/scene/decorations/RegionalDarkPipeLinkGeometry";

describe("跨基地暗管标牌布局", () => {
  const viewport = { left: 0, top: 0, width: 764, height: 250 };
  const entity = { left: 300, top: 100, width: 48, height: 48 };

  it("优先放在设备上方并保留短引线间隔", () => {
    expect(layoutRegionalDarkPipeBadge({ entity, viewport, width: 120, height: 24, occupied: [] }))
      .toEqual({ left: 264, top: 66, width: 120, height: 24 });
  });

  it("已有标牌占据上方时移到下方", () => {
    const first = layoutRegionalDarkPipeBadge({ entity, viewport, width: 120, height: 24, occupied: [] });
    expect(layoutRegionalDarkPipeBadge({ entity, viewport, width: 120, height: 24, occupied: [first] }).top)
      .toBe(158);
  });

  it("矮视口边缘的标牌保持可见并避开设备", () => {
    const badge = layoutRegionalDarkPipeBadge({
      entity: { ...entity, left: 2, top: 2 }, viewport, width: 150, height: 24, occupied: [],
    });
    expect(badge.left).toBeGreaterThanOrEqual(4);
    expect(badge.top).toBeGreaterThanOrEqual(50);
    expect(badge.left + badge.width).toBeLessThanOrEqual(viewport.width - 4);
    expect(badge.top + badge.height).toBeLessThanOrEqual(viewport.height - 4);
  });
});
