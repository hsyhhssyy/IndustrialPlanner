import type {
  Renderer,
  Texture,
} from "pixi.js"

import type { RenderTextureConfig } from "./texture-config"

export {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  resolveBitmapTextureScaleLimit,
  resolveRepeatCompatibleTextureResolution,
} from "./texture-config"
export type {
  RenderTextureConfig,
  RenderTextureSamplingStrategy,
} from "./texture-config"

export type CustomTextureKey = string

export const CUSTOM_TEXTURE_KEYS: readonly CustomTextureKey[] = []

export function createCustomTexture(options: {
  key: CustomTextureKey;
  renderer: Renderer;
  textureConfig: RenderTextureConfig;
}): Texture {
  void options.renderer
  void options.textureConfig

  throw new Error(`Unknown custom texture key: ${options.key}`)
}