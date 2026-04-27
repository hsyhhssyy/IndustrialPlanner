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

  class MockTilingSprite extends MockSprite {
    public readonly tilePosition = {
      x: 0,
      y: 0,
    }
    public tileRotation = 0
    public applyAnchorToTexture = false

    public constructor(options?: {
      texture?: unknown;
      width?: number;
      height?: number;
      roundPixels?: boolean;
    }) {
      super(options?.texture ?? MockTexture.EMPTY)
      this.width = options?.width ?? 0
      this.height = options?.height ?? 0
      this.roundPixels = options?.roundPixels ?? false
    }
  }

  class MockTexture {
    public static readonly EMPTY = { id: "empty-texture" }
  }

  class MockGraphics extends MockContainer {
    public clear(): this {
      return this
    }

    public rect(): this {
      return this
    }

    public stroke(): this {
      return this
    }
  }

  return {
    Assets: {
      load: loadTexture,
    },
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    TilingSprite: MockTilingSprite,
    Texture: MockTexture,
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/state/types"
import {
  GenericDeviceSprite,
  resolvePreviewScanLineOverlaySpan,
  resolvePreviewScanLineTileOffset,
} from "@/renderer/sprites/generic-device-sprite"
import { CustomTextureKey } from "@/renderer/texture/create-custom-texture"
import { createRenderTextureConfig } from "@/renderer/texture/texture-config"

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
  tilePosition?: {
    x: number;
    y: number;
  };
  tileRotation?: number;
  applyAnchorToTexture?: boolean;
}

describe("GenericDeviceSprite", () => {
  it("loads the sprite texture before making the device visible", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    loadTexture.mockResolvedValueOnce(resolvedTexture)

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub()
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      "/sprites/item_port_storager_1.webp",
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
        editor: null,
      } as never,
    })

    expect(loadTexture).toHaveBeenCalledWith("/sprites/item_port_storager_1.webp")

    await flushMicrotasks()

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
    expect(resolvedTexture.source.mipmap).toBe(false)
    expect(resolvedTexture.source.style.scaleMode).toBe("linear")
    expect(resolvedTexture.source.style.mipmapFilter).toBe("linear")
    expect(resolvedTexture.source.style.maxAnisotropy).toBe(1)
  })

  it("shows a masked animated scan-line overlay for preview devices", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    loadTexture.mockResolvedValueOnce(resolvedTexture)

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub()
    const sprite = new GenericDeviceSprite(
      "dummy-preview-entity",
      "/sprites/item_port_storager_1.webp",
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
      width: 58,
      height: 58,
      rotation: Math.PI / 2,
      alpha: 0.5,
      applyAnchorToTexture: true,
      tileRotation: Math.PI / 4,
      texture: { id: "white-scan-lines-texture" },
      tilePosition: {
        x: 0,
        y: 4,
      },
    })
    expect(previewMask).toMatchObject({
      x: 40,
      y: 40,
      width: 32,
      height: 48,
      rotation: Math.PI / 2,
    })
    expect(previewOverlay?.mask).toBe(previewMask)
    expect(previewMask?.texture).toMatchObject({
      id: "device-texture",
      source: {
        scaleMode: "linear",
      },
    })

    renderHost.app.ticker.lastTime = 2000
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    expect(previewOverlay?.tilePosition?.y).toBe(8)

    renderHost.internalState.customTextures[CustomTextureKey.whiteScanLines] = {
      id: "white-scan-lines-texture-hi-res",
    }
    renderHost.internalState.textureConfig = {
      ...renderHost.internalState.textureConfig,
      bitmap: {
        ...renderHost.internalState.textureConfig.bitmap,
        sampling: {
          ...renderHost.internalState.textureConfig.bitmap.sampling,
          scaleMode: "nearest",
        },
      },
    }
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    expect(previewOverlay?.texture).toEqual({
      id: "white-scan-lines-texture-hi-res",
    })

    const previewMaskTexture = previewMask?.texture as {
      source?: {
        scaleMode?: string;
        style?: {
          scaleMode?: string;
        };
      };
    } | undefined

    expect(previewMaskTexture?.source?.scaleMode).toBe("nearest")
    expect(previewMaskTexture?.source?.style?.scaleMode).toBe("nearest")
  })
})

describe("resolvePreviewScanLineTileOffset", () => {
  it("scrolls the scan-line texture slowly in cell-space pixels", () => {
    expect(resolvePreviewScanLineTileOffset(0)).toBe(0)
    expect(resolvePreviewScanLineTileOffset(1000)).toBe(4)
    expect(resolvePreviewScanLineTileOffset(5000)).toBe(4)
  })
})

describe("resolvePreviewScanLineOverlaySpan", () => {
  it("expands the tiling overlay to the device diagonal so rotated scan lines still cover the full mask", () => {
    expect(resolvePreviewScanLineOverlaySpan({ width: 32, height: 48 })).toBe(58)
    expect(resolvePreviewScanLineOverlaySpan({ width: 8, height: 8 })).toBe(16)
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
  return {
    app: {
      ticker: {
        lastTime: 1000,
      },
    },
    internalState: {
      textureConfig: createRenderTextureConfig({
        resolution: 3,
      }),
      customTextures: {
        [CustomTextureKey.whiteScanLines]: { id: "white-scan-lines-texture" },
      },
    },
  }
}

function createLoadedTextureMock(id: string) {
  return {
    id,
    source: {
      scaleMode: "linear",
      mipmap: true,
      mipmapFilter: "nearest",
      style: {
        scaleMode: "nearest",
        mipmapFilter: "nearest",
        maxAnisotropy: 4,
        update: vi.fn(),
      },
      update: vi.fn(),
    },
    update: vi.fn(),
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}
