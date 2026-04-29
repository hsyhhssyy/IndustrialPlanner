import { Assets, Texture } from "pixi.js"
import { reaction } from "mobx"
import type { Renderer } from "pixi.js"

import type { AppContract } from "@/domain/contract/app-contract"
import { resolveRenderResolutionFromApp } from "@/renderer/render-resolution"

import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  type RenderTextureConfig,
} from "./texture-config"

const PREFIX_DEVICE_SPRITE = "device-sprite-"
const PREFIX_TEXTURE = "texture-"
const PREFIX_DEVICE_MASKS = "device-masks-"

/**
 * TextureActions 是 src/renderer/texture 对外唯一出口。
 * 目录外代码不得 import texture 目录下其他任何东西。
 */
interface TextureActions {
  getTexture(unifiedResourceKey: string): Promise<Texture>;
  destroy(): void;
}

class TextureActionsImpl implements TextureActions {
  private textureConfig: RenderTextureConfig

  private readonly texturePromisesByKey = new Map<string, Promise<Texture>>()
  private readonly trackedBitmapTextures = new Set<Texture>()
  private readonly disposeResolutionReaction: (() => void) | null
  private readonly renderer: Renderer
  private readonly app: AppContract | null
  private readonly syncTextureConfigState: (textureConfig: RenderTextureConfig) => void

  public constructor(options: {
    renderer: Renderer;
    app: AppContract | null;
    syncTextureConfigState?: (textureConfig: RenderTextureConfig) => void;
  }) {
    this.renderer = options.renderer
    this.app = options.app
    this.syncTextureConfigState = options.syncTextureConfigState ?? (() => undefined)
    const initialResolution = options.app !== null
      ? resolveRenderResolutionFromApp(options.app, 1)
      : 1
    this.textureConfig = createRenderTextureConfig({
      resolution: initialResolution,
    })
    this.syncTextureConfigState(this.textureConfig)

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

  public getTexture(unifiedResourceKey: string): Promise<Texture> {
    const existing = this.texturePromisesByKey.get(unifiedResourceKey)
    if (existing !== undefined) {
      return existing
    }

    const promise = this.resolveTexture(unifiedResourceKey)
    this.texturePromisesByKey.set(unifiedResourceKey, promise)
    return promise
  }

  public destroy(): void {
    this.disposeResolutionReaction?.()
    this.texturePromisesByKey.clear()
    this.trackedBitmapTextures.clear()
  }

  private syncResolution(resolution: number): void {
    if (resolution === this.textureConfig.renderResolution) {
      return
    }

    this.textureConfig = createRenderTextureConfig({ resolution })
    this.syncTextureConfigState(this.textureConfig)

    for (const texture of this.trackedBitmapTextures) {
      applyBitmapTextureConfig(texture, this.textureConfig)
    }
  }

  private async resolveTexture(key: string): Promise<Texture> {
    const paths = this.resolveCandidatePaths(key)

    if (paths.length === 0) {
      return this.createFallbackTexture()
    }

    for (const path of paths) {
      try {
        const texture = await Assets.load<Texture>(path)
        this.trackedBitmapTextures.add(texture)
        return applyBitmapTextureConfig(texture, this.textureConfig)
      } catch {
        // Try next candidate
      }
    }

    return this.createFallbackTexture()
  }

  private resolveCandidatePaths(key: string): string[] {
    if (key.startsWith(PREFIX_DEVICE_SPRITE)) {
      return [`/sprites/${key.slice(PREFIX_DEVICE_SPRITE.length)}.webp`]
    }

    if (key.startsWith(PREFIX_TEXTURE)) {
      const id = key.slice(PREFIX_TEXTURE.length)
      return [`/textures/${id}.webp`, `/textures/${id}.png`]
    }

    if (key.startsWith(PREFIX_DEVICE_MASKS)) {
      const id = key.slice(PREFIX_DEVICE_MASKS.length)
      return [`/sprite-masks/${id}.webp`, `/sprite-masks/${id}.png`]
    }

    return []
  }

  private createFallbackTexture(): Texture {
    const canvas = document.createElement("canvas")
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext("2d")
    if (ctx !== null) {
      ctx.fillStyle = "#ff0000"
      ctx.fillRect(0, 0, 16, 16)
    }
    return Texture.from(canvas)
  }
}

/**
 * 工厂函数，是 src/renderer/texture 对目录外唯一的公开入口。
 * 返回的 TextureActions 只有 getTexture 与 destroy 两个方法。
 * textureConfig 作为内部状态由 render host 持有，不额外 export。
 */
export function createTextureActions(options: {
  renderer: Renderer;
  app: AppContract | null;
  syncTextureConfigState?: (textureConfig: RenderTextureConfig) => void;
}): TextureActions {
  return new TextureActionsImpl(options)
}
