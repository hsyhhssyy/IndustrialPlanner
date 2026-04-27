import { makeAutoObservable, runInAction } from "mobx"
import { describe, expect, it, vi } from "vitest"

const { createCustomTexture } = vi.hoisted(() => ({
  createCustomTexture: vi.fn(({ textureConfig }: { textureConfig: { renderResolution: number } }) => ({
    id: `custom-texture-${textureConfig.renderResolution}`,
    destroy: vi.fn(),
  })),
}))

vi.mock("@/renderer/texture/create-custom-texture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/texture/create-custom-texture")>()

  return {
    ...actual,
    createCustomTexture,
  }
})

import { CustomTextureKey } from "@/renderer/texture/create-custom-texture"
import { createRenderTextureManager } from "@/renderer/texture/texture-manager"

class ScreenProfileState {
  public devicePixelRatio = 2

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }
}

describe("RenderTextureManager", () => {
  it("reacts to mobx dpr changes and rebuilds texture config and custom textures", () => {
    const screenProfile = new ScreenProfileState()
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

    const manager = createRenderTextureManager({
      renderer: {} as never,
      app: {
        state: {
          screenProfile,
        },
      } as never,
      initialResolution: 2,
    })

    manager.registerBitmapTexture(bitmapTexture as never)

    expect(createCustomTexture).toHaveBeenCalledTimes(1)
    expect(manager.textureConfig.renderResolution).toBe(2)
    expect(manager.getCustomTexture(CustomTextureKey.whiteScanLines)).toMatchObject({
      id: "custom-texture-2",
    })

    runInAction(() => {
      screenProfile.devicePixelRatio = 3
    })

    expect(createCustomTexture).toHaveBeenCalledTimes(2)
    expect(manager.textureConfig.renderResolution).toBe(3)
    expect(manager.getCustomTexture(CustomTextureKey.whiteScanLines)).toMatchObject({
      id: "custom-texture-3",
    })
    expect(bitmapTexture.source.scaleMode).toBe("linear")
    expect(bitmapTexture.source.autoGenerateMipmaps).toBe(true)
    expect(bitmapTexture.source.updateMipmaps).toHaveBeenCalledTimes(2)

    manager.destroy()
  })
})