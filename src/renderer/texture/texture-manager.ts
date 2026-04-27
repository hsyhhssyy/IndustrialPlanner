import { reaction } from "mobx"
import type {
  Renderer,
  Texture,
} from "pixi.js"

import type { AppContract } from "@/domain/contract/app-contract"
import { resolveRenderResolutionFromApp } from "@/renderer/render-resolution"

import {
  createCustomTexture,
  CustomTextureKey,
  type CustomTextureKey as CustomTextureKeyValue,
} from "./create-custom-texture"
import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  type RenderTextureConfig,
} from "./texture-config"

const CUSTOM_TEXTURE_KEYS = Object.values(CustomTextureKey) as CustomTextureKeyValue[]

export interface RenderTextureManager {
  readonly textureConfig: RenderTextureConfig;
  getCustomTexture(key: CustomTextureKeyValue): Texture | null;
  registerBitmapTexture(texture: Texture): Texture;
  destroy(): void;
}

class RenderTextureManagerImpl implements RenderTextureManager {
  public textureConfig: RenderTextureConfig

  private readonly customTextures: Partial<Record<CustomTextureKeyValue, Texture>> = {}
  private readonly trackedBitmapTextures = new Set<Texture>()
  private readonly ownedCustomTextures = new Set<Texture>()
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

    this.rebuildCustomTextures()
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

  public getCustomTexture(key: CustomTextureKeyValue): Texture | null {
    return this.customTextures[key] ?? null
  }

  public registerBitmapTexture(texture: Texture): Texture {
    if (this.trackedBitmapTextures.has(texture)) {
      return texture
    }

    this.trackedBitmapTextures.add(texture)

    return applyBitmapTextureConfig(texture, this.textureConfig)
  }

  public destroy(): void {
    this.disposeResolutionReaction?.()

    for (const texture of this.ownedCustomTextures) {
      texture.destroy(true)
    }

    this.ownedCustomTextures.clear()
    this.trackedBitmapTextures.clear()
  }

  private syncResolution(resolution: number): void {
    if (resolution === this.textureConfig.renderResolution) {
      return
    }

    this.textureConfig = createRenderTextureConfig({
      resolution,
    })
    this.rebuildCustomTextures()

    for (const texture of this.trackedBitmapTextures) {
      applyBitmapTextureConfig(texture, this.textureConfig)
    }
  }

  private rebuildCustomTextures(): void {
    for (const key of CUSTOM_TEXTURE_KEYS) {
      const texture = createCustomTexture({
        key,
        renderer: this.renderer,
        textureConfig: this.textureConfig,
      })

      this.customTextures[key] = texture
      this.ownedCustomTextures.add(texture)
    }
  }
}

export function createRenderTextureManager(options: {
  renderer: Renderer;
  app: AppContract | null;
  initialResolution: number;
}): RenderTextureManager {
  return new RenderTextureManagerImpl(options)
}