import { makeAutoObservable, runInAction } from "mobx"
import { afterEach, describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("pixi.js", () => ({
  Assets: {
    load: loadTexture,
  },
  Texture: {
    from: () => ({
      destroy: vi.fn(),
    }),
  },
}))

import { createTextureActions } from "@/renderer/texture/texture-manager"

afterEach(() => {
  loadTexture.mockReset()
})

class ScreenProfileState {
  public devicePixelRatio = 2

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }
}

describe("TextureActions", () => {
  it("loads and caches textures by unified resource key", async () => {
    const bodyKey = "device-sprite-item_port_storager_1"
    const bitmapTexture = createLoadedTextureMock("device-body")

    loadTexture.mockResolvedValue(bitmapTexture)

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const firstTexture = await manager.getTexture(bodyKey)
    const secondTexture = await manager.getTexture(bodyKey)

    expect(firstTexture).toBe(bitmapTexture)
    expect(secondTexture).toBe(bitmapTexture)
    expect(loadTexture).toHaveBeenCalledTimes(1)
    expect(loadTexture).toHaveBeenCalledWith("/sprites/item_port_storager_1.webp")

    manager.destroy()
  })

  it("returns a red fallback texture when the asset fails to load", async () => {
    loadTexture.mockRejectedValue(new Error("not found"))

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture("device-sprite-missing")
    expect(texture).toBeDefined()

    manager.destroy()
  })

  it("prefix device-masks- maps to sprite-masks with webp fallback to png", async () => {
    const maskKey = "device-masks-item_port_storager_1"
    const maskTexture = createLoadedTextureMock("mask")

    loadTexture.mockImplementation((path: string) => {
      if (path === "/sprite-masks/item_port_storager_1.webp") {
        return Promise.resolve(maskTexture)
      }
      return Promise.reject(new Error("unexpected path"))
    })

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture(maskKey)
    expect(texture).toBe(maskTexture)
    expect(loadTexture).toHaveBeenCalledWith("/sprite-masks/item_port_storager_1.webp")

    manager.destroy()
  })

  it("reacts to mobx dpr changes and reapplies bitmap sampling to loaded textures", async () => {
    const screenProfile = new ScreenProfileState()
    const bodyKey = "device-sprite-item_port_storager_1"
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

    loadTexture.mockResolvedValue(bitmapTexture)

    const manager = createTextureActions({
      renderer: {} as never,
      app: {
        state: {
          screenProfile,
        },
      } as never,
    })

    await manager.getTexture(bodyKey)

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