import { makeAutoObservable, runInAction } from "mobx"
import { afterEach, describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("pixi.js", () => ({
  Assets: {
    load: loadTexture,
  },
}))

vi.mock("@/renderer/texture/create-custom-texture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/texture/create-custom-texture")>()

  return {
    ...actual,
  }
})

import { resolveGenericDeviceSpriteTextureKeys } from "@/renderer/texture/texture-registry"
import { createRenderTextureManager } from "@/renderer/texture/texture-manager"

afterEach(() => {
  loadTexture.mockReset()
})

class ScreenProfileState {
  public devicePixelRatio = 2

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }
}

describe("RenderTextureManager", () => {
  it("loads and caches bitmap textures by usage key", async () => {
    const textureKeys = resolveGenericDeviceSpriteTextureKeys("item_port_storager_1")
    const bitmapTexture = createLoadedTextureMock("device-body")

    expect(textureKeys).not.toBeNull()

    if (textureKeys === null) {
      throw new Error("Expected generic device texture keys to resolve.")
    }

    loadTexture.mockResolvedValue(bitmapTexture)

    const manager = createRenderTextureManager({
      renderer: {} as never,
      app: null,
      initialResolution: 2,
    })

    const firstTexture = await manager.getTexture(textureKeys.body)
    const secondTexture = await manager.getTexture(textureKeys.body)

    expect(firstTexture).toBe(bitmapTexture)
    expect(secondTexture).toBe(bitmapTexture)
    expect(loadTexture).toHaveBeenCalledTimes(1)
    expect(loadTexture).toHaveBeenCalledWith("/sprites/item_port_storager_1.webp")

    manager.destroy()
  })

  it("falls back to body texture when preview mask asset is missing", async () => {
    const textureKeys = resolveGenericDeviceSpriteTextureKeys("item_port_storager_1")
    const bitmapTexture = createLoadedTextureMock("device-body")

    expect(textureKeys).not.toBeNull()

    if (textureKeys === null) {
      throw new Error("Expected generic device texture keys to resolve.")
    }

    loadTexture.mockImplementation((assetPath: string) => {
      if (assetPath.startsWith("/sprite-masks/")) {
        return Promise.reject(new Error("missing preview mask"))
      }

      return Promise.resolve(bitmapTexture)
    })

    const manager = createRenderTextureManager({
      renderer: {} as never,
      app: null,
      initialResolution: 2,
    })

    const previewMaskTexture = await manager.getTexture(textureKeys.previewMask)
    const cachedPreviewMaskTexture = await manager.getTexture(textureKeys.previewMask)

    expect(previewMaskTexture).toBe(bitmapTexture)
    expect(cachedPreviewMaskTexture).toBe(bitmapTexture)
    expect(loadTexture).toHaveBeenCalledTimes(2)
    expect(loadTexture).toHaveBeenNthCalledWith(1, "/sprite-masks/item_port_storager_1.webp")
    expect(loadTexture).toHaveBeenNthCalledWith(2, "/sprites/item_port_storager_1.webp")

    manager.destroy()
  })

  it("reacts to mobx dpr changes and reapplies bitmap sampling to loaded textures", async () => {
    const screenProfile = new ScreenProfileState()
    const textureKeys = resolveGenericDeviceSpriteTextureKeys("item_port_storager_1")
    const bitmapTexture = {
      source: {
        scaleMode: "nearest",
        autoGenerateMipmaps: false,
        mipmapFilter: "nearest",
        style: {
          scaleMode: "nearest",
          mipmapFilter: "nearest",
          maxAnisotropy: 1,
          update: vi.fn(),
        },
        update: vi.fn(),
        updateMipmaps: vi.fn(),
      },
      update: vi.fn(),
    }

    expect(textureKeys).not.toBeNull()

    if (textureKeys === null) {
      throw new Error("Expected generic device texture keys to resolve.")
    }

    loadTexture.mockResolvedValue(bitmapTexture)

    const manager = createRenderTextureManager({
      renderer: {} as never,
      app: {
        state: {
          screenProfile,
        },
      } as never,
      initialResolution: 2,
    })

    await manager.getTexture(textureKeys.body)

    expect(manager.textureConfig.renderResolution).toBe(2)

    runInAction(() => {
      screenProfile.devicePixelRatio = 3
    })

    expect(manager.textureConfig.renderResolution).toBe(3)
    expect(bitmapTexture.source.scaleMode).toBe("linear")
    expect(bitmapTexture.source.autoGenerateMipmaps).toBe(true)
    expect(bitmapTexture.source.updateMipmaps).toHaveBeenCalledTimes(2)

    manager.destroy()
  })
})

function createLoadedTextureMock(id: string) {
  return {
    id,
    source: {
      scaleMode: "linear",
      autoGenerateMipmaps: false,
      mipmapFilter: "nearest",
      style: {
        scaleMode: "nearest",
        mipmapFilter: "nearest",
        maxAnisotropy: 4,
        update: vi.fn(),
      },
      update: vi.fn(),
      updateMipmaps: vi.fn(),
    },
    update: vi.fn(),
  }
}