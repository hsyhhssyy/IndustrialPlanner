import { BufferImageSource, ImageSource, Rectangle, Texture } from 'pixi.js';
import type { LogisticsStaticManifest } from '@/shared/logistics-material';
import type { LogisticsBakedManifest } from '@/shared/logistics-baked';
import { createPublicAssetUrl } from '@/shared/browser/public-asset-url';

const ROOT = '3d-top-view/logistics';

export interface LogisticsDynamicAssets {
  readonly manifest: LogisticsBakedManifest;
  readonly textures: ReadonlyMap<string, Texture>;
}

export interface LogisticsDynamicSession {
  readonly ready: Promise<LogisticsDynamicAssets>;
  release(): void;
}

interface LoadedImage { texture: Texture; bitmap: ImageBitmap | null }

/** 公共烘焙资源按渲染器生命周期常驻；没有按物品染色的独立图片或 RenderTexture。 */
export class LogisticsMaterialTextureCache {
  private readonly controller = new AbortController();
  private readonly images: LoadedImage[] = [];
  private readonly frames = new Map<string, Promise<Texture>>();
  private readonly subtextures = new Set<Texture>();
  private readonly staticPages = new Map<string, Promise<Texture>>();
  private staticManifest: Promise<LogisticsStaticManifest> | null = null;
  private dynamic: Promise<LogisticsDynamicAssets> | null = null;
  private owners = 0;
  private dynamicTextures = 0;
  private destroyed = false;

  public constructor(private readonly upload: (texture: Texture) => void = () => undefined) {}

  private async fetch(url: string): Promise<Response> {
    const response = await fetch(createPublicAssetUrl(url), { credentials: 'same-origin', signal: this.controller.signal });
    if (!response.ok) throw new Error(`Logistics asset request failed: ${response.status} ${url}`);
    return response;
  }

  private async loadImage(url: string, width: number, height: number, data = false): Promise<LoadedImage> {
    const response = await this.fetch(url);
    let bitmap: ImageBitmap | null = null;
    let texture: Texture;
    if (data) {
      if (!response.body) throw new Error(`Empty numeric texture: ${url}`);
      const rgba = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if (rgba.length !== width * height * 4) throw new Error(`Numeric texture dimensions differ: ${url}`);
      texture = new Texture({ source: new BufferImageSource({ resource: rgba, width, height, format: 'rgba8unorm',
        alphaMode: 'no-premultiply-alpha', scaleMode: 'linear', addressMode: 'clamp-to-edge', autoGenerateMipmaps: false }) });
    } else {
      bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
      if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error(`Texture dimensions differ: ${url}`); }
      texture = new Texture({ source: new ImageSource({ resource: bitmap, alphaMode: 'premultiplied-alpha',
        scaleMode: 'linear', addressMode: 'clamp-to-edge', autoGenerateMipmaps: false }) });
    }
    texture.source.label = url;
    texture.source.autoGarbageCollect = false;
    if (this.destroyed) { texture.destroy(true); bitmap?.close(); throw new Error('Logistics texture cache destroyed'); }
    try { this.upload(texture); }
    catch (error) { texture.destroy(true); bitmap?.close(); throw error; }
    const image = { texture, bitmap }; this.images.push(image); return image;
  }

  public getStatic(key: string): Promise<Texture> {
    if (this.destroyed) return Promise.reject(new Error('Logistics texture cache destroyed'));
    // 普通静态回退与虚影只显示空管，流体统一由路线 Mesh 绘制。
    const normalized = key.replace(/^pipe\/[^/]+\//, 'pipe/empty/');
    let frame = this.frames.get(normalized);
    if (!frame) { frame = this.loadStatic(normalized); this.frames.set(normalized, frame); }
    return frame;
  }

  private async loadStatic(key: string): Promise<Texture> {
    this.staticManifest ??= this.fetch(`${ROOT}/static/manifest.json`).then((response) => response.json() as Promise<LogisticsStaticManifest>);
    const manifest = await this.staticManifest;
    if (manifest.schemaVersion !== 1 || manifest.materialContractVersion !== 2) throw new Error('Invalid logistics static manifest');
    const frame = manifest.frames[key];
    const page = frame && manifest.pages[frame.page];
    if (!frame || !page || !/^[\w-]+\.webp$/.test(page.file)) throw new Error(`Missing static frame: ${key}`);
    let image = this.staticPages.get(frame.page);
    if (!image) {
      image = this.loadImage(`${ROOT}/static/${page.file}`, page.width, page.height).then((loaded) => loaded.texture);
      this.staticPages.set(frame.page, image);
    }
    const parent = await image;
    if (this.destroyed) throw new Error('Logistics texture cache destroyed');
    const texture = new Texture({ source: parent.source, frame: new Rectangle(...frame.rect) });
    this.subtextures.add(texture); return texture;
  }

  public acquireDynamic(): LogisticsDynamicSession {
    if (this.destroyed) throw new Error('Logistics texture cache destroyed');
    this.dynamic ??= this.loadDynamic().catch((error: unknown) => { this.dynamic = null; throw error; });
    this.owners++;
    let released = false;
    return { ready: this.dynamic, release: () => { if (!released) { released = true; this.owners--; } } };
  }

  private async loadDynamic(): Promise<LogisticsDynamicAssets> {
    const manifest = await (await this.fetch(`${ROOT}/baked/manifest.json`)).json() as LogisticsBakedManifest;
    if (manifest.schemaVersion !== 2 || manifest.format !== 'logistics-spritesheet-v2') throw new Error('Invalid baked logistics manifest');
    const textures = new Map<string, Texture>();
    const loaded: LoadedImage[] = [];
    try {
      const results = await Promise.allSettled(Object.entries(manifest.pages).map(async ([id, page]) => {
        if (!/^[\w-]+\.(?:webp|rgba\.bin)$/.test(page.file)) throw new Error(`Unsafe baked resource: ${page.file}`);
        const image = await this.loadImage(`${ROOT}/baked/${page.file}`, page.width, page.height, page.data);
        loaded.push(image); textures.set(id, image.texture);
      }));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (this.destroyed) throw new Error('Logistics texture cache destroyed');
      for (const [id, frame] of Object.entries(manifest.frames)) {
        const page = textures.get(frame.page);
        if (!page) throw new Error(`Missing baked frame page: ${id}`);
        const texture = new Texture({ source: page.source, frame: new Rectangle(...frame.rect),
          orig: new Rectangle(0, 0, ...frame.sourceSize), trim: new Rectangle(...frame.spriteSourceSize) });
        this.subtextures.add(texture); textures.set(id, texture);
      }
      this.dynamicTextures = loaded.length;
      return { manifest, textures };
    } catch (error) {
      // 等所有并发请求结束后回收本次失败加载，避免迟到结果重新写入缓存。
      for (const image of loaded) {
        const index = this.images.indexOf(image);
        if (index >= 0) { this.images.splice(index, 1); image.texture.destroy(true); image.bitmap?.close(); }
      }
      throw error;
    }
  }

  public getStats() {
    return { staticPages: this.staticPages.size, staticFrames: this.frames.size,
      dynamicOwners: this.owners, dynamicTextures: this.dynamicTextures,
      residentBytes: this.images.reduce((sum, image) => sum + image.texture.source.width * image.texture.source.height * 4, 0) };
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.controller.abort();
    for (const texture of this.subtextures) texture.destroy();
    for (const image of this.images.splice(0)) { image.texture.destroy(true); image.bitmap?.close(); }
    this.subtextures.clear(); this.frames.clear(); this.staticPages.clear(); this.dynamic = null; this.dynamicTextures = 0;
  }
}

// AI-REMOVED 2026-09-14:
// Reason: 整包实时材质改为共享烘焙图集，纹理需真实预上传并常驻。
// Trigger: 用户授权烘焙物流，取消设备动画开关控制和按颜色缓存。
// Evidence: 网站 v2 fluidPlayback 使用两张共享数值场。
// Replacement: 本文件新的 LogisticsMaterialTextureCache。
// Risk: 保留显存增加基础驻留量；不再随可见实例数卸载。
// Human Review: Required
// Original code:
// // AI-REMOVED 2026-09-13:
// // Reason: 网站新增物流绘制延后接入，恢复当前正式 WebP 材质读取与 Shader 绑定。
// // Trigger: 用户要求先导入其他素材，管道及传送带新绘制另行讨论。
// // Evidence: 正式 logistics-contract2 manifest 使用 WebP，且未声明新 Shader 资源。
// // Replacement: 下方 ImageSource 导入
// // Risk: Low; Human Review: Required
// // Original code:
// // import { BufferImageSource, ImageSource, Rectangle, Texture } from "pixi.js";
// import { ImageSource, Rectangle, Texture } from "pixi.js";
// import type {
//   LogisticsDynamicManifest,
//   LogisticsDynamicResource,
//   LogisticsStaticManifest,
// } from "@/shared/logistics-material";
// import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
//
// const ROOT = "3d-top-view/logistics";
// const DYNAMIC_ROOT = "3d-top-view/animations/logistics-contract2";
//
// export interface LogisticsDynamicAssets {
//   readonly manifest: LogisticsDynamicManifest;
//   readonly textures: ReadonlyMap<string, Texture>;
// }
//
// export interface LogisticsDynamicSession {
//   readonly ready: Promise<LogisticsDynamicAssets>;
//   release(): void;
// }
//
// interface LoadedImage {
//   readonly texture: Texture;
//   readonly bitmap: ImageBitmap | null;
// }
//
// interface DynamicLoad {
//   readonly controller: AbortController;
//   readonly images: LoadedImage[];
//   readonly ready: Promise<LogisticsDynamicAssets>;
//   owners: number;
// }
//
// async function readManifest<T>(url: string, signal?: AbortSignal): Promise<T> {
//   const response = await fetch(createPublicAssetUrl(url), { signal, credentials: "same-origin" });
//   if (!response.ok) throw new Error(`Logistics material request failed: ${response.status} ${url}`);
//   const data = await response.json() as T & { schemaVersion?: unknown; materialContractVersion?: unknown };
//   if (data.schemaVersion !== 1 || data.materialContractVersion !== 2) throw new Error(`Invalid logistics material manifest: ${url}`);
//   return data;
// }
//
// async function loadImage(url: string, resource: LogisticsDynamicResource, signal: AbortSignal): Promise<LoadedImage> {
//   const response = await fetch(createPublicAssetUrl(url), { signal, credentials: "same-origin" });
//   if (!response.ok) throw new Error(`Logistics texture request failed: ${response.status} ${url}`);
//   // AI-REMOVED 2026-09-13:
//   // Reason: 网站新增物流绘制延后接入，恢复当前正式 WebP 材质读取与 Shader 绑定。
//   // Trigger: 用户要求先导入其他素材，管道及传送带新绘制另行讨论。
//   // Evidence: 正式 logistics-contract2 manifest 使用 WebP，且未声明新 Shader 资源。
//   // Replacement: 下方 createImageBitmap / ImageSource 的数值纹理配置
//   // Risk: Low; Human Review: Required
//   // Original code:
//   // if (resource.data) {
//   //   if (!response.body) throw new Error(`Empty numeric texture response: ${url}`);
//   //   const data = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
//   //   if (signal.aborted || data.length !== resource.width * resource.height * 4) throw new Error(`Numeric texture aborted or dimensions differ: ${url}`);
//   //   const source = new BufferImageSource({ resource: data, width: resource.width, height: resource.height,
//   //     format: "rgba8unorm", alphaMode: "no-premultiply-alpha", scaleMode: resource.filter,
//   //     addressMode: resource.wrap === "repeat" ? "repeat" : "clamp-to-edge", autoGenerateMipmaps: false });
//   //   return { texture: new Texture({ source }), bitmap: null };
//   // }
//   const bitmap = await createImageBitmap(await response.blob(), {
//     premultiplyAlpha: resource.data ? "none" : "premultiply",
//     colorSpaceConversion: "none",
//   });
//   if (signal.aborted || bitmap.width !== resource.width || bitmap.height !== resource.height) {
//     bitmap.close();
//     throw new Error(`Logistics image aborted or dimensions differ: ${url}`);
//   }
//   const source = new ImageSource({
//     resource: bitmap,
//     alphaMode: resource.data ? "no-premultiply-alpha" : "premultiplied-alpha",
//     scaleMode: resource.filter,
//     addressMode: resource.wrap === "repeat" ? "repeat" : "clamp-to-edge",
//     autoGenerateMipmaps: false,
//   });
//   return { texture: new Texture({ source }), bitmap };
// }
//
// function destroyImages(images: LoadedImage[]): void {
//   for (const image of images.splice(0)) {
//     image.texture.destroy(true);
//     image.bitmap?.close();
//   }
// }
//
// /** 静态图集与动态原始字节分开持有，避免通用 bitmap 配置改坏数据纹理。 */
// export class LogisticsMaterialTextureCache {
//   private readonly staticController = new AbortController();
//   private readonly staticImages: LoadedImage[] = [];
//   private readonly staticPages = new Map<string, Promise<Texture>>();
//   private readonly frames = new Map<string, Promise<Texture>>();
//   private readonly frameTextures = new Set<Texture>();
//   private staticManifest: Promise<LogisticsStaticManifest> | null = null;
//   private dynamic: DynamicLoad | null = null;
//   private destroyed = false;
//
//   public getStatic(key: string): Promise<Texture> {
//     if (this.destroyed) return Promise.reject(new Error("Logistics texture cache is destroyed"));
//     const existing = this.frames.get(key);
//     if (existing) return existing;
//     const promise = this.loadStaticFrame(key);
//     this.frames.set(key, promise);
//     return promise;
//   }
//
//   public acquireDynamic(): LogisticsDynamicSession {
//     if (this.destroyed) throw new Error("Logistics texture cache is destroyed");
//     if (this.dynamic === null) {
//       const controller = new AbortController();
//       const images: LoadedImage[] = [];
//       const ready = this.loadDynamic(controller, images);
//       this.dynamic = { controller, images, ready, owners: 0 };
//     }
//     const load = this.dynamic;
//     load.owners += 1;
//     let released = false;
//     return {
//       ready: load.ready,
//       release: () => {
//         if (released) return;
//         released = true;
//         load.owners -= 1;
//         if (load.owners !== 0) return;
//         load.controller.abort();
//         destroyImages(load.images);
//         if (this.dynamic === load) this.dynamic = null;
//       },
//     };
//   }
//
//   public getStats() {
//     return {
//       staticPages: this.staticImages.length,
//       staticFrames: this.frameTextures.size,
//       dynamicOwners: this.dynamic?.owners ?? 0,
//       dynamicTextures: this.dynamic?.images.length ?? 0,
//     };
//   }
//
//   public destroy(): void {
//     if (this.destroyed) return;
//     this.destroyed = true;
//     this.staticController.abort();
//     this.dynamic?.controller.abort();
//     if (this.dynamic) destroyImages(this.dynamic.images);
//     this.dynamic = null;
//     for (const frame of this.frameTextures) frame.destroy();
//     this.frameTextures.clear();
//     destroyImages(this.staticImages);
//     this.frames.clear();
//     this.staticPages.clear();
//   }
//
//   private async loadStaticFrame(key: string): Promise<Texture> {
//     this.staticManifest ??= readManifest<LogisticsStaticManifest>(`${ROOT}/static/manifest.json`, this.staticController.signal);
//     const manifest = await this.staticManifest;
//     const frame = manifest.frames[key];
//     if (!frame) throw new Error(`Missing logistics static frame: ${key}`);
//     const page = manifest.pages[frame.page];
//     if (!page || !/^[\w-]+\.webp$/.test(page.file)) throw new Error(`Invalid logistics page: ${frame.page}`);
//     let loading = this.staticPages.get(frame.page);
//     if (!loading) {
//       loading = loadImage(`${ROOT}/static/${page.file}`, { ...page, data: false, filter: "linear", wrap: "clamp" }, this.staticController.signal)
//         .then((image) => {
//           if (this.destroyed) { destroyImages([image]); throw new Error("Logistics texture cache is destroyed"); }
//           this.staticImages.push(image);
//           return image.texture;
//         });
//       this.staticPages.set(frame.page, loading);
//     }
//     const texture = await loading;
//     if (this.destroyed) throw new Error("Logistics texture cache is destroyed");
//     const [x, y, width, height] = frame.rect;
//     if (![x, y, width, height, manifest.pixelsPerCell].every(Number.isSafeInteger) || x < 0 || y < 0
//       || manifest.pixelsPerCell <= 0 || width !== manifest.pixelsPerCell || height !== manifest.pixelsPerCell
//       || x + width > page.width || y + height > page.height) throw new Error(`Invalid logistics frame rectangle: ${key}`);
//     const result = new Texture({ source: texture.source, frame: new Rectangle(x, y, width, height) });
//     this.frameTextures.add(result);
//     return result;
//   }
//
//   private async loadDynamic(controller: AbortController, images: LoadedImage[]): Promise<LogisticsDynamicAssets> {
//     try {
//       const manifest = await readManifest<LogisticsDynamicManifest>(`${DYNAMIC_ROOT}/manifest.json`, controller.signal);
//       const unique = new Map<string, Promise<LoadedImage>>();
//       const textures = new Map<string, Texture>();
//       const results = await Promise.allSettled(Object.entries(manifest.resources).map(async ([key, resource]) => {
//         // AI-REMOVED 2026-09-13:
//         // Reason: 网站新增物流绘制延后接入，恢复当前正式 WebP 材质读取与 Shader 绑定。
//         // Trigger: 用户要求先导入其他素材，管道及传送带新绘制另行讨论。
//         // Evidence: 正式 logistics-contract2 manifest 使用 WebP，且未声明新 Shader 资源。
//         // Replacement: 当前正式资源统一 WebP 的文件名校验
//         // Risk: Low; Human Review: Required
//         // Original code:
//         // const filePattern = resource.data ? /^[\w-]+\.rgba\.bin$/ : /^[\w-]+\.webp$/;
//         const filePattern = /^[\w-]+\.webp$/;
//         if (!filePattern.test(resource.file)) throw new Error(`Invalid logistics texture: ${key}`);
//         const identity = `${resource.file}/${resource.data}/${resource.filter}/${resource.wrap}`;
//         let loading = unique.get(identity);
//         if (!loading) {
//           loading = loadImage(`${DYNAMIC_ROOT}/${resource.file}`, resource, controller.signal).then((image) => {
//             if (controller.signal.aborted) { destroyImages([image]); throw new Error("Logistics dynamic loading aborted"); }
//             images.push(image);
//             return image;
//           });
//           unique.set(identity, loading);
//         }
//         const image = await loading;
//         textures.set(key, image.texture);
//       }));
//       const failed = results.find((result) => result.status === "rejected");
//       if (failed?.status === "rejected") throw failed.reason;
//       if (controller.signal.aborted) throw new Error("Logistics dynamic loading aborted");
//       return { manifest, textures };
//     } catch (error) {
//       controller.abort();
//       destroyImages(images);
//       throw error;
//     }
//   }
// }
