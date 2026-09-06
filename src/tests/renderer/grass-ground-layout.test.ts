import { describe, expect, it } from "vitest";
import type { GridRect } from "@/domain/shared/grid";
import {
  createGrassGroundLayout,
  GRASS_GROUND_BASE_TEXTURE_KEY,
  GRASS_GROUND_SEED,
  GRASS_GROUND_TILE_GRID_CELLS,
  type GrassGroundPlacement,
} from "@/renderer/scene/decorations/grass-ground-layout";

function intersectsBounds(placement: GrassGroundPlacement, bounds: GridRect): boolean {
  const radius = placement.size / 2;
  return placement.x + radius > bounds.x
    && placement.x - radius < bounds.x + bounds.width
    && placement.y + radius > bounds.y
    && placement.y - radius < bounds.y + bounds.height;
}

describe("createGrassGroundLayout", () => {
  const bounds: GridRect = { x: 0, y: 0, width: 100, height: 100 };

  it("使用素材原始尺度和固定默认种子，重复创建不会改变分布", () => {
    const first = createGrassGroundLayout(bounds);

    expect(GRASS_GROUND_BASE_TEXTURE_KEY).toBe("texture-ground-v1/grass-base");
    expect(GRASS_GROUND_TILE_GRID_CELLS).toBe(16);
    expect(first.length).toBeGreaterThan(0);
    expect(createGrassGroundLayout(bounds)).toEqual(first);
    expect(createGrassGroundLayout(bounds, GRASS_GROUND_SEED)).toEqual(first);
    expect(createGrassGroundLayout(bounds, GRASS_GROUND_SEED + 1)).not.toEqual(first);
    expect(new Set(first.map((placement) => placement.id)).size).toBe(first.length);
  });

  it("保留已交付布局的世界位置、素材变体、尺度和旋转", () => {
    const patch = createGrassGroundLayout(bounds)
      .find((placement) => placement.id === "grass-patch:0:0");

    expect(patch).toEqual({
      id: "grass-patch:0:0",
      textureKey: "texture-ground-v1/grass-patch-04",
      layer: "patches",
      x: 1.7398401007521898,
      y: 3.264896816108376,
      size: 16 * 1.1209963613655418,
      rotation: 180,
    });
  });

  it("只使用交付素材、四个直角旋转及正向缩放，先铺草斑再铺碎石", () => {
    const placements = createGrassGroundLayout(bounds);
    const firstGravel = placements.findIndex((placement) => placement.layer === "gravel");

    expect(firstGravel).toBeGreaterThan(0);
    expect(placements.slice(0, firstGravel).every((placement) => placement.layer === "patches"))
      .toBe(true);
    expect(placements.slice(firstGravel).every((placement) => placement.layer === "gravel"))
      .toBe(true);

    for (const placement of placements) {
      expect([0, 90, 180, 270]).toContain(placement.rotation);
      if (placement.layer === "patches") {
        expect(placement.textureKey).toMatch(/^texture-ground-v1\/grass-patch-0[1-4]$/);
        expect(placement.size).toBeGreaterThanOrEqual(16 * 0.65);
        expect(placement.size).toBeLessThanOrEqual(16 * 1.25);
      } else {
        expect(placement.textureKey).toMatch(/^texture-ground-v1\/gravel-0[1-8]$/);
        expect(placement.size).toBeGreaterThanOrEqual(8 * 0.22);
        expect(placement.size).toBeLessThanOrEqual(8 * 0.58);
      }
    }
  });

  it("碎石保持稀疏分布，给连续草地区域留出空间", () => {
    const gravel = createGrassGroundLayout(bounds)
      .filter((placement) => placement.layer === "gravel");
    const centerInsideCount = gravel.filter((placement) =>
      placement.x >= bounds.x && placement.x < bounds.x + bounds.width
      && placement.y >= bounds.y && placement.y < bounds.y + bounds.height).length;
    const centerInsideDensity = centerInsideCount / (bounds.width * bounds.height / 3.2 ** 2);

    expect(centerInsideDensity).toBeGreaterThan(0.35);
    expect(centerInsideDensity).toBeLessThan(0.45);
  });

  it.each([
    { x: 0, y: 0, width: 100, height: 100 },
    { x: -31.25, y: -48.75, width: 67.5, height: 81.25 },
    { x: -0.01, y: -0.01, width: 0.02, height: 0.02 },
  ])("仅保留 AABB 与范围有交集的素材：%j", (testBounds) => {
    const placements = createGrassGroundLayout(testBounds);

    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((placement) => intersectsBounds(placement, testBounds))).toBe(true);
  });

  it("扩大范围或平移到负坐标后，重叠区域中的完整素材和混合顺序保持一致", () => {
    const larger = { x: -60, y: -70, width: 200, height: 210 };
    const smaller = { x: -12.5, y: -18.75, width: 35.5, height: 47.25 };
    const largerLayout = createGrassGroundLayout(larger);
    const smallerLayout = createGrassGroundLayout(smaller);

    expect(largerLayout.filter((placement) => intersectsBounds(placement, smaller)))
      .toEqual(smallerLayout);
    expect(smallerLayout.some((placement) => placement.x < 0 && placement.y < 0)).toBe(true);
  });

  it("相邻范围分别铺设时，跨越公共边界的素材完全一致", () => {
    const left = { x: -50, y: -25, width: 50, height: 50 };
    const right = { x: 0, y: -25, width: 50, height: 50 };
    const leftLayout = createGrassGroundLayout(left);
    const rightLayout = createGrassGroundLayout(right);
    const fromLeft = leftLayout.filter((placement) => intersectsBounds(placement, right));
    const fromRight = rightLayout.filter((placement) => intersectsBounds(placement, left));

    expect(fromLeft.length).toBeGreaterThan(0);
    expect(fromLeft).toEqual(fromRight);
  });

  it("包含来自边界外第二个散布单元、实际覆盖地图边缘的草斑", () => {
    const patch = createGrassGroundLayout(bounds, 33680)
      .find((placement) => placement.id === "grass-patch:-2:5");

    expect(patch).toEqual({
      id: "grass-patch:-2:5",
      textureKey: "texture-ground-v1/grass-patch-03",
      layer: "patches",
      x: -9.099332337733358,
      y: 46.92930287355557,
      size: 19.80584710240364,
      rotation: 90,
    });
    expect(patch!.x + patch!.size / 2).toBeGreaterThan(0);
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: 100, height: -1 },
    { x: Number.NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: Infinity, width: 100, height: 100 },
    { x: 0, y: 0, width: Infinity, height: 100 },
    { x: 0, y: 0, width: 100, height: Number.NaN },
    { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 100 },
  ])("无效范围返回空布局：%j", (testBounds) => {
    expect(createGrassGroundLayout(testBounds)).toEqual([]);
  });
});
