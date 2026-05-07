import { describe, expect, it, vi } from "vitest"

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
    public tint = 0xffffff
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

  class MockTilingSprite {
    public readonly anchor = {
      set: vi.fn(),
    }
    public parent: {
      removeChild: (child: MockTilingSprite) => void;
    } | null = null
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public rotation = 0
    public roundPixels = false
    public visible = true
    public tilePosition = { x: 0, y: 0 }
    public mask: unknown = null
    public tileScale = { set: vi.fn() }
    private currentTexture: unknown

    public constructor(options: { texture: unknown; width: number; height: number }) {
      this.currentTexture = options.texture
      this.width = options.width
      this.height = options.height
    }

    public destroy(): void {}

    public get texture(): unknown {
      return this.currentTexture
    }

    public set texture(value: unknown) {
      this.currentTexture = value
    }
  }

  class MockGraphics {
    public parent: {
      removeChild: (child: MockGraphics) => void;
    } | null = null
    public roundPixels = false
    public visible = true
    public mask: unknown = null
    public readonly rectCalls: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = []
    public readonly strokeCalls: unknown[] = []
    public readonly fillCalls: unknown[] = []

    public constructor(options?: { roundPixels?: boolean }) {
      if (options?.roundPixels) {
        this.roundPixels = true
      }
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.rectCalls.push({ x, y, width, height })
      return this
    }

    public stroke(options?: unknown): this {
      this.strokeCalls.push(options)
      return this
    }

    public fill(options?: unknown): this {
      this.fillCalls.push(options)
      return this
    }

    public cut(): this {
      return this
    }

    public clear(): this {
      return this
    }

    public destroy(): void {}
  }

  class MockTexture {
    public static readonly EMPTY = { id: "empty-texture", width: 0 }
    public static readonly WHITE = { id: "white-texture", width: 0 }
  }

  const MockAssets = {
    load: vi.fn().mockResolvedValue({ id: "scanline-texture", width: 64 }),
  }

  return {
    Container: MockContainer,
    Sprite: MockSprite,
    TilingSprite: MockTilingSprite,
    Graphics: MockGraphics,
    Texture: MockTexture,
    Assets: MockAssets,
  }
})

import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import { BeltSprite } from "@/renderer/sprites/belt-sprite"
import { GenericDeviceSprite } from "@/renderer/sprites/generic-device-sprite"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

interface RenderedSpriteSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  roundPixels: boolean;
  visible: boolean;
  texture: unknown;
  tint?: number;
  alpha?: number;
  mask?: unknown;
}

interface RenderedGraphicsSnapshot {
  visible: boolean;
  strokeCalls: unknown[];
}

describe("GenericDeviceSprite", () => {
  const BODY_KEY = "device-sprite-item_port_storager_1"
  const MASK_KEY = "device-masks-item_port_storager_1"
  const SOLID_INPUT_KEY = "texture-solid-port-chevron-input"
  const SOLID_OUTPUT_KEY = "texture-solid-port-chevron-output"
  const LIQUID_INPUT_KEY = "texture-liquid-port-chevron-input"
  const LIQUID_OUTPUT_KEY = "texture-liquid-port-chevron-output"

  it("loads the sprite texture before making the device visible", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      createEntityDefinitionStub(),
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
      time: {
        nowMs: 1000,
        deltaMs: 16.67,
      },
    })

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BODY_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(MASK_KEY)

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
  })

  it("loads only the generated belt sprite texture through BeltSprite", async () => {
    const beltBodyKey = "device-sprite-belt_straight_1x1"
    const beltMaskKey = "device-masks-belt_straight_1x1"
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [beltBodyKey]: resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-1",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 32,
      height: 32,
      rotation: 0,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    }))

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(beltBodyKey)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(beltMaskKey)

    await flushMicrotasks(8)

    expect(overlayLayer.addChild).not.toHaveBeenCalled()

    const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined

    expect(entityRoot).toBeDefined()

    if (!entityRoot) {
      throw new Error("Expected BeltSprite to attach an entity root container.")
    }

    const renderedSprite = entityRoot.children?.[0] as RenderedSpriteSnapshot | undefined

    expect(renderedSprite).toMatchObject({
      texture: resolvedTexture,
      visible: true,
      x: 26,
      y: 36,
      width: 32,
      height: 32,
      rotation: 0,
      tint: resolveAppThemeColorNumber(
        AYU_LIGHT_THEME,
        AYU_LIGHT_THEME.renderer.beltTileStrokeColorKey,
      ),
    })
  })

  it("uses the muted light-theme tint for single selection, preview, and logistics head", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-2",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: {} as never,
    })

    await flushMicrotasks(4)

    const mutedLightTint = resolveAppThemeColorNumber(AYU_LIGHT_THEME, "text-2")

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: ["belt-entity-2"],
      previewIds: [],
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(mutedLightTint)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: ["belt-entity-2"],
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(mutedLightTint)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      logisticsHeadIds: ["belt-entity-2"],
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(mutedLightTint)
  })

  it("uses the preview blue tint for multi selection", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-3",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: {} as never,
    })

    await flushMicrotasks(4)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: ["belt-entity-3", "other-entity"],
      previewIds: [],
    }))

    expect(resolveEntitySprite(entityLayer)?.tint).toBe(resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.worldPreviewRectFillColorKey,
    ))
  })

  it("uses white tint for preview and logistics head under the dark theme", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-4",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: {} as never,
    })

    await flushMicrotasks(4)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: ["belt-entity-4"],
      theme: AYU_DARK_THEME,
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(0xffffff)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      logisticsHeadIds: ["belt-entity-4"],
      theme: AYU_DARK_THEME,
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(0xffffff)
  })

  it("shows a masked solid white overlay for preview devices", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-preview-entity",
      createEntityDefinitionStub(),
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
      time: {
        nowMs: 1000,
        deltaMs: 16.67,
      },
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

    expect(overlayRoot.children).toHaveLength(4)
    expect(previewEffectRoot?.visible).toBe(true)

    const scanlineTiling = previewEffectRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewEffectRoot?.children).toHaveLength(3)
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
    expect(scanlineTiling?.mask).toBe(previewMask)
  })

  it("uses the preview-mask key result even when it resolves to the body texture", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture-fallback")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedTexture,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-preview-entity-fallback",
      createEntityDefinitionStub(),
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
      time: {
        nowMs: 1000,
        deltaMs: 16.67,
      },
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

  it("scales the single-selection flow glow border width from the longest side and clamps it", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "single-selected-device",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: ["single-selected-device"],
      previewIds: [],
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 0,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 0,
    }, context)

    const flowGlowBorder = resolveFlowGlowBorderGraphics(overlayLayer)
    expect(flowGlowBorder?.visible).toBe(true)
    expect(flowGlowBorder?.strokeCalls).toHaveLength(1)
    expect(flowGlowBorder?.strokeCalls[0]).toMatchObject({
      width: 3.84,
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 8,
      height: 8,
      rotation: 0,
    }, context)

    expect(flowGlowBorder?.strokeCalls.at(-1)).toMatchObject({
      width: 1,
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 96,
      height: 40,
      rotation: 0,
    }, context)

    expect(flowGlowBorder?.strokeCalls.at(-1)).toMatchObject({
      width: 5,
    })
  })

  it("draws solid input and output port chevrons for the only selected device", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const solidInputTexture = createLoadedTextureMock("solid-input-texture")
    const solidOutputTexture = createLoadedTextureMock("solid-output-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [SOLID_INPUT_KEY]: solidInputTexture,
      [SOLID_OUTPUT_KEY]: solidOutputTexture,
      [LIQUID_INPUT_KEY]: createLoadedTextureMock("liquid-input-texture"),
      [LIQUID_OUTPUT_KEY]: createLoadedTextureMock("liquid-output-texture"),
    })
    const sprite = new GenericDeviceSprite(
      "selected-device",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: ["selected-device"],
      previewIds: [],
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 48,
      rotation: 0,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 48,
      rotation: 0,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 48,
      rotation: 0,
    }, context)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(SOLID_INPUT_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(SOLID_OUTPUT_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(LIQUID_INPUT_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(LIQUID_OUTPUT_KEY)

    const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
    expect(portOverlayRoot?.visible).toBe(true)
    expect(portOverlayRoot?.children).toHaveLength(6)

    const firstInputChevron = portOverlayRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const firstOutputChevron = portOverlayRoot?.children?.[3] as RenderedSpriteSnapshot | undefined

    expect(firstInputChevron).toMatchObject({
      x: 24,
      y: 80,
      width: 16,
      height: 16,
      rotation: Math.PI,
      roundPixels: true,
      visible: true,
      texture: solidInputTexture,
    })
    expect(firstOutputChevron).toMatchObject({
      x: 24,
      y: 16,
      width: 16,
      height: 16,
      rotation: 0,
      roundPixels: true,
      visible: true,
      texture: solidOutputTexture,
    })
  })

  it("does not draw port chevrons for ChevronHidden devices even when selected", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "hidden-chevron-device",
      {
        ...createEntityDefinitionStub(),
        tags: ["ChevronHidden"],
      },
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: ["hidden-chevron-device"],
      previewIds: [],
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 48,
      rotation: 0,
    }, context)

    await flushMicrotasks(8)

    const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
    expect(portOverlayRoot?.visible).toBe(false)
    expect(portOverlayRoot?.children).toHaveLength(0)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(SOLID_INPUT_KEY)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(SOLID_OUTPUT_KEY)
  })

  it("draws a liquid port chevron for the only preview device after rotation", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const liquidInputTexture = createLoadedTextureMock("liquid-input-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [SOLID_INPUT_KEY]: createLoadedTextureMock("solid-input-texture"),
      [SOLID_OUTPUT_KEY]: createLoadedTextureMock("solid-output-texture"),
      [LIQUID_INPUT_KEY]: liquidInputTexture,
      [LIQUID_OUTPUT_KEY]: createLoadedTextureMock("liquid-output-texture"),
    })
    const sprite = new GenericDeviceSprite(
      "preview-device",
      createLiquidInputEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: ["preview-device"],
    })

    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 64,
      height: 96,
      rotation: 90,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 64,
      height: 96,
      rotation: 90,
    }, context)

    await flushMicrotasks(8)

    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 64,
      height: 96,
      rotation: 90,
    }, context)

    const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
    expect(portOverlayRoot?.visible).toBe(true)
    expect(portOverlayRoot?.children).toHaveLength(1)

    const liquidChevron = portOverlayRoot?.children?.[0] as RenderedSpriteSnapshot | undefined

    expect(liquidChevron).toMatchObject({
      x: 34,
      y: 124,
      width: 16,
      height: 16,
      rotation: Math.PI,
      roundPixels: true,
      visible: true,
      texture: liquidInputTexture,
    })
  })

  it("does not draw port chevrons when selection contains multiple devices", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "multi-selected-device",
      createEntityDefinitionStub(),
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
      height: 48,
      rotation: 0,
    }, createRenderContextStub({
      selectionIds: ["multi-selected-device", "other-device"],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
    expect(portOverlayRoot?.visible).toBe(false)
    expect(portOverlayRoot?.children).toHaveLength(0)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(SOLID_INPUT_KEY)
  })
})

function createPortDefaults(
  kind: "item" | "fluid",
  roundRobinSeed = 0,
) {
  return {
    acceptRule: {
      base: kind === "fluid"
        ? { kind: "liquid" as const }
        : { kind: "solid" as const },
      exclude: [],
    },
    count: "unlimited" as const,
    priorityGroup: 0,
    roundRobinSeed,
  }
}

function createSlotDefaults() {
  return {
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never" as const,
    submitIntervalSeconds: null,
  }
}

function createEntityDefinitionStub(): EntityDefinition {
  return {
    id: "item_port_storager_1",
    nameKey: "registry.entity.item_port_storager_1.name",
    spriteId: "item_port_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 5,
    inspectors: [],
    portGroups: [
      {
        id: "item_input",
        kind: "item",
        direction: "input",
        ports: [0, 1, 2].map((x) => ({
          id: `in_s_${x}`,
          localCellX: x,
          localCellY: 2,
          edge: "SOUTH",
          ...createPortDefaults("item", x),
        })),
      },
      {
        id: "item_output",
        kind: "item",
        direction: "output",
        ports: [0, 1, 2].map((x) => ({
          id: `out_n_${x}`,
          localCellX: x,
          localCellY: 0,
          edge: "NORTH",
          ...createPortDefaults("item", x),
        })),
      },
    ],
    storageSlotGroups: [
      {
        id: "item_storage",
        kind: "item",
        role: "bidirectional",
        slots: [
          {
            id: "slot_1",
            capacity: 50,
            itemFilter: "type",
            itemFilterType: "solid",
            ...createSlotDefaults(),
          },
        ],
      },
    ],
    portStorageBindings: [
      {
        id: "bind_item_input",
        portGroupId: "item_input",
        storageSlotGroupId: "item_storage",
      },
      {
        id: "bind_item_output",
        portGroupId: "item_output",
        storageSlotGroupId: "item_storage",
      },
    ],
  }
}

function createLiquidInputEntityDefinitionStub(): EntityDefinition {
  return {
    ...createEntityDefinitionStub(),
    id: "item_port_liquid_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_liquid_filling_pd_mc_1.name",
    footprint: { width: 6, height: 4 },
    portGroups: [
      {
        id: "fluid_input",
        kind: "fluid",
        direction: "input",
        ports: [
          {
            id: "in_e_2",
            localCellX: 5,
            localCellY: 2,
            edge: "EAST",
            ...createPortDefaults("fluid"),
          },
        ],
      },
    ],
    storageSlotGroups: [
      {
        id: "fluid_input_buffer",
        kind: "fluid",
        role: "input",
        slots: [
          {
            id: "input_fluid_slot",
            capacity: 50,
            itemFilter: "type",
            itemFilterType: "liquid",
            ...createSlotDefaults(),
          },
        ],
      },
    ],
    portStorageBindings: [
      {
        id: "bind_fluid_input",
        portGroupId: "fluid_input",
        storageSlotGroupId: "fluid_input_buffer",
      },
    ],
  }
}

function createBeltEntityDefinitionStub(): EntityDefinition {
  return {
    ...createEntityDefinitionStub(),
    id: "belt_straight_1x1",
    nameKey: "registry.entity.belt_straight_1x1.name",
    spriteId: "belt_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
  }
}

function createRenderContextStub(options: {
  selectionIds: readonly string[];
  previewIds: readonly string[];
  logisticsHeadIds?: readonly string[];
  theme?: typeof AYU_LIGHT_THEME;
}) {
  return {
    theme: options.theme ?? AYU_LIGHT_THEME,
    workspace: {
      editor: {
        state: {
          viewport: {
            gridSize: 1,
            gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
          },
          collections: {
            [EntityCollectionType.selection]: createCollectionStub(options.selectionIds),
            [EntityCollectionType.marquee]: createCollectionStub([]),
            [EntityCollectionType.reverseMarquee]: createCollectionStub([]),
            [EntityCollectionType.preview]: createCollectionStub(options.previewIds),
            [EntityCollectionType.ghost]: createCollectionStub([]),
            [EntityCollectionType.logisticsHead]: createCollectionStub(options.logisticsHeadIds ?? []),
          },
        },
      },
    } as never,
    time: {
      nowMs: 1000,
      deltaMs: 16.67,
    },
  }
}

function createCollectionStub(entityIds: readonly string[]) {
  return Object.assign([...entityIds], {
    contains: (entityId: string) => entityIds.includes(entityId),
  })
}

function createBeltLayout() {
  return {
    x: 10,
    y: 20,
    width: 32,
    height: 32,
    rotation: 0 as const,
  }
}

function resolveEntitySprite(entityLayer: ReturnType<typeof createLayerStub>) {
  const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return entityRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
}

function resolvePortOverlayRoot(overlayLayer: ReturnType<typeof createLayerStub>) {
  const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return overlayRoot?.children?.[3] as {
    visible?: boolean;
    children?: unknown[];
  } | undefined
}

function resolveFlowGlowBorderGraphics(overlayLayer: ReturnType<typeof createLayerStub>) {
  const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  const flowGlowRoot = overlayRoot?.children?.[2] as {
    children?: unknown[];
  } | undefined

  return flowGlowRoot?.children?.[1] as RenderedGraphicsSnapshot | undefined
}

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

function createRenderHostStub(textureByKey: Record<string, object>) {
  const getTexture = vi.fn((key: string) => {
    const resolvedTexture = textureByKey[key]

    if (resolvedTexture === undefined) {
      return Promise.reject(new Error(`Missing texture stub for key: ${key}`))
    }

    return Promise.resolve(resolvedTexture)
  })

  return {
    app: {
      ticker: {
        lastTime: 1000,
      },
    },
    textureManager: {
      getTexture,
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
