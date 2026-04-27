import { describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: {
      removeChild: (child: MockContainer) => void;
    } | null = null
    public alpha = 1
    public visible = true
    public mask: unknown = null

    public addChild<T extends { parent: unknown }>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    }

    public removeChild(child: unknown): void {
      const index = this.children.indexOf(child)
      if (index >= 0) {
        this.children.splice(index, 1)
      }

      if (child && typeof child === "object" && "parent" in child) {
        (child as { parent: unknown }).parent = null
      }
    }

    public destroy(): void {
      this.children.length = 0
      this.parent = null
    }
  }

  class MockSprite {
    public static instances: MockSprite[] = []
    public readonly anchor = {
      set: vi.fn(),
    }
    public parent: {
      removeChild: (child: MockSprite) => void;
    } | null = null
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public rotation = 0
    public roundPixels = false
    public visible = true
    public alpha = 1
    public mask: unknown = null
    private currentTexture: unknown

    public constructor(texture: unknown) {
      this.currentTexture = texture
      MockSprite.instances.push(this)
    }

    public destroy(): void {}

    public get texture(): unknown {
      return this.currentTexture
    }

    public set texture(value: unknown) {
      this.currentTexture = value
    }
  }

  class MockTexture {
    public static readonly EMPTY = { id: "empty-texture" }
    public static readonly WHITE = { id: "white-texture" }
  }

  return {
    Assets: {
      load: loadTexture,
    },
    Container: MockContainer,
    Sprite: MockSprite,
    Texture: MockTexture,
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/state/types"
import { GenericDeviceSprite } from "@/renderer/sprites/generic-device-sprite"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import {
  applyBitmapTextureConfig,
  createRenderTextureConfig,
} from "@/renderer/texture/texture-config"

interface RenderedSpriteSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  roundPixels: boolean;
  visible: boolean;
  texture: unknown;
  alpha?: number;
  mask?: unknown;
}

describe("GenericDeviceSprite", () => {
  it("loads the sprite texture before making the device visible", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    loadTexture.mockImplementation((path: string) => Promise.resolve(
      path.startsWith("/sprite-masks/") ? resolvedMaskTexture : resolvedTexture,
    ))

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub()
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      "/sprites/device-body-primary.webp",
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, {
      theme: AYU_LIGHT_THEME,
      workspace: {
        editor: {
          state: {
            viewport: {
              gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
            },
            collections: {
              [EntityCollectionType.selection]: {
                contains: () => false,
              },
              [EntityCollectionType.marquee]: {
                contains: () => false,
              },
              [EntityCollectionType.reverseMarquee]: {
                contains: () => false,
              },
              [EntityCollectionType.preview]: {
                contains: () => false,
              },
              [EntityCollectionType.ghost]: {
                contains: () => false,
              },
            },
          },
        },
      } as never,
    })

    expect(loadTexture).toHaveBeenCalledWith("/sprites/device-body-primary.webp")
    expect(loadTexture).toHaveBeenCalledWith("/sprite-masks/device-body-primary.webp")

    await flushMicrotasks(8)

    const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined

    expect(entityRoot).toBeDefined()

    if (!entityRoot) {
      throw new Error("Expected GenericDeviceSprite to attach an entity root container.")
    }

    const renderedSprite = entityRoot.children?.[0]

    expect(renderedSprite).toBeDefined()

    if (!renderedSprite) {
      throw new Error("Expected GenericDeviceSprite to attach a Pixi sprite.")
    }

    const attachedSprite = renderedSprite as unknown as RenderedSpriteSnapshot

    expect(attachedSprite.texture).toBe(resolvedTexture)
    expect(attachedSprite.visible).toBe(true)
    expect(attachedSprite.roundPixels).toBe(true)
    expect(attachedSprite.x).toBe(40)
    expect(attachedSprite.y).toBe(40)
    expect(attachedSprite.width).toBe(32)
    expect(attachedSprite.height).toBe(48)
    expect(attachedSprite.rotation).toBeCloseTo(Math.PI / 2)
    expect(resolvedTexture.source.scaleMode).toBe("linear")
    expect(resolvedTexture.source.autoGenerateMipmaps).toBe(true)
    expect(resolvedTexture.source.style.scaleMode).toBe("linear")
    expect(resolvedTexture.source.style.mipmapFilter).toBe("linear")
    expect(resolvedTexture.source.style.maxAnisotropy).toBe(4)
    expect(resolvedTexture.source.updateMipmaps).toHaveBeenCalledTimes(1)
  })

  it("shows a masked solid white overlay for preview devices", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    loadTexture.mockImplementation((path: string) => Promise.resolve(
      path.startsWith("/sprite-masks/") ? resolvedMaskTexture : resolvedTexture,
    ))

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub()
    const sprite = new GenericDeviceSprite(
      "dummy-preview-entity",
      "/sprites/device-preview.webp",
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = {
      theme: AYU_LIGHT_THEME,
      workspace: {
        editor: {
          state: {
            viewport: {
              gridSize: 1,
              gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
            },
            collections: {
              [EntityCollectionType.selection]: {
                contains: () => false,
              },
              [EntityCollectionType.marquee]: {
                contains: () => false,
              },
              [EntityCollectionType.reverseMarquee]: {
                contains: () => false,
              },
              [EntityCollectionType.preview]: {
                contains: (entityId: string) => entityId === "dummy-preview-entity",
              },
              [EntityCollectionType.ghost]: {
                contains: () => false,
              },
            },
          },
        },
      } as never,
    }

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined

    expect(overlayRoot).toBeDefined()

    if (!overlayRoot) {
      throw new Error("Expected GenericDeviceSprite to attach an overlay root container.")
    }

    const previewEffectRoot = overlayRoot.children?.[0] as {
      visible?: boolean;
      children?: unknown[];
    } | undefined

    expect(overlayRoot.children).toHaveLength(1)
    expect(previewEffectRoot?.visible).toBe(true)

    const previewOverlay = previewEffectRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewOverlay).toMatchObject({
      x: 40,
      y: 40,
      width: 32,
      height: 48,
      rotation: Math.PI / 2,
      texture: { id: "white-texture" },
    })
    expect(previewMask).toMatchObject({
      x: 40,
      y: 40,
      width: 32,
      height: 48,
      rotation: Math.PI / 2,
      roundPixels: true,
      texture: {
        id: "device-mask-texture",
      },
    })
    expect(previewOverlay?.mask).toBe(previewMask)
    renderHost.textureManager.textureConfig = {
      ...renderHost.textureManager.textureConfig,
      bitmap: {
        ...renderHost.textureManager.textureConfig.bitmap,
        sampling: {
          ...renderHost.textureManager.textureConfig.bitmap.sampling,
          scaleMode: "nearest",
        },
      },
    }
    for (const texture of renderHost.textureManager.registeredBitmapTextures) {
      applyBitmapTextureConfig(texture as never, renderHost.textureManager.textureConfig)
    }
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    expect(previewMask?.texture).toMatchObject({
      id: "device-mask-texture",
      source: {
        scaleMode: "nearest",
      },
    })
  })

  it("falls back to the sprite texture when a same-name preview mask is missing", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture-fallback")
    loadTexture.mockImplementation((path: string) => {
      if (path.startsWith("/sprite-masks/")) {
        return Promise.reject(new Error("missing mask"))
      }

      return Promise.resolve(resolvedTexture)
    })

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub()
    const sprite = new GenericDeviceSprite(
      "dummy-preview-entity-fallback",
      "/sprites/device-preview-fallback.webp",
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = {
      theme: AYU_LIGHT_THEME,
      workspace: {
        editor: {
          state: {
            viewport: {
              gridSize: 1,
              gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
            },
            collections: {
              [EntityCollectionType.selection]: {
                contains: () => false,
              },
              [EntityCollectionType.marquee]: {
                contains: () => false,
              },
              [EntityCollectionType.reverseMarquee]: {
                contains: () => false,
              },
              [EntityCollectionType.preview]: {
                contains: (entityId: string) => entityId === "dummy-preview-entity-fallback",
              },
              [EntityCollectionType.ghost]: {
                contains: () => false,
              },
            },
          },
        },
      } as never,
    }

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    await flushMicrotasks()

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined

    expect(overlayRoot).toBeDefined()

    if (!overlayRoot) {
      throw new Error("Expected GenericDeviceSprite to attach an overlay root container.")
    }

    const previewEffectRoot = overlayRoot.children?.[0] as {
      children?: unknown[];
    } | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewMask?.texture).toMatchObject({
      id: "device-texture-fallback",
    })
  })
})

function createLayerStub() {
  const layer = {
    addChild: vi.fn((child: {
      parent: unknown;
    }) => {
      child.parent = layer
    }),
    removeChild: vi.fn((child: {
      parent: unknown;
    }) => {
      child.parent = null
    }),
  }

  return layer
}

function createRenderHostStub() {
  const textureConfig = createRenderTextureConfig({
    resolution: 3,
  })
  const registeredBitmapTextures = new Set<object>()

  return {
    app: {
      ticker: {
        lastTime: 1000,
      },
    },
    textureManager: {
      textureConfig,
      registeredBitmapTextures,
      registerBitmapTexture: (texture: object) => {
        if (!registeredBitmapTextures.has(texture)) {
          registeredBitmapTextures.add(texture)
          applyBitmapTextureConfig(texture as never, textureConfig)
        }

        return texture
      },
    },
  }
}

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

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}
