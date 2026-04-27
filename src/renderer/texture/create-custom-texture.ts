import {
  Graphics,
  Rectangle,
  type Renderer,
  type Texture,
} from "pixi.js"

import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import {
  applyTextureSamplingOptions,
  type RenderTextureConfig,
} from "./texture-config"

export {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  resolveBitmapTextureScaleLimit,
  resolveRepeatCompatibleTextureResolution,
  resolveWhiteScanLineRects,
} from "./texture-config"
export type {
  RenderTextureConfig,
  RenderTextureSamplingStrategy,
  ScanLineRect,
} from "./texture-config"

export const CustomTextureKey = {
  whiteScanLines: "white-scan-lines",
} as const

export type CustomTextureKey =
  typeof CustomTextureKey[keyof typeof CustomTextureKey]

export function createCustomTexture(options: {
  key: CustomTextureKey;
  renderer: Renderer;
  textureConfig: RenderTextureConfig;
}): Texture {
  switch (options.key) {
    case CustomTextureKey.whiteScanLines:
      return createWhiteScanLinesTexture(options)
  }
}

function createWhiteScanLinesTexture(options: {
  renderer: Renderer;
  textureConfig: RenderTextureConfig;
}): Texture {
  const graphics = new Graphics({ roundPixels: true })

  try {
    for (const rect of options.textureConfig.custom.whiteScanLineRects) {
      graphics
        .rect(0, rect.y, WORLD_GRID_CELL_PIXEL_SIZE, rect.height)
        .fill({
          color: 0xffffff,
        })
    }

    const texture = options.renderer.generateTexture({
      target: graphics,
      frame: new Rectangle(
        0,
        0,
        WORLD_GRID_CELL_PIXEL_SIZE,
        WORLD_GRID_CELL_PIXEL_SIZE,
      ),
      resolution: options.textureConfig.custom.repeatCompatibleResolution,
      clearColor: [0, 0, 0, 0],
      textureSourceOptions: {
        addressMode: "repeat",
        wrapMode: "repeat",
      },
    })

    return applyTextureSamplingOptions(texture, {
      repeatMode: "repeat",
      wrapMode: "repeat",
    })
  } finally {
    graphics.destroy()
  }
}