import type { Texture } from 'pixi.js';
import type { SurfacePlacement } from './types';
import { fieldBounds, tileKeys, rasterizeHeightTile, HEIGHT_TILE_PIXELS } from './height-field';
import { BuildingEffectAssets, heightTexture } from './assets';

/** 索引只随几何变化更新；驻留范围只覆盖可见特效，动画与相机变换不会使既有区域失效。 */
export class SceneHeightCache {
  private surfaces = new Map<string, SurfacePlacement>();
  private readonly index = new Map<string, Set<string>>();
  private readonly tiles = new Map<string, Texture>();
  public builds = 0;

  public sync(next: readonly SurfacePlacement[]): void {
    const nextMap = new Map(next.map((surface) => [surface.id, surface]));
    for (const [id, old] of this.surfaces) {
      const current = nextMap.get(id);
      if (current && old.field === current.field && old.x === current.x && old.y === current.y
        && old.rotation === current.rotation && old.baseY === current.baseY) continue;
      for (const key of tileKeys(fieldBounds(old))) {
        this.invalidate(key);
        const ids = this.index.get(key); ids?.delete(id);
        if (ids?.size === 0) this.index.delete(key);
      }
    }
    for (const surface of next) {
      const old = this.surfaces.get(surface.id);
      if (old && old.field === surface.field && old.x === surface.x && old.y === surface.y
        && old.rotation === surface.rotation && old.baseY === surface.baseY) continue;
      for (const key of tileKeys(fieldBounds(surface))) {
        this.invalidate(key);
        let ids = this.index.get(key);
        if (!ids) { ids = new Set(); this.index.set(key, ids); }
        ids.add(surface.id);
      }
    }
    this.surfaces = nextMap;
  }

  public get(key: string, assets: BuildingEffectAssets, retained: Set<string>): Texture | undefined {
    const surfaces = [...this.index.get(key) ?? []].map((id) => this.surfaces.get(id)!);
    let ready = true;
    for (const surface of surfaces) {
      retained.add(surface.field.file);
      if (!assets.height(surface.field)) ready = false;
    }
    if (!ready || !assets.manifest) return undefined;
    let texture = this.tiles.get(key);
    if (!texture) {
      const bytes = rasterizeHeightTile(key, surfaces, assets.heights, assets.manifest.heightMin, assets.manifest.heightMax);
      texture = heightTexture(bytes, HEIGHT_TILE_PIXELS, HEIGHT_TILE_PIXELS);
      this.tiles.set(key, texture); this.builds++;
    }
    return texture;
  }

  public retain(keys: ReadonlySet<string>): void {
    for (const key of this.tiles.keys()) if (!keys.has(key)) this.invalidate(key);
  }

  public destroy(): void {
    for (const key of this.tiles.keys()) this.invalidate(key);
    this.surfaces.clear(); this.index.clear();
  }

  private invalidate(key: string): void {
    this.tiles.get(key)?.destroy(true); this.tiles.delete(key);
  }
}
