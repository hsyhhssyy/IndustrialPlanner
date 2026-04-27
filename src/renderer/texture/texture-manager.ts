import { Assets } from "pixi.js"
import { reaction } from "mobx"
import type {
  Renderer,
  Texture,
} from "pixi.js"

import type { AppContract } from "@/domain/contract/app-contract"
import { resolveRenderResolutionFromApp } from "@/renderer/render-resolution"

import {
  createCustomTexture,
} from "./create-custom-texture"
import {
  resolveRenderTextureProvider,
  type RenderTextureKey,
} from "./texture-registry"
import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  type RenderTextureConfig,
} from "./texture-config"

export interface RenderTextureManager {
  readonly textureConfig: RenderTextureConfig;
  getTexture(key: RenderTextureKey): Promise<Texture>;
  destroy(): void;
}

class RenderTextureManagerImpl implements RenderTextureManager {
  public textureConfig: RenderTextureConfig

  private readonly texturePromisesByKey = new Map<RenderTextureKey, Promise<Texture>>()
  private readonly bitmapTexturePromisesByPath = new Map<string, Promise<Texture>>()
  private readonly trackedBitmapTextures = new Set<Texture>()
  private readonly customTexturesByKey = new Map<RenderTextureKey, Texture>()
  private readonly disposeResolutionReaction: (() => void) | null

  public constructor(options: {
    renderer: Renderer;
    app: AppContract | null;
    initialResolution: number;
  }) {
    this.renderer = options.renderer
    this.app = options.app
    this.textureConfig = createRenderTextureConfig({
      resolution: options.initialResolution,
    })

    this.disposeResolutionReaction = this.app === null
      ? null
      : reaction(
        () => resolveRenderResolutionFromApp(
          this.app,
          this.textureConfig.renderResolution,
        ),
        (resolution) => {
          this.syncResolution(resolution)
        },
      )
  }

  private readonly renderer: Renderer
  private readonly app: AppContract | null

  public getTexture(key: RenderTextureKey): Promise<Texture> {
    const existingTexturePromise = this.texturePromisesByKey.get(key)
    if (existingTexturePromise !== undefined) {
      return existingTexturePromise
    }

    const provider = resolveRenderTextureProvider(key)
    if (provider === null) {
      return Promise.reject(new Error(`Unknown render texture key: ${key}`))
    }

    const nextTexturePromise = this.loadTextureFromProvider(key, provider).catch((error) => {
      this.texturePromisesByKey.delete(key)
      throw error
    })

    this.texturePromisesByKey.set(key, nextTexturePromise)

    return nextTexturePromise
  }

  public destroy(): void {
    this.disposeResolutionReaction?.()

    for (const texture of this.customTexturesByKey.values()) {
      texture.destroy(true)
    }

    this.texturePromisesByKey.clear()
    this.bitmapTexturePromisesByPath.clear()
    this.customTexturesByKey.clear()
    this.trackedBitmapTextures.clear()
  }

  private syncResolution(resolution: number): void {
    if (resolution === this.textureConfig.renderResolution) {
      return
    }

    this.textureConfig = createRenderTextureConfig({
      resolution,
    })
    this.invalidateCustomTextures()

    for (const texture of this.trackedBitmapTextures) {
      applyBitmapTextureConfig(texture, this.textureConfig)
    }
  }

  private loadTextureFromProvider(
    key: RenderTextureKey,
    provider: ReturnType<typeof resolveRenderTextureProvider> extends infer Provider
      ? Exclude<Provider, null>
      : never,
  ): Promise<Texture> {
    if (provider.kind === "bitmap") {
      return this.loadBitmapTexture(provider.assetPath, provider.fallbackKey)
    }

    const texture = createCustomTexture({
      key: provider.customTextureKey,
      renderer: this.renderer,
      textureConfig: this.textureConfig,
    })

    this.customTexturesByKey.set(key, texture)

    return Promise.resolve(texture)
  }

  private loadBitmapTexture(
    assetPath: string,
    fallbackKey?: RenderTextureKey,
  ): Promise<Texture> {
    const existingBitmapPromise = this.bitmapTexturePromisesByPath.get(assetPath)
    if (existingBitmapPromise !== undefined) {
      return existingBitmapPromise
    }

    const nextBitmapPromise = Assets.load<Texture>(assetPath)
      .then((texture) => this.trackBitmapTexture(texture))
      .catch((error) => {
        this.bitmapTexturePromisesByPath.delete(assetPath)

        if (fallbackKey !== undefined) {
          return this.getTexture(fallbackKey)
        }

        throw error
      })

    this.bitmapTexturePromisesByPath.set(assetPath, nextBitmapPromise)

    return nextBitmapPromise
  }

  private trackBitmapTexture(texture: Texture): Texture {
    this.trackedBitmapTextures.add(texture)

    return applyBitmapTextureConfig(texture, this.textureConfig)
  }

  private invalidateCustomTextures(): void {
    for (const [key, texture] of this.customTexturesByKey) {
      texture.destroy(true)
      this.texturePromisesByKey.delete(key)
    }

    this.customTexturesByKey.clear()
  }
}

export function createRenderTextureManager(options: {
  renderer: Renderer;
  app: AppContract | null;
  initialResolution: number;
}): RenderTextureManager {
  return new RenderTextureManagerImpl(options)
}