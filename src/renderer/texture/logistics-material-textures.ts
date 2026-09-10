import { ImageSource, Rectangle, Texture } from "pixi.js";
import type {
  LogisticsDynamicManifest,
  LogisticsDynamicResource,
  LogisticsStaticManifest,
} from "@/shared/logistics-material";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

const ROOT = "3d-top-view/logistics";
const DYNAMIC_ROOT = "3d-top-view/animations/logistics-contract2";

export interface LogisticsDynamicAssets {
  readonly manifest: LogisticsDynamicManifest;
  readonly textures: ReadonlyMap<string, Texture>;
}

export interface LogisticsDynamicSession {
  readonly ready: Promise<LogisticsDynamicAssets>;
  release(): void;
}

interface LoadedImage {
  readonly texture: Texture;
  readonly bitmap: ImageBitmap;
}

interface DynamicLoad {
  readonly controller: AbortController;
  readonly images: LoadedImage[];
  readonly ready: Promise<LogisticsDynamicAssets>;
  owners: number;
}

async function readManifest<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(createPublicAssetUrl(url), { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Logistics material request failed: ${response.status} ${url}`);
  const data = await response.json() as T & { schemaVersion?: unknown; materialContractVersion?: unknown };
  if (data.schemaVersion !== 1 || data.materialContractVersion !== 2) throw new Error(`Invalid logistics material manifest: ${url}`);
  return data;
}

async function loadImage(url: string, resource: LogisticsDynamicResource, signal: AbortSignal): Promise<LoadedImage> {
  const response = await fetch(createPublicAssetUrl(url), { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Logistics texture request failed: ${response.status} ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: resource.data ? "none" : "premultiply",
    colorSpaceConversion: "none",
  });
  if (signal.aborted || bitmap.width !== resource.width || bitmap.height !== resource.height) {
    bitmap.close();
    throw new Error(`Logistics image aborted or dimensions differ: ${url}`);
  }
  const source = new ImageSource({
    resource: bitmap,
    alphaMode: resource.data ? "no-premultiply-alpha" : "premultiplied-alpha",
    scaleMode: resource.filter,
    addressMode: resource.wrap === "repeat" ? "repeat" : "clamp-to-edge",
    autoGenerateMipmaps: false,
  });
  return { texture: new Texture({ source }), bitmap };
}

function destroyImages(images: LoadedImage[]): void {
  for (const image of images.splice(0)) {
    image.texture.destroy(true);
    image.bitmap.close();
  }
}

/** 静态图集与动态原始字节分开持有，避免通用 bitmap 配置改坏数据纹理。 */
export class LogisticsMaterialTextureCache {
  private readonly staticController = new AbortController();
  private readonly staticImages: LoadedImage[] = [];
  private readonly staticPages = new Map<string, Promise<Texture>>();
  private readonly frames = new Map<string, Promise<Texture>>();
  private readonly frameTextures = new Set<Texture>();
  private staticManifest: Promise<LogisticsStaticManifest> | null = null;
  private dynamic: DynamicLoad | null = null;
  private destroyed = false;

  public getStatic(key: string): Promise<Texture> {
    if (this.destroyed) return Promise.reject(new Error("Logistics texture cache is destroyed"));
    const existing = this.frames.get(key);
    if (existing) return existing;
    const promise = this.loadStaticFrame(key);
    this.frames.set(key, promise);
    return promise;
  }

  public acquireDynamic(): LogisticsDynamicSession {
    if (this.destroyed) throw new Error("Logistics texture cache is destroyed");
    if (this.dynamic === null) {
      const controller = new AbortController();
      const images: LoadedImage[] = [];
      const ready = this.loadDynamic(controller, images);
      this.dynamic = { controller, images, ready, owners: 0 };
    }
    const load = this.dynamic;
    load.owners += 1;
    let released = false;
    return {
      ready: load.ready,
      release: () => {
        if (released) return;
        released = true;
        load.owners -= 1;
        if (load.owners !== 0) return;
        load.controller.abort();
        destroyImages(load.images);
        if (this.dynamic === load) this.dynamic = null;
      },
    };
  }

  public getStats() {
    return {
      staticPages: this.staticImages.length,
      staticFrames: this.frameTextures.size,
      dynamicOwners: this.dynamic?.owners ?? 0,
      dynamicTextures: this.dynamic?.images.length ?? 0,
    };
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staticController.abort();
    this.dynamic?.controller.abort();
    if (this.dynamic) destroyImages(this.dynamic.images);
    this.dynamic = null;
    for (const frame of this.frameTextures) frame.destroy();
    this.frameTextures.clear();
    destroyImages(this.staticImages);
    this.frames.clear();
    this.staticPages.clear();
  }

  private async loadStaticFrame(key: string): Promise<Texture> {
    this.staticManifest ??= readManifest<LogisticsStaticManifest>(`${ROOT}/static/manifest.json`, this.staticController.signal);
    const manifest = await this.staticManifest;
    const frame = manifest.frames[key];
    if (!frame) throw new Error(`Missing logistics static frame: ${key}`);
    const page = manifest.pages[frame.page];
    if (!page || !/^[\w-]+\.webp$/.test(page.file)) throw new Error(`Invalid logistics page: ${frame.page}`);
    let loading = this.staticPages.get(frame.page);
    if (!loading) {
      loading = loadImage(`${ROOT}/static/${page.file}`, { ...page, data: false, filter: "linear", wrap: "clamp" }, this.staticController.signal)
        .then((image) => {
          if (this.destroyed) { destroyImages([image]); throw new Error("Logistics texture cache is destroyed"); }
          this.staticImages.push(image);
          return image.texture;
        });
      this.staticPages.set(frame.page, loading);
    }
    const texture = await loading;
    if (this.destroyed) throw new Error("Logistics texture cache is destroyed");
    const [x, y, width, height] = frame.rect;
    if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width !== 128 || height !== 128
      || x + width > page.width || y + height > page.height) throw new Error(`Invalid logistics frame rectangle: ${key}`);
    const result = new Texture({ source: texture.source, frame: new Rectangle(x, y, width, height) });
    this.frameTextures.add(result);
    return result;
  }

  private async loadDynamic(controller: AbortController, images: LoadedImage[]): Promise<LogisticsDynamicAssets> {
    try {
      const manifest = await readManifest<LogisticsDynamicManifest>(`${DYNAMIC_ROOT}/manifest.json`, controller.signal);
      const unique = new Map<string, Promise<LoadedImage>>();
      const textures = new Map<string, Texture>();
      const results = await Promise.allSettled(Object.entries(manifest.resources).map(async ([key, resource]) => {
        if (!/^[\w-]+\.webp$/.test(resource.file)) throw new Error(`Invalid logistics texture: ${key}`);
        const identity = `${resource.file}/${resource.data}/${resource.filter}/${resource.wrap}`;
        let loading = unique.get(identity);
        if (!loading) {
          loading = loadImage(`${DYNAMIC_ROOT}/${resource.file}`, resource, controller.signal).then((image) => {
            if (controller.signal.aborted) { destroyImages([image]); throw new Error("Logistics dynamic loading aborted"); }
            images.push(image);
            return image;
          });
          unique.set(identity, loading);
        }
        const image = await loading;
        textures.set(key, image.texture);
      }));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (controller.signal.aborted) throw new Error("Logistics dynamic loading aborted");
      return { manifest, textures };
    } catch (error) {
      controller.abort();
      destroyImages(images);
      throw error;
    }
  }
}
