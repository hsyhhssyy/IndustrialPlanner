import { BufferImageSource, Texture, ImageSource } from 'pixi.js';
import { createPublicAssetUrl } from '@/shared/browser/public-asset-url';
import type { BuildingEffectsManifest, HeightField } from './types';
import { validateHeightBytes } from './height-field';

export function heightTexture(data: Uint8Array, width: number, height: number): Texture {
  return new Texture({ source: new BufferImageSource({ resource: data, width, height,
    format: 'rgba8unorm', scaleMode: 'nearest', autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha' }) });
}

/** 每个场景共享资源；AbortController 和迟到回调检查覆盖销毁期间的加载。 */
export class BuildingEffectAssets {
  public manifest: BuildingEffectsManifest | null = null;
  public revision = 0;
  public readonly heights = new Map<string, Uint8Array>();
  private readonly textures = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly abort = new AbortController();
  private destroyed = false;

  public constructor() {
    this.load('manifest.json', async (response) => {
      const manifest = await response.json() as BuildingEffectsManifest;
      if (manifest.schemaVersion !== 1 || !manifest.views || !manifest.effects) throw new Error('Invalid building effect manifest');
      if (!this.destroyed) this.manifest = manifest;
    });
  }

  public height(field: HeightField): Uint8Array | undefined {
    if (!this.heights.has(field.file)) this.load(field.file, async (response) => {
      if (!response.body) throw new Error(`Empty height response: ${field.file}`);
      const data = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      validateHeightBytes(data, field);
      if (!this.destroyed) this.heights.set(field.file, data);
    });
    return this.heights.get(field.file);
  }

  public template(field: HeightField): Texture | undefined {
    const data = this.height(field);
    if (data && !this.textures.has(field.file)) this.textures.set(field.file, heightTexture(data, field.width, field.height));
    return this.textures.get(field.file);
  }

  public color(file: string): Texture | undefined {
    if (!this.textures.has(file)) this.load(file, async (response) => {
      const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply' });
      if (this.destroyed) { bitmap.close(); return; }
      this.textures.set(file, new Texture({ source: new ImageSource({ resource: bitmap, alphaMode: 'premultiplied-alpha',
        scaleMode: 'linear', autoGenerateMipmaps: false }) }));
    });
    return this.textures.get(file);
  }

  public retain(heights: ReadonlySet<string>, colors: ReadonlySet<string>): void {
    for (const key of this.heights.keys()) if (!heights.has(key)) this.heights.delete(key);
    for (const [key, texture] of this.textures) {
      if (heights.has(key) || colors.has(key)) continue;
      this.release(texture); this.textures.delete(key);
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.abort.abort();
    for (const texture of this.textures.values()) this.release(texture);
    this.textures.clear(); this.heights.clear(); this.manifest = null;
  }

  private release(texture: Texture): void {
    const resource = texture.source.resource;
    texture.destroy(true);
    if (resource instanceof ImageBitmap) resource.close();
  }

  private load(file: string, consume: (response: Response) => Promise<void>): void {
    if (this.destroyed || this.pending.has(file) || this.failed.has(file)) return;
    this.pending.add(file);
    void fetch(createPublicAssetUrl(`3d-top-view/port-effects/${file}`), { signal: this.abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}: ${file}`);
        await consume(response);
        if (!this.destroyed) this.revision++;
      }).catch((error: unknown) => {
        if (!this.destroyed) { this.failed.add(file); console.error('[building-port-effects]', error); }
      }).finally(() => { this.pending.delete(file); });
  }
}
