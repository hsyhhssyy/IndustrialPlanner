import { describe, expect, it, vi } from "vitest"

const { pixiState } = vi.hoisted(() => ({
  pixiState: {
    graphicsInstances: [] as Array<{
      commands: Array<unknown>;
    }>,
  },
}))

vi.mock("pixi.js", () => {
  class MockGraphics {
    public readonly commands: Array<
      | {
        type: "rect";
        x: number;
        y: number;
        width: number;
        height: number;
      }
      | {
        type: "fill";
        options: {
          color: number;
          alpha?: number;
        };
      }
      | {
        type: "destroy";
      }
    > = []

    public constructor() {
      pixiState.graphicsInstances.push(this)
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.commands.push({ type: "rect", x, y, width, height })
      return this
    }

    public fill(options: { color: number; alpha?: number }): this {
      this.commands.push({ type: "fill", options })
      return this
    }

    public destroy(): void {
      this.commands.push({ type: "destroy" })
    }
  }

  class MockRectangle {
    public constructor(
      public readonly x: number,
      public readonly y: number,
      public readonly width: number,
      public readonly height: number,
    ) {}
  }

  return {
    Graphics: MockGraphics,
    Rectangle: MockRectangle,
  }
})

import {
  createCustomTexture,
  CustomTextureKey,
} from "@/renderer/texture/create-custom-texture"
import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
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
          mipmap: false,
          mipmapFilter: "linear",
          maxAnisotropy: 1,
        },
      },
      custom: {
        repeatCompatibleResolution: 4,
        whiteScanLineRects: [
          { y: 0, height: 4 },
          { y: 5, height: 4 },
          { y: 10, height: 4 },
          { y: 15, height: 1 },
        ],
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
        mipmap: true,
        mipmapFilter: "nearest",
        style: {
          scaleMode: "nearest",
          mipmapFilter: "nearest",
          maxAnisotropy: 8,
          update: vi.fn(),
        },
        update: vi.fn(),
      },
      update: vi.fn(),
    }

    applyBitmapTextureConfig(texture as never, createRenderTextureConfig({ resolution: 3 }))

    expect(texture.source).toMatchObject({
      scaleMode: "linear",
      mipmap: false,
      mipmapFilter: "linear",
    })
    expect(texture.source.style).toMatchObject({
      scaleMode: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 1,
    })
  })
})

describe("createCustomTexture", () => {
  it("uses the shared config as the only custom-texture input", () => {
    pixiState.graphicsInstances.length = 0

    const texture = {
      source: {
        repeatMode: "clamp-to-edge",
        wrapMode: "clamp-to-edge",
        style: {
          wrapMode: "clamp-to-edge",
          update: vi.fn(),
        },
        update: vi.fn(),
      },
      update: vi.fn(),
    }
    const generateTexture = vi.fn(() => texture)
    const textureConfig = createRenderTextureConfig({ resolution: 3 })

    const result = createCustomTexture({
      key: CustomTextureKey.whiteScanLines,
      renderer: {
        generateTexture,
      } as never,
      textureConfig,
    })

    expect(result).toBe(texture)
    expect(generateTexture).toHaveBeenCalledWith(expect.objectContaining({
      resolution: 4,
      clearColor: [0, 0, 0, 0],
      textureSourceOptions: {
        addressMode: "repeat",
        wrapMode: "repeat",
      },
      frame: {
        x: 0,
        y: 0,
        width: 16,
        height: 16,
      },
    }))
    expect(pixiState.graphicsInstances[0]?.commands).toEqual([
      { type: "rect", x: 0, y: 0, width: 16, height: 4 },
      { type: "fill", options: { color: 0xffffff } },
      { type: "rect", x: 0, y: 5, width: 16, height: 4 },
      { type: "fill", options: { color: 0xffffff } },
      { type: "rect", x: 0, y: 10, width: 16, height: 4 },
      { type: "fill", options: { color: 0xffffff } },
      { type: "rect", x: 0, y: 15, width: 16, height: 1 },
      { type: "fill", options: { color: 0xffffff } },
      { type: "destroy" },
    ])
    expect(texture.source.repeatMode).toBe("repeat")
    expect(texture.source.wrapMode).toBe("repeat")
    expect(texture.source.style.wrapMode).toBe("repeat")
  })
})