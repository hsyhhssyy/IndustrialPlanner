import { makeAutoObservable, runInAction } from "mobx"
import { afterEach, describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<(path: string) => Promise<unknown>>(),
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

import { createTextureActions, isFallbackTexture } from "@/renderer/texture/texture-manager"

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
    expect(isFallbackTexture(firstTexture)).toBe(false)
    expect(secondTexture).toBe(bitmapTexture)
    expect(loadTexture).toHaveBeenCalledTimes(1)
    expect(loadTexture).toHaveBeenCalledWith("/3d-top-view/sprites/item_port_storager_1.webp")

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
    expect(isFallbackTexture(texture)).toBe(true)

    manager.destroy()
  })

  it("returns a red fallback texture for unknown key prefixes", async () => {
    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture("future-custom-texture")

    expect(texture).toBeDefined()
    expect(loadTexture).not.toHaveBeenCalled()

    manager.destroy()
  })

  it("returns the fallback texture without requesting PNG when a device mask WebP fails", async () => {
    const maskKey = "device-masks-item_port_storager_1"

    loadTexture.mockRejectedValue(new Error("missing webp"))

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture(maskKey)
    expect(texture).toBeDefined()
    expect(loadTexture).toHaveBeenCalledTimes(1)
    expect(loadTexture).toHaveBeenCalledWith("/3d-top-view/sprite-masks/item_port_storager_1.webp")

    manager.destroy()
  })

  it("maps every published raster resource family to a single WebP candidate", async () => {
    const texture = createLoadedTextureMock("webp-only")
    loadTexture.mockResolvedValue(texture)

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const cases = [
      ["blueprint-sprite-item_port_storager_1", "/blueprint-view/sprites/item_port_storager_1.webp"],
      ["blueprint-masks-item_port_storager_1", "/blueprint-view/sprite-masks/item_port_storager_1.webp"],
      ["texture-scanline-45deg-50opacity", "/textures/scanline-45deg-50opacity.webp"],
      ["device-masks-item_port_storager_1", "/3d-top-view/sprite-masks/item_port_storager_1.webp"],
      ["item-icon-item_iron_ore", "/item-icons/item_iron_ore.webp"],
    ] as const

    for (const [key, expectedPath] of cases) {
      await manager.getTexture(key)
      expect(loadTexture).toHaveBeenLastCalledWith(expectedPath)
    }

    expect(loadTexture).toHaveBeenCalledTimes(cases.length)
    manager.destroy()
  })

  it("prefix blueprint-masks- maps to blueprint-view sprite-masks assets", async () => {
    const maskKey = "blueprint-masks-item_port_storager_1"
    const maskTexture = createLoadedTextureMock("blueprint-mask")

    loadTexture.mockResolvedValue(maskTexture)

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture(maskKey)

    expect(texture).toBe(maskTexture)
    expect(loadTexture).toHaveBeenCalledWith("/blueprint-view/sprite-masks/item_port_storager_1.webp")

    manager.destroy()
  })

  it("prefix item-icon- maps to item-icons assets", async () => {
    const iconKey = "item-icon-item_iron_ore"
    const iconTexture = createLoadedTextureMock("item-icon")

    loadTexture.mockResolvedValue(iconTexture)

    const manager = createTextureActions({
      renderer: {} as never,
      app: null,
    })

    const texture = await manager.getTexture(iconKey)

    expect(texture).toBe(iconTexture)
    expect(loadTexture).toHaveBeenCalledWith("/item-icons/item_iron_ore.webp")

    manager.destroy()
  })

  it("reacts to mobx dpr changes and reapplies bitmap sampling to loaded textures", async () => {
    const screenProfile = new ScreenProfileState()
    const bodyKey = "device-sprite-item_port_storager_1"
    const textureConfigs: unknown[] = []
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
      syncTextureConfigState: (textureConfig) => {
        textureConfigs.push(textureConfig)
      },
    })

    await manager.getTexture(bodyKey)

    expect(textureConfigs.at(-1)).toMatchObject({
      renderResolution: 2,
    })

    runInAction(() => {
      screenProfile.devicePixelRatio = 3
    })

    expect(textureConfigs.at(-1)).toMatchObject({
      renderResolution: 3,
    })
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
