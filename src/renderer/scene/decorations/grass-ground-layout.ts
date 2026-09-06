import type { GridRect, GridRotation } from "@/domain/shared/grid";

export const GRASS_GROUND_BASE_TEXTURE_KEY = "texture-ground-v1/grass-base";
export const GRASS_GROUND_TILE_GRID_CELLS = 16;
export const GRASS_GROUND_SEED = 47031;

export interface GrassGroundPlacement {
  readonly id: string;
  readonly textureKey: string;
  readonly layer: "patches" | "gravel";
  /** 世界格坐标中的素材中心，与视口位置和缩放无关。 */
  readonly x: number;
  readonly y: number;
  /** 正方形素材覆盖的格数；素材中心锚点为 (0.5, 0.5)。 */
  readonly size: number;
  readonly rotation: GridRotation;
}

// 沿用 pixi-ground-v1 素材包的散布参数与哈希，1 个素材世界单位对应 1 格。
const GROUND_LAYER_SPECS = [
  {
    kind: "grass-patch",
    layer: "patches",
    cell: 9,
    count: 4,
    salt: 73,
    sourceSize: 16,
    minScale: 0.65,
    maxScale: 1.25,
    keepProbability: 1,
  },
  {
    kind: "gravel",
    layer: "gravel",
    cell: 3.2,
    count: 8,
    salt: 271,
    sourceSize: 8,
    minScale: 0.22,
    maxScale: 0.58,
    keepProbability: 0.4,
  },
] as const;

function hashGroundCell(seed: number, x: number, y: number, salt: number): number {
  let value = (seed
    ^ Math.imul(x, 374761393)
    ^ Math.imul(y, 668265263)
    ^ Math.imul(salt, 1274126177)) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function createGrassGroundLayout(
  bounds: GridRect,
  seed: number = GRASS_GROUND_SEED,
): readonly GrassGroundPlacement[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  if (!Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || !Number.isFinite(right)
    || !Number.isFinite(bottom)
    || bounds.width <= 0
    || bounds.height <= 0) {
    return [];
  }

  const placements: GrassGroundPlacement[] = [];
  for (const spec of GROUND_LAYER_SPECS) {
    // 草斑最大半径为 10 格，大于 9 格散布单元；必须向外搜索 2 个单元。
    const cellPadding = Math.ceil(spec.sourceSize * spec.maxScale / 2 / spec.cell);
    const firstColumn = Math.floor(bounds.x / spec.cell) - cellPadding;
    const lastColumn = Math.ceil(right / spec.cell) + cellPadding;
    const firstRow = Math.floor(bounds.y / spec.cell) - cellPadding;
    const lastRow = Math.ceil(bottom / spec.cell) + cellPadding;

    // 固定图层、行、列顺序，重叠素材在不同裁剪范围内也保持相同混合顺序。
    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        const random = (offset: number): number =>
          hashGroundCell(seed, column, row, spec.salt + offset) / 4294967296;
        if (random(7) < 1 - spec.keepProbability) {
          continue;
        }

        const x = (column + random(1)) * spec.cell;
        const y = (row + random(2)) * spec.cell;
        const size = spec.sourceSize
          * (spec.minScale + (spec.maxScale - spec.minScale) * random(3));
        const radius = size / 2;
        if (x + radius <= bounds.x || x - radius >= right
          || y + radius <= bounds.y || y - radius >= bottom) {
          continue;
        }

        const variant = String(1 + Math.floor(random(4) * spec.count)).padStart(2, "0");
        placements.push({
          id: `${spec.kind}:${column}:${row}`,
          textureKey: `texture-ground-v1/${spec.kind}-${variant}`,
          layer: spec.layer,
          x,
          y,
          size,
          rotation: (Math.floor(random(5) * 4) * 90) as GridRotation,
        });
      }
    }
  }

  return placements;
}
