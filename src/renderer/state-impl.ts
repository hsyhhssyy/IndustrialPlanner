import type { Texture } from "pixi.js"

import {
  createRenderTextureConfig,
  type RenderTextureConfig,
} from "./texture/texture-config"

export interface RenderStateReadWrite {
  customTextures: Record<string, Texture>;
  textureConfig: RenderTextureConfig;
}

export function createRenderStateReadWrite(options?: {
  resolution?: number;
}): RenderStateReadWrite {
  return {
    customTextures: {},
    textureConfig: createRenderTextureConfig({
      resolution: options?.resolution ?? 1,
    }),
  }
}

export function updateRenderTextureConfig(options: {
  state: RenderStateReadWrite;
  resolution: number;
}): boolean {
  const nextConfig = createRenderTextureConfig({
    resolution: options.resolution,
  })

  if (options.state.textureConfig.renderResolution === nextConfig.renderResolution) {
    return false
  }

  options.state.textureConfig = nextConfig

  return true
}