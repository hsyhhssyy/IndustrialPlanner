import { Assets, Texture } from "pixi.js"
import { reaction } from "mobx"
import type { Renderer } from "pixi.js"

import type { AppContract } from "@/domain/app/app-contract"
import { resolveRenderResolutionFromApp } from "@/renderer/render-resolution"
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url"

import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  type RenderTextureConfig,
} from "./texture-config"

const PREFIX_DEVICE_SPRITE = "device-sprite-"
const PREFIX_BLUEPRINT_SPRITE = "blueprint-sprite-"
const PREFIX_BLUEPRINT_MASKS = "blueprint-masks-"
const PREFIX_TOP_VIEW_AVATAR = "top-view-avatar-"
const PREFIX_BLUEPRINT_AVATAR = "blueprint-avatar-"
const PREFIX_TEXTURE = "texture-"
const PREFIX_DEVICE_MASKS = "device-masks-"
const PREFIX_ITEM_ICON = "item-icon-"
const TOP_VIEW_ASSET_ROOT = "3d-top-view"

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
        // AI-CORRECTION 2026-08-31: published raster 已收敛为单一 WebP 候选；失败后直接进入既有 fallback texture。
      }
    }

    return this.createFallbackTexture()
  }

  private resolveCandidatePaths(key: string): string[] {
    if (key.startsWith(PREFIX_DEVICE_SPRITE)) {
      return [createPublicAssetUrl(`${TOP_VIEW_ASSET_ROOT}/sprites/${key.slice(PREFIX_DEVICE_SPRITE.length)}.webp`)]
    }

    if (key.startsWith(PREFIX_BLUEPRINT_SPRITE)) {
      const id = key.slice(PREFIX_BLUEPRINT_SPRITE.length)
      return [createPublicAssetUrl(`blueprint-view/sprites/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_BLUEPRINT_MASKS)) {
      const id = key.slice(PREFIX_BLUEPRINT_MASKS.length)
      return [createPublicAssetUrl(`blueprint-view/sprite-masks/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_TOP_VIEW_AVATAR)) {
      const id = key.slice(PREFIX_TOP_VIEW_AVATAR.length)
      return [createPublicAssetUrl(`${TOP_VIEW_ASSET_ROOT}/avatar/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_BLUEPRINT_AVATAR)) {
      const id = key.slice(PREFIX_BLUEPRINT_AVATAR.length)
      return [createPublicAssetUrl(`blueprint-view/avatar/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_TEXTURE)) {
      const id = key.slice(PREFIX_TEXTURE.length)
      // AI-REMOVED 2026-08-31:
      // Reason: public 发布位图已统一为 WebP，PNG 不再是有效运行时资源。
      // Trigger: 用户要求删除 PNG 回退，避免 PWA 下载重复素材并让缺失 WebP fail-fast。
      // Evidence: 当前浏览器目标支持 WebP；public raster policy 要求非 WebP 位图为 0。
      // Replacement: 下方 WebP-only candidate。
      // Risk: WebP 缺失时直接返回既有红色 fallback texture，不再静默加载旧 PNG。
      // Human Review: Required
      //
      // Original code:
      // return [createPublicAssetUrl(`textures/${id}.webp`), createPublicAssetUrl(`textures/${id}.png`)]
      return [createPublicAssetUrl(`textures/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_DEVICE_MASKS)) {
      const id = key.slice(PREFIX_DEVICE_MASKS.length)
      // AI-REMOVED 2026-08-31:
      // Reason: top-view mask 已完成 WebP-only 迁移，同名 PNG 不是 active WebP 的等价回退。
      // Trigger: 用户要求删除 PNG 回退并移除 PWA 重复下载。
      // Evidence: 34 组 paired mask 解码像素均不同；8 个 PNG-only mask 已迁移为 lossless WebP。
      // Replacement: 下方 WebP-only candidate。
      // Risk: WebP 发布遗漏会显式进入 fallback texture，便于暴露产物错误。
      // Human Review: Required
      //
      // Original code:
      // return [
      //   createPublicAssetUrl(`${TOP_VIEW_ASSET_ROOT}/sprite-masks/${id}.webp`),
      //   createPublicAssetUrl(`${TOP_VIEW_ASSET_ROOT}/sprite-masks/${id}.png`),
      // ]
      return [createPublicAssetUrl(`${TOP_VIEW_ASSET_ROOT}/sprite-masks/${id}.webp`)]
    }

    if (key.startsWith(PREFIX_ITEM_ICON)) {
      const id = key.slice(PREFIX_ITEM_ICON.length)
      // AI-REMOVED 2026-08-31:
      // Reason: item icon 发布边界只允许 WebP，不再维护不存在的 PNG 候选。
      // Trigger: 用户要求全部 public 位图统一 WebP 并删除 PNG fallback。
      // Evidence: public/item-icons 当前全部为 WebP，目标浏览器均支持 WebP。
      // Replacement: 下方 WebP-only candidate。
      // Risk: 缺失 WebP 时进入既有 fallback texture。
      // Human Review: Required
      //
      // Original code:
      // return [createPublicAssetUrl(`item-icons/${id}.webp`), createPublicAssetUrl(`item-icons/${id}.png`)]
      return [createPublicAssetUrl(`item-icons/${id}.webp`)]
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
