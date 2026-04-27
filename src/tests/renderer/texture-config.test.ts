import { describe, expect, it, vi } from "vitest"

import {
  createCustomTexture,
} from "@/renderer/texture/create-custom-texture"
import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
  DEFAULT_RENDER_TEXTURE_CELL_PIXEL_SIZE,
  resolveBitmapTextureScaleLimit,
} from "@/renderer/texture/texture-config"

describe("createRenderTextureConfig", () => {
  it("builds one shared config for bitmap and custom textures", () => {
    expect(createRenderTextureConfig({ resolution: 3 })).toEqual({
      renderResolution: 3,
      bitmap: {
        scaleLimit: 2,
        sampling: {
          scaleMode: "linear",
          autoGenerateMipmaps: true,
          mipmapFilter: "linear",
          maxAnisotropy: 4,
        },
      },
      custom: {
        cellPixelSize: DEFAULT_RENDER_TEXTURE_CELL_PIXEL_SIZE,
        repeatCompatibleResolution: 4,
      },
    })
  })
})

describe("resolveBitmapTextureScaleLimit", () => {
  it("caps bitmap upscale independently from render resolution", () => {
    expect(resolveBitmapTextureScaleLimit({ resolution: 1.5 })).toBe(1.5)
    expect(resolveBitmapTextureScaleLimit({ resolution: 3 })).toBe(2)
  })
})

describe("applyBitmapTextureConfig", () => {
  it("applies the shared bitmap sampling strategy to loaded textures", () => {
    const texture = {
      source: {
        scaleMode: "nearest",
        autoGenerateMipmaps: false,
        mipmapFilter: "nearest",
        style: {
          scaleMode: "nearest",
          mipmapFilter: "nearest",
          maxAnisotropy: 8,
          update: vi.fn(),
        },
        update: vi.fn(),
        updateMipmaps: vi.fn(),
      },
      update: vi.fn(),
    }

    applyBitmapTextureConfig(texture as never, createRenderTextureConfig({ resolution: 3 }))

    expect(texture.source).toMatchObject({
      scaleMode: "linear",
      autoGenerateMipmaps: true,
      mipmapFilter: "linear",
    })
    expect(texture.source.style).toMatchObject({
      scaleMode: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 4,
    })
    expect(texture.source.updateMipmaps).toHaveBeenCalledTimes(1)
  })
})

describe("createCustomTexture", () => {
  it("rejects unknown keys when no custom texture is registered", () => {
    expect(() => createCustomTexture({
      key: "future-custom-texture",
      renderer: {} as never,
      textureConfig: createRenderTextureConfig({ resolution: 3 }),
    })).toThrow("Unknown custom texture key: future-custom-texture")
  })
})