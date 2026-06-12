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

  class MockText {
    public readonly anchor = {
      set: vi.fn(),
    }
    public parent: {
      removeChild: (child: MockText) => void;
    } | null = null
    public x = 0
    public y = 0
    public rotation = 0
    public visible = true
    public text: string
    public style: unknown

    public constructor(options: { text: string; style: unknown }) {
      this.text = options.text
      this.style = options.style
    }

    public destroy(): void {}
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
    load: vi.fn((path: string) => Promise.resolve({ id: path, width: 64 })),
  }

  return {
    Container: MockContainer,
    Sprite: MockSprite,
    Text: MockText,
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
import { PipeSprite } from "@/renderer/sprites/pipe-sprite"
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

interface RenderedTextSnapshot {
  x: number;
  y: number;
  rotation: number;
  visible: boolean;
  text: string;
  style: {
    fill?: number;
    fontSize?: number;
    stroke?: unknown;
    dropShadow?: unknown;
    wordWrapWidth?: number;
  };
}

describe("GenericDeviceSprite", () => {
  const BODY_KEY = "device-sprite-item_port_storager_1"
  const MASK_KEY = "device-masks-item_port_storager_1"
  const BLUEPRINT_BODY_KEY = "blueprint-sprite-item_port_storager_1"
  const BLUEPRINT_MASK_KEY = "blueprint-masks-item_port_storager_1"
  const TOP_VIEW_AVATAR_KEY = "top-view-avatar-item_port_storager_1"
  const BLUEPRINT_AVATAR_KEY = "blueprint-avatar-item_port_storager_1"
  const PIPE_BODY_KEY = "device-sprite-pipe_straight_1x1"
  const PIPE_MASK_KEY = "device-masks-pipe_straight_1x1"
  const PIPE_TOP_VIEW_AVATAR_KEY = "top-view-avatar-pipe_straight_1x1"
  const LOGISTICS_BODY_KEY = "device-sprite-item_log_splitter"
  const LOGISTICS_MASK_KEY = "device-masks-item_log_splitter"
  const LOGISTICS_BLUEPRINT_BODY_KEY = "blueprint-sprite-item_log_splitter"
  const LOGISTICS_BLUEPRINT_MASK_KEY = "blueprint-masks-item_log_splitter"
  const LOGISTICS_TOP_VIEW_AVATAR_KEY = "top-view-avatar-item_log_splitter"
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      logisticsPortOccupancy: null,
      suppressBelts: false,
      suppressPipes: false,
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

  it("draws device icon above the name with top-view avatar and outlined white text", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [TOP_VIEW_AVATAR_KEY]: createLoadedTextureMock("top-view-avatar"),
    }, {
      gameShowDeviceIcons: true,
      gameShowDeviceNames: true,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 96,
      height: 96,
      rotation: 0,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    const labelRoot = resolveDeviceLabelRoot(entityLayer)
    const icon = labelRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const text = labelRoot?.children?.[1] as RenderedTextSnapshot | undefined

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(TOP_VIEW_AVATAR_KEY)
    expect(labelRoot?.visible).toBe(true)
    expect(icon?.visible).toBe(true)
    expect(icon?.y).toBeLessThan(text?.y ?? 0)
    expect(text?.visible).toBe(true)
    expect(text?.text).toBe("Storage")
    expect(text?.style.fill).toBe(0xffffff)
    expect(text?.style.stroke).toEqual(expect.objectContaining({ color: 0x20242a }))
    expect(text?.style.dropShadow).toEqual(expect.objectContaining({ color: 0x20242a }))
  })

  it("uses blueprint avatar and black unoutlined text when simplified device icons are enabled", async () => {
    const resolvedTexture = createLoadedTextureMock("blueprint-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("blueprint-mask-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BLUEPRINT_BODY_KEY]: resolvedTexture,
      [BLUEPRINT_MASK_KEY]: resolvedMaskTexture,
      [BLUEPRINT_AVATAR_KEY]: createLoadedTextureMock("blueprint-avatar"),
    }, {
      gameUseSimplifiedDeviceIcons: true,
      gameShowDeviceIcons: true,
      gameShowDeviceNames: true,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 96,
      height: 96,
      rotation: 0,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    const labelRoot = resolveDeviceLabelRoot(entityLayer)
    const icon = labelRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const text = labelRoot?.children?.[1] as RenderedTextSnapshot | undefined

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BLUEPRINT_AVATAR_KEY)
    expect(labelRoot?.visible).toBe(true)
    expect(icon?.visible).toBe(true)
    expect(icon?.y).toBeLessThan(text?.y ?? 0)
    expect(text?.visible).toBe(true)
    expect(text?.text).toBe("Storage")
    expect(text?.style.fill).toBe(0x111111)
    expect(text?.style.stroke).toBeUndefined()
    expect(text?.style.dropShadow).toBeUndefined()
  })

  it("keeps device icon and font size fixed across device sizes", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const resolvedAvatarTexture = createLoadedTextureMock("top-view-avatar")

    const smallEntityLayer = createLayerStub()
    const smallOverlayLayer = createLayerStub()
    const largeEntityLayer = createLayerStub()
    const largeOverlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [TOP_VIEW_AVATAR_KEY]: resolvedAvatarTexture,
    }, {
      gameShowDeviceIcons: true,
      gameShowDeviceNames: true,
    })
    const smallSprite = new GenericDeviceSprite(
      "dummy-entity-small",
      createEntityDefinitionStub(),
      renderHost as never,
    )
    const largeSprite = new GenericDeviceSprite(
      "dummy-entity-large",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    smallSprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: smallEntityLayer as never,
      overlay: smallOverlayLayer as never,
    })
    largeSprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: largeEntityLayer as never,
      overlay: largeOverlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    })

    // 32px 对应 2x2 供电桩当前的渲染基准尺寸。
    smallSprite.syncLayout({
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
    }, context)
    largeSprite.syncLayout({
      x: 0,
      y: 0,
      width: 96,
      height: 96,
      rotation: 0,
    }, context)

    await flushMicrotasks(8)

    const smallLabelRoot = resolveDeviceLabelRoot(smallEntityLayer)
    const largeLabelRoot = resolveDeviceLabelRoot(largeEntityLayer)
    const smallIcon = smallLabelRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const largeIcon = largeLabelRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const smallText = smallLabelRoot?.children?.[1] as RenderedTextSnapshot | undefined
    const largeText = largeLabelRoot?.children?.[1] as RenderedTextSnapshot | undefined

    expect(smallIcon).toMatchObject({
      width: 14,
      height: 14,
    })
    expect(largeIcon).toMatchObject({
      width: 14,
      height: 14,
    })
    expect(smallText?.style.fontSize).toBe(8)
    expect(largeText?.style.fontSize).toBe(8)
  })

  it("does not draw labels for pipe-family devices even when settings enable them", async () => {
    const resolvedTexture = createLoadedTextureMock("pipe-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("pipe-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [PIPE_BODY_KEY]: resolvedTexture,
      [PIPE_MASK_KEY]: resolvedMaskTexture,
      [PIPE_TOP_VIEW_AVATAR_KEY]: createLoadedTextureMock("pipe-avatar"),
    }, {
      gameShowDeviceIcons: true,
      gameShowDeviceNames: true,
    })
    const sprite = new GenericDeviceSprite(
      "pipe-device-1",
      createPipeEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      selectionIds: [],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    const labelRoot = resolveDeviceLabelRoot(entityLayer)
    expect(labelRoot?.visible).toBe(false)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(PIPE_TOP_VIEW_AVATAR_KEY)
  })

  it("does not draw labels for logistics devices even when settings enable them", async () => {
    const resolvedTexture = createLoadedTextureMock("logistics-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("logistics-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [LOGISTICS_BODY_KEY]: resolvedTexture,
      [LOGISTICS_MASK_KEY]: resolvedMaskTexture,
      [LOGISTICS_TOP_VIEW_AVATAR_KEY]: createLoadedTextureMock("logistics-avatar"),
    }, {
      gameShowDeviceIcons: true,
      gameShowDeviceNames: true,
    })
    const sprite = new GenericDeviceSprite(
      "logistics-device-1",
      createBeltLogisticsEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      selectionIds: [],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    const labelRoot = resolveDeviceLabelRoot(entityLayer)
    expect(labelRoot?.visible).toBe(false)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(LOGISTICS_TOP_VIEW_AVATAR_KEY)
  })

  it("forces blueprint textures and scanline preview for logistics preview devices", async () => {
    const defaultTexture = createLoadedTextureMock("logistics-default-texture")
    const defaultMaskTexture = createLoadedTextureMock("logistics-default-mask-texture")
    const blueprintTexture = createLoadedTextureMock("logistics-blueprint-texture")
    const blueprintMaskTexture = createLoadedTextureMock("logistics-blueprint-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [LOGISTICS_BODY_KEY]: defaultTexture,
      [LOGISTICS_MASK_KEY]: defaultMaskTexture,
      [LOGISTICS_BLUEPRINT_BODY_KEY]: blueprintTexture,
      [LOGISTICS_BLUEPRINT_MASK_KEY]: blueprintMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "logistics-preview-device",
      createBeltLogisticsEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: ["logistics-preview-device", "other-preview-device"],
    })

    sprite.syncLayout(createBeltLayout(), context)
    await flushMicrotasks(8)
    sprite.syncLayout(createBeltLayout(), context)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(LOGISTICS_BLUEPRINT_BODY_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(LOGISTICS_BLUEPRINT_MASK_KEY)
    expect(resolveEntitySprite(entityLayer)?.texture).toBe(blueprintTexture)

    const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined
    const previewEffectRoot = overlayRoot?.children?.[0] as {
      visible?: boolean;
      children?: unknown[];
    } | undefined
    const scanlineTiling = previewEffectRoot?.children?.[0] as RenderedSpriteSnapshot | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewEffectRoot?.visible).toBe(true)
    expect(previewEffectRoot?.children).toHaveLength(4)
    expect(previewMask?.texture).toBe(blueprintMaskTexture)
    expect(scanlineTiling?.mask).toBe(previewMask)
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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

    expect(overlayLayer.addChild).toHaveBeenCalledTimes(1)

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

  it("loads only the generated pipe sprite texture through PipeSprite", async () => {
    const resolvedTexture = createLoadedTextureMock("pipe-device-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [PIPE_BODY_KEY]: resolvedTexture,
      "texture-pipe_straight_1x1_liquid": resolvedTexture,
    })
    const sprite = new PipeSprite(
      "pipe-entity-1",
      createPipeEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(PIPE_BODY_KEY)
    expect(renderHost.textureManager.getTexture).not.toHaveBeenCalledWith(PIPE_MASK_KEY)

    await flushMicrotasks(8)

    expect(overlayLayer.addChild).toHaveBeenCalledTimes(1)
    expect(resolveEntitySprite(entityLayer)).toMatchObject({
      texture: resolvedTexture,
      visible: true,
      x: 26,
      y: 36,
      width: 32,
      height: 32,
      rotation: 0,
      tint: resolveAppThemeColorNumber(
        AYU_LIGHT_THEME,
        AYU_LIGHT_THEME.renderer.pipeBodyTintColorKey,
      ),
    })
  })

  it("draws a tinted liquid bead for filled straight pipes", async () => {
    const resolvedTexture = createLoadedTextureMock("pipe-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [PIPE_BODY_KEY]: resolvedTexture,
      "texture-pipe_straight_1x1_liquid": resolvedTexture,
    })
    const getPipeFluidItemId = vi.fn(() => "item_liquid_water")
    const sprite = new PipeSprite(
      "pipe-entity-2",
      createPipeEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
      rotation: 0,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      getPipeFluidItemId,
      isPipeDeviceSlotOccupied: () => true,
      itemDefinitions: [{
        id: "item_liquid_water",
        nameKey: "registry.item.item_liquid_water.name",
        iconId: "item_liquid_water",
        displayOrder: 10000,
        tags: ["liquid", "liquid_color:#82d6ff"],
      }],
    }))

    await flushMicrotasks(8)

    expect(getPipeFluidItemId).toHaveBeenCalledWith("pipe-entity-2")
    // 贴图方案：bead 填满整个格子，Alpha 通道约束内腔形状
    expect(resolvePipeBeadSprite(entityLayer)).toMatchObject({
      visible: true,
      x: 30,
      y: 40,
      width: 40,
      height: 40,
      rotation: 0,
      tint: 0x82d6ff,
    })
  })

  it("uses a compact square liquid bead for turn pipes", async () => {
    const resolvedTexture = createLoadedTextureMock("pipe-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-pipe_turn_cw_1x1": resolvedTexture,
      "texture-pipe_turn_cw_1x1_liquid": resolvedTexture,
    })
    const sprite = new PipeSprite(
      "pipe-turn-entity-1",
      createPipeTurnEntityDefinitionStub("pipe_turn_cw_1x1"),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
      rotation: 90,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      getPipeFluidItemId: () => "item_liquid_acid",
      isPipeDeviceSlotOccupied: () => true,
      itemDefinitions: [{
        id: "item_liquid_acid",
        nameKey: "registry.item.item_liquid_acid.name",
        iconId: "item_liquid_acid",
        displayOrder: 10000,
        tags: ["liquid", "liquid_color:#d97a1f"],
      }],
    }))

    await flushMicrotasks(8)

    // 贴图方案：bead 填满整个格子，弯管贴图自带 L 形内腔 Alpha
    expect(resolvePipeBeadSprite(entityLayer)).toMatchObject({
      visible: true,
      x: 30,
      y: 40,
      width: 40,
      height: 40,
      rotation: Math.PI / 2,
      tint: 0xd97a1f,
    })
  })

  it("loads blueprint body and mask textures when simplified device icons are enabled", async () => {
    const resolvedTexture = createLoadedTextureMock("blueprint-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("blueprint-device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BLUEPRINT_BODY_KEY]: resolvedTexture,
      [BLUEPRINT_MASK_KEY]: resolvedMaskTexture,
    }, {
      gameUseSimplifiedDeviceIcons: true,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-blueprint-entity",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    }))

    await flushMicrotasks(8)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BLUEPRINT_BODY_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BLUEPRINT_MASK_KEY)
    expect(resolveEntitySprite(entityLayer)?.texture).toBe(resolvedTexture)

    const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined
    const previewEffectRoot = overlayRoot?.children?.[0] as {
      children?: unknown[];
    } | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewMask?.texture).toBe(resolvedMaskTexture)
  })

  it("uses the blueprint footprint rectangle itself for simplified preview scanlines", async () => {
    const resolvedTexture = createLoadedTextureMock("blueprint-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("blueprint-device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BLUEPRINT_BODY_KEY]: resolvedTexture,
      [BLUEPRINT_MASK_KEY]: resolvedMaskTexture,
    }, {
      gameUseSimplifiedDeviceIcons: true,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-blueprint-preview",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: ["dummy-blueprint-preview"],
    })
    Object.assign(context.workspace, {
      app: createRenderContextAppStub(renderHost),
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

    await flushMicrotasks(8)

    const previewEffectRoot = resolvePreviewEffectRoot(overlayLayer)
    const scanlineTiling = previewEffectRoot?.children?.[0] as RenderedSpriteSnapshot | undefined

    expect(previewEffectRoot?.visible).toBe(true)
    expect(scanlineTiling).toMatchObject({
      visible: true,
      x: 40,
      y: 40,
      width: 48,
      height: 32,
      mask: null,
      texture: {
        id: "/textures/scanline-45deg-50opacity.png",
      },
    })
  })

  it("uses the blueprint footprint rectangle itself for simplified marquee selection", async () => {
    const resolvedTexture = createLoadedTextureMock("blueprint-device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("blueprint-device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BLUEPRINT_BODY_KEY]: resolvedTexture,
      [BLUEPRINT_MASK_KEY]: resolvedMaskTexture,
    }, {
      gameUseSimplifiedDeviceIcons: true,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-blueprint-marquee",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      marqueeIds: ["dummy-blueprint-marquee"],
      previewIds: [],
    })
    Object.assign(context.workspace, {
      app: createRenderContextAppStub(renderHost),
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

    await flushMicrotasks(8)

    const selectionEffectRoot = resolveSelectionEffectRoot(overlayLayer)
    const selectionTiling = selectionEffectRoot?.children?.[0] as RenderedSpriteSnapshot | undefined

    expect(selectionEffectRoot?.visible).toBe(true)
    expect(selectionTiling).toMatchObject({
      visible: true,
      x: 40,
      y: 40,
      width: 48,
      height: 32,
      mask: null,
      texture: {
        id: "/textures/blueprint-mask-50opacity.png",
      },
    })
  })

  it("reloads the generic device textures after the simplified icon setting changes", async () => {
    const defaultTexture = createLoadedTextureMock("device-texture")
    const defaultMaskTexture = createLoadedTextureMock("device-mask-texture")
    const blueprintTexture = createLoadedTextureMock("blueprint-device-texture")
    const blueprintMaskTexture = createLoadedTextureMock("blueprint-device-mask-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: defaultTexture,
      [MASK_KEY]: defaultMaskTexture,
      [BLUEPRINT_BODY_KEY]: blueprintTexture,
      [BLUEPRINT_MASK_KEY]: blueprintMaskTexture,
    })
    const sprite = new GenericDeviceSprite(
      "dummy-entity-toggle",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    })

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    await flushMicrotasks(8)

    expect(resolveEntitySprite(entityLayer)?.texture).toBe(defaultTexture)

    renderHost.workspace.app.state.settings.gameUseSimplifiedDeviceIcons = true

    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, context)

    await flushMicrotasks(8)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BLUEPRINT_BODY_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(BLUEPRINT_MASK_KEY)
    expect(resolveEntitySprite(entityLayer)?.texture).toBe(blueprintTexture)

    const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined
    const previewEffectRoot = overlayRoot?.children?.[0] as {
      children?: unknown[];
    } | undefined
    const previewMask = previewEffectRoot?.children?.[1] as RenderedSpriteSnapshot | undefined

    expect(previewMask?.texture).toBe(blueprintMaskTexture)
  })

  it("reloads belt textures after the simplified icon setting changes", async () => {
    const defaultTexture = createLoadedTextureMock("belt-device-texture")
    const blueprintTexture = createLoadedTextureMock("belt-blueprint-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": defaultTexture,
      "blueprint-sprite-belt_straight_1x1": blueprintTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-style-toggle",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: [],
    })

    sprite.syncLayout(createBeltLayout(), context)

    await flushMicrotasks(8)

    expect(resolveEntitySprite(entityLayer)?.texture).toBe(defaultTexture)

    renderHost.workspace.app.state.settings.gameUseSimplifiedDeviceIcons = true

    sprite.syncLayout(createBeltLayout(), context)

    await flushMicrotasks(8)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith("blueprint-sprite-belt_straight_1x1")
    expect(resolveEntitySprite(entityLayer)?.texture).toBe(blueprintTexture)
  })

  it("uses the muted light-theme tint for single selection, preview, and logistics head", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    await flushMicrotasks(4)

    const mutedLightTint = resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.dedicatedLogisticFocusTintColorKey,
    )

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
    const overlayLayer = createLayerStub()
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
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

  it("keeps the pipe multi-selection tint aligned with belt states", async () => {
    const resolvedTexture = createLoadedTextureMock("pipe-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-pipe_straight_1x1": resolvedTexture,
      "texture-pipe_straight_1x1_liquid": resolvedTexture,
    })
    const sprite = new PipeSprite(
      "pipe-entity-3",
      createPipeEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    await flushMicrotasks(4)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: ["pipe-entity-3", "other-entity"],
      previewIds: [],
    }))

    expect(resolveEntitySprite(entityLayer)?.tint).toBe(resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.worldPreviewRectFillColorKey,
    ))
  })

  it("uses the preview blue tint for marquee candidates before apply", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-marquee",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    await flushMicrotasks(4)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      marqueeIds: ["belt-entity-marquee"],
    }))

    expect(resolveEntitySprite(entityLayer)?.tint).toBe(resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.worldPreviewRectFillColorKey,
    ))
  })

  it("falls back to the ordinary tint when reverse marquee suppresses selection", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-belt_straight_1x1": resolvedTexture,
    })
    const sprite = new BeltSprite(
      "belt-entity-reverse-marquee",
      createBeltEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    await flushMicrotasks(4)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: ["belt-entity-reverse-marquee"],
      previewIds: [],
      reverseMarqueeIds: ["belt-entity-reverse-marquee"],
    }))

    expect(resolveEntitySprite(entityLayer)?.tint).toBe(resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.beltTileStrokeColorKey,
    ))
  })

  it("uses the renderer focus tint for preview and logistics head under the dark theme", async () => {
    const resolvedTexture = createLoadedTextureMock("belt-device-texture")
    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    await flushMicrotasks(4)

    const darkFocusTint = resolveAppThemeColorNumber(
      AYU_DARK_THEME,
      AYU_DARK_THEME.renderer.dedicatedLogisticFocusTintColorKey,
    )

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: ["belt-entity-4"],
      theme: AYU_DARK_THEME,
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(darkFocusTint)

    sprite.syncLayout(createBeltLayout(), createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      logisticsHeadIds: ["belt-entity-4"],
      theme: AYU_DARK_THEME,
    }))
    expect(resolveEntitySprite(entityLayer)?.tint).toBe(darkFocusTint)
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      logisticsPortOccupancy: null,
      suppressBelts: false,
      suppressPipes: false,
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

    expect(previewEffectRoot?.children).toHaveLength(4)
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      logisticsPortOccupancy: null,
      suppressBelts: false,
      suppressPipes: false,
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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

  it("anchors water pump port chevrons to the footprint when the sprite is larger than the footprint", async () => {
    const resolvedTexture = createLoadedTextureMock("water-pump-texture")
    const resolvedMaskTexture = createLoadedTextureMock("water-pump-mask-texture")
    const liquidOutputTexture = createLoadedTextureMock("liquid-output-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      "device-sprite-item_port_water_pump_1": resolvedTexture,
      "device-masks-item_port_water_pump_1": resolvedMaskTexture,
      [SOLID_INPUT_KEY]: createLoadedTextureMock("solid-input-texture"),
      [SOLID_OUTPUT_KEY]: createLoadedTextureMock("solid-output-texture"),
      [LIQUID_INPUT_KEY]: createLoadedTextureMock("liquid-input-texture"),
      [LIQUID_OUTPUT_KEY]: liquidOutputTexture,
    })
    const sprite = new GenericDeviceSprite(
      "water-pump",
      createWaterPumpEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: [],
      previewIds: ["water-pump"],
    })

    const cases = [
      {
        layout: { x: 80, y: 50, width: 160, height: 96, rotation: 0 as const },
        expected: { x: 256, y: 98, rotation: Math.PI / 2 },
      },
      {
        layout: { x: 80, y: 50, width: 96, height: 160, rotation: 90 as const },
        expected: { x: 128, y: 226, rotation: Math.PI },
      },
      {
        layout: { x: 80, y: 50, width: 160, height: 96, rotation: 180 as const },
        expected: { x: 64, y: 98, rotation: (Math.PI * 3) / 2 },
      },
      {
        layout: { x: 80, y: 50, width: 96, height: 160, rotation: 270 as const },
        expected: { x: 128, y: 34, rotation: 0 },
      },
    ]

    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index]!

      sprite.syncLayout(item.layout, context)
      await flushMicrotasks(8)
      sprite.syncLayout(item.layout, context)
      await flushMicrotasks(8)
      sprite.syncLayout(item.layout, context)

      const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
      const liquidChevron = portOverlayRoot?.children?.[0] as RenderedSpriteSnapshot | undefined

      expect(liquidChevron, `rotation=${item.layout.rotation}`).toMatchObject({
        x: item.expected.x,
        y: item.expected.y,
        width: 32,
        height: 32,
        rotation: item.expected.rotation,
        roundPixels: true,
        visible: true,
        texture: liquidOutputTexture,
      })
    }
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
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
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

  it("reloads port chevron textures when screen profile switches from desktop to mobile", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const desktopSolidInput = createLoadedTextureMock("desktop-solid-input")
    const desktopSolidOutput = createLoadedTextureMock("desktop-solid-output")
    const mobileSolidInput = createLoadedTextureMock("mobile-solid-input")
    const mobileSolidOutput = createLoadedTextureMock("mobile-solid-output")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [SOLID_INPUT_KEY]: desktopSolidInput,
      [SOLID_OUTPUT_KEY]: desktopSolidOutput,
      "texture-solid-port-chevron-input-mobile": mobileSolidInput,
      "texture-solid-port-chevron-output-mobile": mobileSolidOutput,
      [LIQUID_INPUT_KEY]: createLoadedTextureMock("liquid-input-texture"),
      [LIQUID_OUTPUT_KEY]: createLoadedTextureMock("liquid-output-texture"),
      "texture-liquid-port-chevron-input-mobile": createLoadedTextureMock("liq-input-mobile"),
      "texture-liquid-port-chevron-output-mobile": createLoadedTextureMock("liq-output-mobile"),
    })

    const sprite = new GenericDeviceSprite(
      "switching-device",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    // 第一轮：desktop
    const desktopContext = createRenderContextStub({
      selectionIds: ["switching-device"],
      previewIds: [],
      deviceClass: "desktop",
    })
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)

    // 验证请求了 desktop 版纹理
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(SOLID_INPUT_KEY)
    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith(SOLID_OUTPUT_KEY)

    const getTexture = renderHost.textureManager.getTexture as ReturnType<typeof vi.fn>
    getTexture.mockClear()

    // 第二轮：mobile — 需触发重载
    const mobileContext = createRenderContextStub({
      selectionIds: ["switching-device"],
      previewIds: [],
      deviceClass: "mobile",
    })

    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)

    // 验证重新请求了 -mobile 后缀的纹理
    expect(getTexture).toHaveBeenCalledWith("texture-solid-port-chevron-input-mobile")
    expect(getTexture).toHaveBeenCalledWith("texture-solid-port-chevron-output-mobile")

    // 验证端口 overlay 仍然可见、子节点数量正确
    const portOverlayRoot = resolvePortOverlayRoot(overlayLayer)
    expect(portOverlayRoot?.visible).toBe(true)
    expect(portOverlayRoot?.children).toHaveLength(6)
  })

  it("reloads port cross texture when screen profile switches from desktop to mobile", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const desktopCross = createLoadedTextureMock("desktop-cross-texture")
    const mobileCross = createLoadedTextureMock("mobile-cross-texture")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [SOLID_INPUT_KEY]: createLoadedTextureMock("solid-input-texture"),
      [SOLID_OUTPUT_KEY]: createLoadedTextureMock("solid-output-texture"),
      [LIQUID_INPUT_KEY]: createLoadedTextureMock("liquid-input-texture"),
      [LIQUID_OUTPUT_KEY]: createLoadedTextureMock("liquid-output-texture"),
      "texture-port-cross": desktopCross,
      "texture-port-cross-mobile": mobileCross,
    })

    const sprite = new GenericDeviceSprite(
      "cross-switching-device",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    // desktop 轮：logistics-placement 模式下对不匹配端口绘制红叉
    const desktopContext = createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      deviceClass: "desktop",
      activeTool: "logistics-placement",
    })
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, desktopContext)

    expect(renderHost.textureManager.getTexture).toHaveBeenCalledWith("texture-port-cross")

    const getTexture = renderHost.textureManager.getTexture as ReturnType<typeof vi.fn>
    getTexture.mockClear()

    // mobile 轮
    const mobileContext = createRenderContextStub({
      selectionIds: [],
      previewIds: [],
      deviceClass: "mobile",
      activeTool: "logistics-placement",
    })

    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, mobileContext)

    expect(getTexture).toHaveBeenCalledWith("texture-port-cross-mobile")
  })

  it("skips port chevron texture reload when deviceClass does not change", async () => {
    const resolvedTexture = createLoadedTextureMock("device-texture")
    const resolvedMaskTexture = createLoadedTextureMock("device-mask-texture")
    const desktopSolidInput = createLoadedTextureMock("desktop-solid-input")
    const desktopSolidOutput = createLoadedTextureMock("desktop-solid-output")

    const entityLayer = createLayerStub()
    const overlayLayer = createLayerStub()
    const renderHost = createRenderHostStub({
      [BODY_KEY]: resolvedTexture,
      [MASK_KEY]: resolvedMaskTexture,
      [SOLID_INPUT_KEY]: desktopSolidInput,
      [SOLID_OUTPUT_KEY]: desktopSolidOutput,
      [LIQUID_INPUT_KEY]: createLoadedTextureMock("liquid-input-texture"),
      [LIQUID_OUTPUT_KEY]: createLoadedTextureMock("liquid-output-texture"),
    })

    const sprite = new GenericDeviceSprite(
      "same-variant-device",
      createEntityDefinitionStub(),
      renderHost as never,
    )

    sprite.attach({
      background: {} as never,
      entityLow: {} as never,
      entityHigh: {} as never,
      logisticsBelt: {} as never,
      logisticsPipe: {} as never,
      entity: entityLayer as never,
      overlay: overlayLayer as never,
    })

    const context = createRenderContextStub({
      selectionIds: ["same-variant-device"],
      previewIds: [],
      deviceClass: "desktop",
    })

    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, context)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, context)
    await flushMicrotasks(8)
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, context)

    const firstCallCount = (renderHost.textureManager.getTexture as ReturnType<typeof vi.fn>).mock.calls.length

    // 第二轮：不切换 context，再次 sync 不应触发新的纹理请求
    sprite.syncLayout({ x: 16, y: 24, width: 48, height: 48, rotation: 0 }, context)
    await flushMicrotasks(8)

    const secondCallCount = (renderHost.textureManager.getTexture as ReturnType<typeof vi.fn>).mock.calls.length
    expect(secondCallCount).toBe(firstCallCount)
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
    // AI-REMOVED 2026-06-12:
    // Reason: PortDefinition.count per-tick 限流字段已删除。
    // Trigger: 用户要求删除 per tick count。
    // Evidence: 通用端口 fixture 不应继续生成旧 count 字段。
    // Replacement: None.
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // count: "unlimited" as const,
    priorityGroup: 5,
    roundRobinSeed,
  }
}

function createSlotDefaults() {
  return {
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    // AI-REMOVED 2026-06-06:
    // Reason: StorageSlotDefinition 不再包含 submitMode / submitIntervalSeconds。
    // Trigger: 用户要求 submit mode 机制彻底删除。
    // Evidence: src/domain/registry/types/entity-definition.ts 已删除槽位提交字段。
    // Replacement: None in this domain slot stub.
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // submitMode: "never" as const,
    // submitIntervalSeconds: null,
  }
}

function createEntityDefinitionStub(): EntityDefinition {
  return {
    id: "item_port_storager_1",
    nameKey: "registry.entity.item_port_storager_1.name",
    spriteId: "item_port_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    displayOrder: 100,
    tags: [],
    requiresPower: false,
    powerDemand: 5,
    inspectors: [],
    placementBehaviors: [],
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
    storageSlotGroups: Array.from({ length: 6 }, (_, index) => ({
      id: `storage_slot_${index + 1}`,
      kind: "item" as const,
      // AI-REMOVED 2026-05-17:
      // Reason: StorageSlotGroupDefinition.role 已删除，继续保留会破坏类型检查。
      // Trigger: REQ-078 验收运行全仓 typecheck 时暴露旧测试 helper 仍写 role。
      // Evidence: src/domain/registry/types/entity-definition.ts 已用 AI-CORRECTION 标注 role 字段删除。
      // Replacement: portStorageBindings 绑定输入/输出端口方向。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // role: "bidirectional",
      slots: [
        {
          id: "slot_1",
          capacity: 50,
          itemFilter: "type" as const,
          itemFilterType: "solid" as const,
          ...createSlotDefaults(),
        },
      ],
    })),
    recipeChannels: [],
    portStorageBindings: Array.from({ length: 6 }, (_, index) => [
      {
        id: `bind_item_input_${index + 1}`,
        portGroupId: "item_input",
        storageSlotGroupId: `storage_slot_${index + 1}`,
      },
      {
        id: `bind_item_output_${index + 1}`,
        portGroupId: "item_output",
        storageSlotGroupId: `storage_slot_${index + 1}`,
      },
    ]).flat(),
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
        // AI-REMOVED 2026-05-17:
        // Reason: StorageSlotGroupDefinition.role 已删除，继续保留会破坏类型检查。
        // Trigger: REQ-078 验收运行全仓 typecheck 时暴露旧测试 helper 仍写 role。
        // Evidence: src/domain/registry/types/entity-definition.ts 已用 AI-CORRECTION 标注 role 字段删除。
        // Replacement: portStorageBindings 绑定输入端口方向。
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // role: "input",
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

function createWaterPumpEntityDefinitionStub(): EntityDefinition {
  return {
    ...createEntityDefinitionStub(),
    id: "item_port_water_pump_1",
    nameKey: "registry.entity.item_port_water_pump_1.name",
    spriteId: "item_port_water_pump_1",
    footprint: { width: 3, height: 3 },
    spriteOffset: {
      topView: { x: -2, y: 0, width: 5, height: 3 },
    },
    portGroups: [
      {
        id: "fluid_output",
        kind: "fluid",
        direction: "output",
        ports: [
          {
            id: "out_e_1",
            localCellX: 2,
            localCellY: 1,
            edge: "EAST",
            ...createPortDefaults("fluid"),
          },
        ],
      },
    ],
    storageSlotGroups: [
      {
        id: "fluid_output_buffer",
        kind: "fluid",
        slots: [
          {
            id: "output_fluid_slot",
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
        id: "bind_fluid_output",
        portGroupId: "fluid_output",
        storageSlotGroupId: "fluid_output_buffer",
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

function createPipeEntityDefinitionStub(): EntityDefinition {
  return {
    ...createEntityDefinitionStub(),
    id: "pipe_straight_1x1",
    nameKey: "registry.entity.pipe_straight_1x1.name",
    spriteId: "pipe_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["PipeFamily"],
  }
}

function createPipeTurnEntityDefinitionStub(spriteId: "pipe_turn_cw_1x1" | "pipe_turn_ccw_1x1"): EntityDefinition {
  return {
    ...createPipeEntityDefinitionStub(),
    id: spriteId,
    nameKey: `registry.entity.${spriteId}.name`,
    spriteId,
  }
}

function createBeltLogisticsEntityDefinitionStub(): EntityDefinition {
  return {
    ...createEntityDefinitionStub(),
    id: "item_log_splitter",
    nameKey: "registry.entity.item_log_splitter.name",
    spriteId: "item_log_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily"],
  }
}

function createRenderContextStub(options: {
  selectionIds: readonly string[];
  previewIds: readonly string[];
  marqueeIds?: readonly string[];
  reverseMarqueeIds?: readonly string[];
  logisticsHeadIds?: readonly string[];
  theme?: typeof AYU_LIGHT_THEME;
  getPipeFluidItemId?: (deviceId: string) => string | null;
  isPipeDeviceSlotOccupied?: (deviceId: string) => boolean;
  itemDefinitions?: Array<{
    id: string;
    nameKey: string;
    iconId: string;
    displayOrder: number;
    tags: string[];
  }>;
  deviceClass?: "desktop" | "tablet" | "mobile";
  activeTool?: string;
}) {
  const workspace: Record<string, unknown> = {
    registry: {
      itemDefinitions: options.itemDefinitions ?? [],
    },
    editor: {
      state: {
        viewport: {
          gridSize: 1,
          gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
        },
        collections: {
          [EntityCollectionType.selection]: createCollectionStub(options.selectionIds),
          [EntityCollectionType.marquee]: createCollectionStub(options.marqueeIds ?? []),
          [EntityCollectionType.reverseMarquee]: createCollectionStub(options.reverseMarqueeIds ?? []),
          [EntityCollectionType.preview]: createCollectionStub(options.previewIds),
          [EntityCollectionType.ghost]: createCollectionStub([]),
          [EntityCollectionType.logisticsHead]: createCollectionStub(options.logisticsHeadIds ?? []),
        },
      },
      queries: { resolveLogisticsDraftState: () => undefined },
    },
    simulation: {
      queries: {
        getPipeFluidItemId: options.getPipeFluidItemId ?? (() => null),
        isPipeDeviceSlotOccupied: options.isPipeDeviceSlotOccupied ?? (() => false),
      },
    },
  }

  if (options.deviceClass !== undefined || options.activeTool !== undefined) {
    workspace.app = {
      state: {
        settings: {},
        screenProfile: {
          deviceClass: options.deviceClass ?? "desktop",
        },
        activeTool: options.activeTool ?? null,
      },
    }
  }

  return {
    theme: options.theme ?? AYU_LIGHT_THEME,
    workspace: workspace as never,
    logisticsPortOccupancy: null,
    suppressBelts: false,
    suppressPipes: false,
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

function resolvePipeBeadSprite(entityLayer: ReturnType<typeof createLayerStub>) {
  const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return entityRoot?.children?.[1] as RenderedSpriteSnapshot | undefined
}

function resolveDeviceLabelRoot(entityLayer: ReturnType<typeof createLayerStub>) {
  const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return entityRoot?.children?.[1] as {
    visible?: boolean;
    children?: unknown[];
  } | undefined
}

function resolvePreviewEffectRoot(overlayLayer: ReturnType<typeof createLayerStub>) {
  const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return overlayRoot?.children?.[0] as {
    visible?: boolean;
    children?: unknown[];
  } | undefined
}

function resolveSelectionEffectRoot(overlayLayer: ReturnType<typeof createLayerStub>) {
  const overlayRoot = overlayLayer.addChild.mock.calls[0]?.[0] as {
    children?: unknown[];
  } | undefined

  return overlayRoot?.children?.[1] as {
    visible?: boolean;
    children?: unknown[];
  } | undefined
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

function createRenderHostStub(
  textureByKey: Record<string, object>,
  options?: {
    gameUseSimplifiedDeviceIcons?: boolean;
    gameShowDeviceIcons?: boolean;
    gameShowDeviceNames?: boolean;
  },
) {
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
    workspace: {
      app: {
        actions: {
          translate: vi.fn((key: string) => {
            if (key === "registry.entity.item_port_storager_1.name") {
              return "Storage"
            }

            return key
          }),
        },
        state: {
          settings: {
            gameUseSimplifiedDeviceIcons: options?.gameUseSimplifiedDeviceIcons ?? false,
            gameShowDeviceIcons: options?.gameShowDeviceIcons ?? false,
            gameShowDeviceNames: options?.gameShowDeviceNames ?? true,
          },
        },
      },
    },
    textureManager: {
      getTexture,
    },
  }
}

function createRenderContextAppStub(renderHost: ReturnType<typeof createRenderHostStub>) {
  return {
    ...renderHost.workspace.app,
    state: {
      ...renderHost.workspace.app.state,
      screenProfile: {
        deviceClass: "desktop",
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
