import type {
  SCALE_MODE,
  Texture,
  WRAP_MODE,
} from "pixi.js"

import { resolveRenderResolutionValue } from "@/renderer/render-resolution"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"

const DEFAULT_BITMAP_TEXTURE_SCALE_LIMIT = 2
const DEFAULT_BITMAP_TEXTURE_SCALE_MODE: SCALE_MODE = "linear"
const DEFAULT_BITMAP_TEXTURE_MIPMAP_FILTER: SCALE_MODE = "linear"
const DEFAULT_BITMAP_TEXTURE_AUTO_GENERATE_MIPMAPS = true
const DEFAULT_BITMAP_TEXTURE_MAX_ANISOTROPY = 4

export interface ScanLineRect {
  y: number;
  height: number;
}

export interface RenderTextureSamplingStrategy {
  scaleMode: SCALE_MODE;
  autoGenerateMipmaps: boolean;
  mipmapFilter: SCALE_MODE;
  maxAnisotropy: number;
}

export interface RenderTextureConfig {
  renderResolution: number;
  bitmap: {
    scaleLimit: number;
    sampling: RenderTextureSamplingStrategy;
  };
  custom: {
    repeatCompatibleResolution: number;
    whiteScanLineRects: readonly ScanLineRect[];
  };
}

export function resolveRepeatCompatibleTextureResolution(resolution: number): number {
  const normalizedResolution = Math.max(1, resolveRenderResolutionValue(resolution))
  let nextResolution = 1

  while (nextResolution < normalizedResolution) {
    nextResolution *= 2
  }

  return nextResolution
}

export function resolveBitmapTextureScaleLimit(options: {
  resolution: number;
  maxScale?: number;
}): number {
  const normalizedResolution = Math.max(1, resolveRenderResolutionValue(options.resolution))
  const normalizedMaxScale = Math.max(
    1,
    resolveRenderResolutionValue(
      options.maxScale ?? DEFAULT_BITMAP_TEXTURE_SCALE_LIMIT,
      DEFAULT_BITMAP_TEXTURE_SCALE_LIMIT,
    ),
  )

  return Math.min(normalizedResolution, normalizedMaxScale)
}

export function createRenderTextureConfig(options: {
  resolution: number;
  cellSize?: number;
}): RenderTextureConfig {
  const renderResolution = Math.max(1, resolveRenderResolutionValue(options.resolution))
  const repeatCompatibleResolution = resolveRepeatCompatibleTextureResolution(renderResolution)

  return {
    renderResolution,
    bitmap: {
      scaleLimit: resolveBitmapTextureScaleLimit({
        resolution: renderResolution,
      }),
      sampling: {
        scaleMode: DEFAULT_BITMAP_TEXTURE_SCALE_MODE,
        autoGenerateMipmaps: DEFAULT_BITMAP_TEXTURE_AUTO_GENERATE_MIPMAPS,
        mipmapFilter: DEFAULT_BITMAP_TEXTURE_MIPMAP_FILTER,
        maxAnisotropy: DEFAULT_BITMAP_TEXTURE_MAX_ANISOTROPY,
      },
    },
    custom: {
      repeatCompatibleResolution,
      whiteScanLineRects: resolveWhiteScanLineRects({
        cellSize: options.cellSize,
        resolution: repeatCompatibleResolution,
      }),
    },
  }
}

export function resolveWhiteScanLineRects(options: {
  cellSize?: number;
  resolution: number;
}): ScanLineRect[] {
  const cellSize = Math.max(1, Math.floor(options.cellSize ?? WORLD_GRID_CELL_PIXEL_SIZE))
  const normalizedResolution = resolveRenderResolutionValue(options.resolution)
  const lineThickness = Math.max(1, Math.round(normalizedResolution))
  const linePitch = Math.max(lineThickness + 1, Math.floor(cellSize / 4))
  const rects: ScanLineRect[] = []

  for (let y = 0; y < cellSize; y += linePitch) {
    rects.push({
      y,
      height: Math.min(lineThickness, cellSize - y),
    })
  }

  return rects
}

export function applyBitmapTextureConfig(
  texture: Texture,
  textureConfig: RenderTextureConfig,
): Texture {
  return applyTextureSamplingOptions(texture, {
    scaleMode: textureConfig.bitmap.sampling.scaleMode,
    autoGenerateMipmaps: textureConfig.bitmap.sampling.autoGenerateMipmaps,
    mipmapFilter: textureConfig.bitmap.sampling.mipmapFilter,
    maxAnisotropy: textureConfig.bitmap.sampling.maxAnisotropy,
  })
}

export function applyTextureSamplingOptions(
  texture: Texture,
  options: {
    scaleMode?: SCALE_MODE;
    autoGenerateMipmaps?: boolean;
    mipmapFilter?: SCALE_MODE;
    maxAnisotropy?: number;
    wrapMode?: WRAP_MODE;
    repeatMode?: WRAP_MODE;
  },
): Texture {
  const source = (texture as Texture & {
    source?: {
      scaleMode?: SCALE_MODE;
      autoGenerateMipmaps?: boolean;
      mipmapFilter?: SCALE_MODE;
      wrapMode?: WRAP_MODE;
      repeatMode?: WRAP_MODE;
      style?: {
        scaleMode?: SCALE_MODE;
        mipmapFilter?: SCALE_MODE;
        wrapMode?: WRAP_MODE;
        maxAnisotropy?: number;
        update?: () => void;
      };
      update?: () => void;
      updateMipmaps?: () => void;
    };
    update?: () => void;
  }).source

  if (!source) {
    return texture
  }

  if (options.scaleMode !== undefined) {
    source.scaleMode = options.scaleMode

    if (source.style) {
      source.style.scaleMode = options.scaleMode
    }
  }

  if (options.autoGenerateMipmaps !== undefined) {
    source.autoGenerateMipmaps = options.autoGenerateMipmaps
  }

  if (options.mipmapFilter !== undefined) {
    source.mipmapFilter = options.mipmapFilter

    if (source.style) {
      source.style.mipmapFilter = options.mipmapFilter
    }
  }

  if (options.maxAnisotropy !== undefined && source.style) {
    source.style.maxAnisotropy = options.maxAnisotropy
  }

  if (options.wrapMode !== undefined) {
    source.wrapMode = options.wrapMode

    if (source.style) {
      source.style.wrapMode = options.wrapMode
    }
  }

  if (options.repeatMode !== undefined) {
    source.repeatMode = options.repeatMode
  }

  source.style?.update?.()
  source.update?.()
  if (source.autoGenerateMipmaps) {
    source.updateMipmaps?.()
  }
  ;(texture as Texture & { update?: () => void }).update?.()

  return texture
}