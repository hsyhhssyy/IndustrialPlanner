import { describe, expect, it } from "vitest";
import { BASE_DEFINITIONS } from "@/registry/base-definition";
import {
  isGridPointInBaseArea,
  resolveBaseAreaContainingRect,
  resolveBaseAreas,
  resolveBaseOuterBounds,
} from "@/shared/geometry/base-areas";

const draftBox = BASE_DEFINITIONS.find((base) => base.id === "draft_box")!;
const agriculturalLand = BASE_DEFINITIONS.find((base) => base.id === "wuling_agricultural_land")!;

describe("base areas", () => {
  it("lays out two named agricultural areas with a 10-cell gap between outer rings", () => {
    const areas = resolveBaseAreas(agriculturalLand);
    expect(areas).toMatchObject([
      {
        nameplate: "武陵农用地",
        placeableRect: { x: 0, y: 0, width: 20, height: 20 },
        outerRect: { x: -10, y: -10, width: 40, height: 40 },
      },
      {
        nameplate: "缘缘庄",
        placeableRect: { x: 50, y: 0, width: 20, height: 20 },
        outerRect: { x: 40, y: -10, width: 40, height: 40 },
      },
    ]);
    expect(areas).toHaveLength(2);
    expect(areas[1]!.outerRect.x - (areas[0]!.outerRect.x + areas[0]!.outerRect.width)).toBe(10);
    expect(resolveBaseOuterBounds(agriculturalLand)).toEqual({
      x: -10, y: -10, width: 90, height: 40,
    });
  });

  it("keeps the agricultural gap and rectangles bridging both areas unplaceable", () => {
    expect(resolveBaseAreaContainingRect(agriculturalLand, {
      x: 0, y: 0, width: 20, height: 20,
    }, "placeable")?.nameplate).toBe("武陵农用地");
    expect(resolveBaseAreaContainingRect(agriculturalLand, {
      x: 50, y: 0, width: 20, height: 20,
    }, "placeable")?.nameplate).toBe("缘缘庄");
    expect(isGridPointInBaseArea(agriculturalLand, { x: 29, y: 0 }, "outer")).toBe(true);
    for (let x = 30; x < 40; x += 1) {
      expect(isGridPointInBaseArea(agriculturalLand, { x, y: 0 }, "outer")).toBe(false);
    }
    expect(isGridPointInBaseArea(agriculturalLand, { x: 40, y: 0 }, "outer")).toBe(true);
    expect(resolveBaseAreaContainingRect(agriculturalLand, {
      x: 29, y: 0, width: 12, height: 1,
    }, "outer")).toBeNull();
  });

  it("resolves only the draft box main area", () => {
    expect(resolveBaseAreas(draftBox)).toMatchObject([
      {
        id: "draft_box",
        placeableRect: { x: 0, y: 0, width: 320, height: 320 },
        outerRect: { x: -20, y: -20, width: 360, height: 360 },
      },
      // AI-REMOVED 2026-09-28:
      // Reason: 草稿箱取消左上角独立外环区。
      // Trigger: 用户要求删除该区域并更新对应测试。
      // Evidence: draft_box 改为仅保留主区域。
      // Replacement: 仅保留 draft_box 主区域的期望。
      // Risk: 原独立区域内已有设备将判定为越界。
      // Human Review: Required
      // Original code:
      // {
      //   id: "draft_box_upper_left",
      //   placeableRect: { x: -60, y: -60, width: 0, height: 0 },
      //   outerRect: { x: -80, y: -80, width: 40, height: 40 },
      // },
    ]);
    expect(resolveBaseOuterBounds(draftBox)).toEqual({
      x: -20, y: -20, width: 360, height: 360,
    });
  });

  it("rejects the removed area and accepts the main outer boundary", () => {
    expect(isGridPointInBaseArea(draftBox, { x: -41, y: -41 }, "outer")).toBe(false);
    expect(isGridPointInBaseArea(draftBox, { x: -40, y: -40 }, "outer")).toBe(false);
    expect(isGridPointInBaseArea(draftBox, { x: -21, y: -21 }, "outer")).toBe(false);
    expect(isGridPointInBaseArea(draftBox, { x: -20, y: -20 }, "outer")).toBe(true);
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 1, height: 1,
    }, "outer")).toBeNull();
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 1, height: 1,
    }, "placeable")).toBeNull();
    expect(resolveBaseAreaContainingRect(draftBox, {
      x: -45, y: -45, width: 30, height: 30,
    }, "outer")).toBeNull();
  });
});
