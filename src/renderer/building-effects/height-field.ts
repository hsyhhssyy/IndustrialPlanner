import type { HeightField, SurfacePlacement, WorldBounds } from './types';

export const HEIGHT_TILE_CELLS = 4;
export const HEIGHT_PIXELS_PER_CELL = 128;
export const HEIGHT_TILE_PIXELS = HEIGHT_TILE_CELLS * HEIGHT_PIXELS_PER_CELL;

export function rotatePoint(x: number, y: number, degrees: number): [number, number] {
  const angle = degrees * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c * x - s * y, s * x + c * y];
}

export function decodeHeight(r: number, g: number, min: number, max: number): number {
  return min + (r * 256 + g) / 65535 * (max - min);
}

export function fieldBounds(surface: SurfacePlacement): WorldBounds {
  const { field } = surface;
  const points = [[0, 0], [field.width, 0], [field.width, field.height], [0, field.height]]
    .map(([x, y]) => rotatePoint((x! - field.pivot[0]) / field.pixelsPerCell + field.center[0],
      (y! - field.pivot[1]) / field.pixelsPerCell + field.center[1], surface.rotation));
  return { left: surface.x + Math.min(...points.map((p) => p[0])), right: surface.x + Math.max(...points.map((p) => p[0])),
    top: surface.y + Math.min(...points.map((p) => p[1])), bottom: surface.y + Math.max(...points.map((p) => p[1])) };
}

export function tileKeys(bounds: WorldBounds): string[] {
  const result: string[] = [];
  for (let y = Math.floor(bounds.top / HEIGHT_TILE_CELLS); y < Math.ceil(bounds.bottom / HEIGHT_TILE_CELLS); y++) {
    for (let x = Math.floor(bounds.left / HEIGHT_TILE_CELLS); x < Math.ceil(bounds.right / HEIGHT_TILE_CELLS); x++) result.push(`${x},${y}`);
  }
  return result;
}

/** Alpha=0 是空表面；按世界高度取最大值，删除时由该区域剩余表面重新构建。 */
export function rasterizeHeightTile(key: string, surfaces: readonly SurfacePlacement[],
  data: ReadonlyMap<string, Uint8Array>, min: number, max: number): Uint8Array {
  const [tileX, tileY] = key.split(',').map(Number);
  const left = tileX! * HEIGHT_TILE_CELLS, top = tileY! * HEIGHT_TILE_CELLS;
  const heights = new Float32Array(HEIGHT_TILE_PIXELS * HEIGHT_TILE_PIXELS).fill(-Infinity);
  for (const surface of surfaces) {
    const bytes = data.get(surface.field.file);
    if (!bytes) continue;
    const b = fieldBounds(surface), f = surface.field;
    const startX = Math.max(0, Math.floor((b.left - left) * HEIGHT_PIXELS_PER_CELL));
    const startY = Math.max(0, Math.floor((b.top - top) * HEIGHT_PIXELS_PER_CELL));
    const endX = Math.min(HEIGHT_TILE_PIXELS, Math.ceil((b.right - left) * HEIGHT_PIXELS_PER_CELL));
    const endY = Math.min(HEIGHT_TILE_PIXELS, Math.ceil((b.bottom - top) * HEIGHT_PIXELS_PER_CELL));
    const a = -surface.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    for (let y = startY; y < endY; y++) {
      const wy = top + (y + .5) / HEIGHT_PIXELS_PER_CELL - surface.y;
      for (let x = startX; x < endX; x++) {
        const wx = left + (x + .5) / HEIGHT_PIXELS_PER_CELL - surface.x;
        const sx = Math.floor((c * wx - s * wy - f.center[0]) * f.pixelsPerCell + f.pivot[0]);
        const sy = Math.floor((s * wx + c * wy - f.center[1]) * f.pixelsPerCell + f.pivot[1]);
        if (sx < 0 || sy < 0 || sx >= f.width || sy >= f.height) continue;
        const i = (sy * f.width + sx) * 4;
        if (bytes[i + 3] !== 255) continue;
        const height = decodeHeight(bytes[i]!, bytes[i + 1]!, f.min, f.max) + surface.baseY;
        const target = y * HEIGHT_TILE_PIXELS + x;
        heights[target] = Math.max(heights[target]!, height);
      }
    }
  }
  const rgba = new Uint8Array(heights.length * 4);
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) continue;
    const q = Math.round(Math.max(0, Math.min(1, (heights[i]! - min) / (max - min))) * 65535);
    rgba[i * 4] = q >>> 8; rgba[i * 4 + 1] = q & 255; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export function validateHeightBytes(bytes: Uint8Array, field: HeightField): void {
  if (bytes.length !== field.width * field.height * 4) throw new Error(`Invalid height byte length: ${field.file}`);
}
