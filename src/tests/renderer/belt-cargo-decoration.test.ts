import { describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockRectangle {
    public constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public visible = true
    public x = 0
    public y = 0
    public rotation = 0
    public mask: unknown = null

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
      if (child.parent !== null) {
        const previousIndex = child.parent.children.indexOf(child)
        if (previousIndex >= 0) {
          child.parent.children.splice(previousIndex, 1)
        }
      }
      child.parent = this
      this.children.push(child)
      return child
    }

    public destroy(): void {
      this.children.length = 0
      this.parent = null
    }
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      type: "rect" | "roundRect" | "poly";
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      radius?: number;
      points?: number[];
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public parent: MockContainer | null = null
    public visible = true
    public renderable = true
    public clearCalls = 0

    public constructor(_options?: { roundPixels?: boolean }) {}

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ type: "rect", x, y, width, height })
      return this
    }

    public roundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius = 0,
    ): this {
      this.drawCommands.push({ type: "roundRect", x, y, width, height, radius })
      return this
    }

    public poly(points: number[]): this {
      this.drawCommands.push({ type: "poly", points })
      return this
    }

    public fill(fill: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.fill = fill
      }
      return this
    }

    public stroke(stroke: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.stroke = stroke
      }
      return this
    }

    public clear(): this {
      this.clearCalls += 1
      this.drawCommands.length = 0
      return this
    }

    public destroy(): void {}
  }

  class MockSprite {
    public parent: MockContainer | null = null
    public texture: unknown
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public visible = true
    public renderable = true
    public roundPixels = false
    public rotation = 0
    public readonly anchor = {
      x: 0,
      y: 0,
      set: (x: number, y = x) => {
        this.anchor.x = x
        this.anchor.y = y
      },
    }

    public constructor(texture: unknown) {
      this.texture = texture
    }

    public destroy(): void {}
  }

  class MockTexture {
    public static readonly EMPTY = { id: "empty-texture" }

    public readonly source: unknown
    public readonly label: string | undefined
    public readonly frame: MockRectangle
    public readonly orig: MockRectangle
    public readonly trim: MockRectangle
    public readonly defaultAnchor: { x: number; y: number } | undefined
    public readonly defaultBorders: unknown
    public readonly rotate: number

    public constructor(options?: {
      source?: unknown;
      label?: string;
      frame?: MockRectangle;
      orig?: MockRectangle;
      trim?: MockRectangle;
      defaultAnchor?: { x: number; y: number };
      defaultBorders?: unknown;
      rotate?: number;
    }) {
      this.source = options?.source ?? { width: 0, height: 0 }
      this.label = options?.label
      this.frame = options?.frame ?? new MockRectangle(0, 0, 0, 0)
      this.orig = options?.orig ?? new MockRectangle(0, 0, this.frame.width, this.frame.height)
      this.trim = options?.trim ?? new MockRectangle(0, 0, this.frame.width, this.frame.height)
      this.defaultAnchor = options?.defaultAnchor
      this.defaultBorders = options?.defaultBorders
      this.rotate = options?.rotate ?? 0
    }

    public destroy(): void {}
  }

  class MockRenderTexture extends MockTexture {
    public static create(options: {
      width: number;
      height: number;
    }): MockRenderTexture {
      return new MockRenderTexture({
        frame: new MockRectangle(0, 0, options.width, options.height),
      })
    }

    public resize(width: number, height: number): this {
      this.frame.width = width
      this.frame.height = height
      return this
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Rectangle: MockRectangle,
    RenderTexture: MockRenderTexture,
    Sprite: MockSprite,
    Texture: MockTexture,
  }
})

import {
  Rectangle,
  Texture,
} from "pixi.js"

import {
  createBeltCargoDecoration,
  resolveBeltCargoBoxSize,
} from "@/renderer/scene/decorations/BeltCargoDecoration"
import { ITEM_ICON_TEXTURE_INSET_PX } from "@/renderer/texture"
import { createRegistryContract } from "@/registry"

describe("createBeltCargoDecoration", () => {
  it("draws the moving cargo box and only requests each item icon once", async () => {
    const decoration = createBeltCargoDecoration()
    const iconTexture = createIconTexture(32, 32)
    const getTexture = vi.fn().mockResolvedValue(iconTexture)
    const ctx = createContext({ getTexture })

    decoration.sync(ctx as never)
    decoration.sync(ctx as never)

    expect(getTexture).toHaveBeenCalledTimes(1)
    expect(getTexture).toHaveBeenCalledWith("item-icon-item_iron_ore")

    const cargoRoot = resolveCargoRoot(decoration, 0)
    expect(cargoRoot.x).toBeCloseTo(100)
    expect(cargoRoot.y).toBeCloseTo(100)
    expect(cargoRoot.rotation).toBeCloseTo(0)

    const boxSprite = cargoRoot.children[0] as unknown as {
      texture: unknown;
      width: number;
      height: number;
    }
    const boxSize = resolveBeltCargoBoxSize(100)
    const boxTextureSize = Math.round(boxSize)
    expect(boxSprite.width).toBe(boxSize)
    expect(boxSprite.height).toBe(boxSize)
    expect(boxSprite.texture).not.toBeNull()

    // 验证 generateTexture 被调用且传入的 Graphics 有正确的 roundRect 命令
    const renderer = (ctx as unknown as { renderHost: { app: { renderer: { generateTexture: ReturnType<typeof vi.fn> } } } }).renderHost.app.renderer
    expect(renderer.generateTexture).toHaveBeenCalledTimes(1)
    const generatedGraphics = renderer.generateTexture.mock.calls[0]![0] as {
      drawCommands: Array<{
        type: "roundRect";
        x: number;
        y: number;
        width: number;
        height: number;
        radius: number;
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(generatedGraphics.drawCommands).toHaveLength(1)
    expect(generatedGraphics.drawCommands[0]).toMatchObject({
      type: "roundRect",
      x: -boxTextureSize / 2,
      y: -boxTextureSize / 2,
      width: boxTextureSize,
      height: boxTextureSize,
      fill: 0xffffff,
      stroke: {
        width: 1,
        color: 0x000000,
        pixelLine: true,
      },
    })

    const sprite = cargoRoot.children[1] as {
      visible: boolean;
      texture: unknown;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    }
    expect(sprite.visible).toBe(false)

    await flushMicrotasks()
    decoration.sync(ctx as never)

    const updatedBoxSprite = cargoRoot.children[0] as unknown as {
      texture: unknown;
      width: number;
      height: number;
    }
    expect(updatedBoxSprite.texture).not.toBeNull()

    expect(sprite.visible).toBe(true)
    expect(sprite.texture).not.toBe(iconTexture)
    const insetIconSize = 32 - ITEM_ICON_TEXTURE_INSET_PX * 2
    expect(sprite.texture).toMatchObject({
      source: iconTexture.source,
      frame: {
        x: ITEM_ICON_TEXTURE_INSET_PX,
        y: ITEM_ICON_TEXTURE_INSET_PX,
        width: insetIconSize,
        height: insetIconSize,
      },
      orig: {
        x: 0,
        y: 0,
        width: insetIconSize,
        height: insetIconSize,
      },
    })
    expect(sprite.x).toBeCloseTo(0)
    expect(sprite.y).toBeCloseTo(0)
    expect(sprite.width).toBeCloseTo(boxSize * 0.72)
    expect(sprite.height).toBeCloseTo(boxSize * 0.72)
    expect(sprite.rotation).toBeCloseTo(0)

    ctx.viewportState.gridCellPixelSize = 100.1
    decoration.sync(ctx as never)

    const resizedBoxSize = resolveBeltCargoBoxSize(100.1)
    expect(renderer.generateTexture).toHaveBeenCalledTimes(1)
    expect(boxSprite.width).toBeCloseTo(resizedBoxSize)
    expect(boxSprite.height).toBeCloseTo(resizedBoxSize)

    decoration.destroy()
  })

  it("draws every running belt reported by device runtime status", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      entries: [
        {
          beltShape: "straight",
          position: { x: 0, y: 0 },
          rotation: 0,
          itemId: "item_iron_ore",
          progress: 0.25,
        },
        {
          beltShape: "straight",
          position: { x: 1, y: 0 },
          rotation: 90,
          itemId: "item_iron_ore",
          progress: 0.75,
        },
      ],
    })

    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(true)
    expect(resolveCargoViewRoots(decoration)).toHaveLength(2)

    decoration.destroy()
  })

  it("draws turn belts along the belt centerline and rotates cargo with the tangent", async () => {
    const cases = [
      {
        beltShape: "turn-cw" as const,
        expected: {
          x: 114.64466094067262,
          y: 85.35533905932738,
          rotation: -2.356194490192345,
        },
      },
      {
        beltShape: "turn-ccw" as const,
        expected: {
          x: 114.64466094067262,
          y: 85.35533905932738,
          rotation: 0.7853981633974483,
        },
      },
    ]

    for (const testCase of cases) {
      const decoration = createBeltCargoDecoration()
      const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
      const ctx = createContext({
        getTexture,
        beltShape: testCase.beltShape,
      })

      decoration.sync(ctx as never)

      const cargoRoot = resolveCargoRoot(decoration, 0)
      expect(cargoRoot.x).toBeCloseTo(testCase.expected.x)
      expect(cargoRoot.y).toBeCloseTo(testCase.expected.y)
      expect(cargoRoot.rotation).toBeCloseTo(testCase.expected.rotation)

      await flushMicrotasks()
      decoration.sync(ctx as never)
      const sprite = cargoRoot.children[1] as { rotation: number }
      expect(sprite.rotation).toBeCloseTo(0)

      decoration.destroy()
    }
  })

  it("keeps cargo boxes proportional while staying below the turn endpoint overlap limit", () => {
    const referenceGridCellSize = 128
    const referenceBoxSize = resolveBeltCargoBoxSize(referenceGridCellSize)
    const referenceRatio = referenceBoxSize / referenceGridCellSize

    expect(referenceBoxSize).toBe(62)

    for (const gridCellSize of [8, 16, 32, 64, 100]) {
      const boxSize = resolveBeltCargoBoxSize(gridCellSize)

      expect(boxSize / gridCellSize).toBeCloseTo(referenceRatio)
      expect(boxSize).toBeLessThan(gridCellSize * 0.5)
    }
  })

  it("shows stationary ingredient cargo at the belt start", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.5,
        runtimeStatus: {
          channelRecipes: {},
          slotItems: [{
            slotType: "ingredient",
            storageGroupId: "item_buffer",
            slotId: "slot_1",
            viewRole: "input-view",
            itemType: "item_iron_ore",
            count: 1,
            reserved: 0,
          }],
        },
      }],
    })

    decoration.sync(ctx as never)

    const cargoRoot = resolveCargoRoot(decoration, 0)
    expect(cargoRoot.x).toBeCloseTo(50)
    expect(cargoRoot.y).toBeCloseTo(100)

    decoration.destroy()
  })

  it("shows stationary product cargo at the belt end", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.5,
        runtimeStatus: {
          channelRecipes: {},
          slotItems: [{
            slotType: "product",
            storageGroupId: "item_buffer",
            slotId: "slot_1",
            viewRole: "output-view",
            itemType: "item_iron_ore",
            count: 1,
            reserved: 0,
          }],
        },
      }],
    })

    decoration.sync(ctx as never)

    const cargoRoot = resolveCargoRoot(decoration, 0)
    expect(cargoRoot.x).toBeCloseTo(150)
    expect(cargoRoot.y).toBeCloseTo(100)

    decoration.destroy()
  })

  it("stays hidden when the running belt has no matching reserved item", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      entries: [],
    })

    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(false)
    expect(getTexture).not.toHaveBeenCalled()

    decoration.destroy()
  })

  it("clips moving cargo to the belt insertion segment when it overlaps a target device", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      includeInsertionTarget: true,
      nowMs: 1000,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
      }],
    })

    decoration.sync(ctx as never)

    const cargoViewRoot = resolveCargoViewRoot(decoration, 0)
    const cargoRoot = resolveCargoRoot(decoration, 0)
    expect(cargoViewRoot.visible).toBe(true)
    expect(cargoViewRoot.x).toBe(0)
    expect(cargoViewRoot.y).toBe(0)
    expect(cargoViewRoot.rotation).toBe(0)
    expect(cargoRoot.x).toBeCloseTo(145)
    expect(cargoRoot.y).toBeCloseTo(100)
    expect(cargoRoot.rotation).toBeCloseTo(0)
    expect(cargoViewRoot.mask).toBe(null)
    expect(cargoViewRoot.parent).toBe(resolveSharedCargoLayer(decoration))

    const mask = resolveRenderedMaskSource(ctx)
    expect(mask.drawCommands).toHaveLength(3)
    expect(mask.drawCommands[0]).toMatchObject({
      type: "rect",
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    })
    expect(mask.drawCommands[1]).toMatchObject({
      type: "poly",
      points: [150, 50, 170, 50, 170, 150, 150, 150],
    })
    expect(mask.drawCommands[2]).toMatchObject({
      type: "poly",
      points: [25, 50, 50, 50, 50, 150, 25, 150],
    })

    const emptyFrame = createContext({
      getTexture,
      includeInsertionTarget: true,
      nowMs: 1200,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
        runtimeStatus: createEmptyBeltRuntimeStatus(),
      }],
    })

    decoration.sync(emptyFrame as never)

    expect(decoration.container.visible).toBe(false)

    decoration.destroy()
  })

  it("clips cargo to the belt protrusion segment when it starts from a source device", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      includeOutputSource: true,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.05,
      }],
    })

    decoration.sync(ctx as never)

    const cargoViewRoot = resolveCargoViewRoot(decoration, 0)
    const cargoRoot = resolveCargoRoot(decoration, 0)
    expect(cargoRoot.x).toBeCloseTo(55)
    expect(cargoViewRoot.mask).toBe(null)
    expect(cargoViewRoot.parent).toBe(resolveSharedCargoLayer(decoration))
    const mask = resolveRenderedMaskSource(ctx)
    expect(mask.drawCommands).toHaveLength(3)
    expect(mask.drawCommands[0]).toMatchObject({
      type: "rect",
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    })
    expect(mask.drawCommands[1]).toMatchObject({
      type: "poly",
      points: [30, 50, 50, 50, 50, 150, 30, 150],
    })
    expect(mask.drawCommands[2]).toMatchObject({
      type: "poly",
      points: [150, 50, 175, 50, 175, 150, 150, 150],
    })

    decoration.destroy()
  })

  it("reopens a disconnected belt end after the target device is removed", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const connectedFrame = createContext({
      getTexture,
      includeOutputSource: true,
      includeInsertionTarget: true,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 1,
      }],
    })

    decoration.sync(connectedFrame as never)
    const connectedMask = resolveRenderedMaskSource(connectedFrame)
    expect(connectedMask.drawCommands[1]).toMatchObject({
      points: [150, 50, 170, 50, 170, 150, 150, 150],
    })

    const disconnectedFrame = createContext({
      getTexture,
      includeOutputSource: true,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 1,
      }],
    })

    decoration.sync(disconnectedFrame as never)
    const disconnectedMask = resolveRenderedMaskSource(disconnectedFrame)
    expect(disconnectedMask.drawCommands[2]).toMatchObject({
      points: [150, 50, 175, 50, 175, 150, 150, 150],
    })

    decoration.destroy()
  })

  it("reopens a disconnected belt start after the source device is removed", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const connectedFrame = createContext({
      getTexture,
      includeOutputSource: true,
      includeInsertionTarget: true,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0,
      }],
    })

    decoration.sync(connectedFrame as never)
    const connectedMask = resolveRenderedMaskSource(connectedFrame)
    expect(connectedMask.drawCommands[2]).toMatchObject({
      points: [30, 50, 50, 50, 50, 150, 30, 150],
    })

    const disconnectedFrame = createContext({
      getTexture,
      includeInsertionTarget: true,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0,
      }],
    })

    decoration.sync(disconnectedFrame as never)
    const disconnectedMask = resolveRenderedMaskSource(disconnectedFrame)
    expect(disconnectedMask.drawCommands[2]).toMatchObject({
      points: [25, 50, 50, 50, 50, 150, 25, 150],
    })

    decoration.destroy()
  })

  it("keeps cargo visible when a device-port belt continues into another belt", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      includeOutputSource: true,
      extraEntities: [createEntity("next-belt", "belt_straight_1x1", { x: 1, y: 0 }, 0)],
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
      }],
    })

    decoration.sync(ctx as never)

    const cargoViewRoot = resolveCargoViewRoot(decoration, 0)
    expect(cargoViewRoot.mask).toBe(null)
    expect(cargoViewRoot.parent).toBe(resolveSharedCargoLayer(decoration))

    decoration.destroy()
  })

  it("builds the shared bitmap mask from all visible belt cells", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      extraEntities: [
        createEntity("right-belt", "belt_straight_1x1", { x: 1, y: 0 }, 0),
        createEntity("bottom-belt", "belt_straight_1x1", { x: 0, y: 1 }, 0),
        createEntity("diagonal-belt", "belt_straight_1x1", { x: 1, y: 1 }, 0),
      ],
    })

    decoration.sync(ctx as never)

    const render = (ctx as unknown as {
      renderHost: {
        app: {
          renderer: {
            render: ReturnType<typeof vi.fn>;
          };
        };
      };
    }).renderHost.app.renderer.render
    const maskSource = render.mock.calls[0]?.[0]?.container as {
      drawCommands: Array<{
        type: "rect" | "poly";
        x?: number;
        y?: number;
      }>;
    }
    const rectCommands = maskSource.drawCommands.filter((command) => command.type === "rect")
    expect(rectCommands).toHaveLength(4)
    expect(rectCommands).toContainEqual(expect.objectContaining({
      x: 150,
      y: 150,
    }))

    decoration.destroy()
  })

  it("reuses an unchanged cargo mask instead of rebuilding its graphics commands", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const documentSnapshot = {}
    const ctx = createContext({
      getTexture,
      documentSnapshot,
    })

    decoration.sync(ctx as never)
    const render = (ctx as unknown as {
      renderHost: {
        app: {
          renderer: {
            render: ReturnType<typeof vi.fn>;
          };
        };
      };
    }).renderHost.app.renderer.render
    expect(render).toHaveBeenCalledTimes(1)

    decoration.sync(ctx as never)
    expect(render).toHaveBeenCalledTimes(1)

    decoration.destroy()
  })

  it("does not apply device-overlap masks in simplified blueprint-style display", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      includeInsertionTarget: true,
      simplifiedDeviceIcons: true,
      nowMs: 1000,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
      }],
    })

    decoration.sync(ctx as never)

    const cargoViewRoot = resolveCargoViewRoot(decoration, 0)
    expect(decoration.container.visible).toBe(true)
    expect(cargoViewRoot.mask).toBe(null)

    decoration.destroy()
  })
})

function createContext(options: {
  getTexture: (key: string) => Promise<unknown>;
  entries?: readonly {
    beltShape: "straight" | "turn-cw" | "turn-ccw";
    position: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    itemId: string;
    progress: number;
    runtimeStatus?: {
      channelRecipes?: Record<string, { recipeId: string | null; progressSeconds: number | null; desiredSeconds: number | null } | null>;
      slotItems: Array<{
        slotType: "ingredient" | "product" | "universal";
        storageGroupId: string;
        slotId: string;
        viewRole: "single-view" | "input-view" | "output-view";
        itemType: string | null;
        count: number;
        reserved: number;
      }>;
    };
  }[];
  beltShape?: "straight" | "turn-cw" | "turn-ccw";
  includeInsertionTarget?: boolean;
  includeOutputSource?: boolean;
  extraEntities?: Array<{
    id: string;
    definitionId: string;
    position: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    config: Record<string, unknown>;
    tags: string[];
  }>;
  simplifiedDeviceIcons?: boolean;
  nowMs?: number;
  documentSnapshot?: object;
}) {
  const registry = createRegistryContract()
  const entries = options.entries ?? [{
    beltShape: options.beltShape ?? "straight",
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    itemId: "item_iron_ore",
    progress: 0.5,
  }]
  const runtimeEntries = entries.map((entry, index) => ({
    ...entry,
    id: `belt-${index + 1}`,
    definitionId: resolveBeltDefinitionId(entry.beltShape),
  }))
  const entriesByEntityId = new Map(
    runtimeEntries.map((entry) => [entry.id, entry]),
  )
  const entities: Array<{
    id: string;
    definitionId: string;
    position: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    config: Record<string, unknown>;
    tags: string[];
  }> = runtimeEntries.map((entry) => ({
    id: entry.id,
    definitionId: entry.definitionId,
    position: entry.position,
    rotation: entry.rotation,
    config: {},
    tags: [],
  }))
  if (options.includeInsertionTarget === true) {
    entities.push({
      id: "target-storager",
      definitionId: "storager_1",
      position: { x: 1, y: -1 },
      rotation: 90,
      config: {},
      tags: [],
    })
  }
  if (options.includeOutputSource === true) {
    entities.push({
      id: "source-storager",
      definitionId: "storager_1",
      position: { x: -3, y: 0 },
      rotation: 90,
      config: {},
      tags: [],
    })
  }
  entities.push(...(options.extraEntities ?? []))

  return {
    viewportState: {
      width: 200,
      height: 200,
      resolution: 1,
      centerX: 0.5,
      centerY: 0.5,
      gridCellPixelSize: 100,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    },
    renderHost: {
      app: {
        renderer: {
          render: vi.fn(),
          generateTexture: vi.fn().mockImplementation((source: { clearCalls: number; drawCommands: unknown[] }) => {
            // 返回一个带有 drawCommands 的伪纹理，便于测试验证 box 烘焙结果
            return new Texture({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              source: { width: 100, height: 100 } as any,
              frame: new Rectangle(0, 0, 100, 100),
              orig: new Rectangle(0, 0, 100, 100),
              label: `generated-box-${source.drawCommands.length}`,
            })
          }),
        },
      },
      workspace: {
        app: {
          state: {
            settings: {
              gameUseBlueprintStyleDeviceImages: options.simplifiedDeviceIcons ?? false,
            },
          },
        },
        registry: {
          ...registry,
        },
        render: {},
        simulation: {
          state: {
            runningState: "start",
            simulationSpeed: 1,
            bufferSize: 0,
          },
          queries: {
            getDeviceRuntimeStatus: (entityId: string) => {
              const entry = entriesByEntityId.get(entityId)
              if (entry === undefined) {
                return null
              }

                return entry.runtimeStatus ?? {
                channelRecipes: {
                  default: {
                    recipeId: `${entry.definitionId}:dynamic-belt-transfer`,
                    progressSeconds: entry.progress,
                    desiredSeconds: 1,
                  },
                },
                slotItems: [{
                    slotType: "ingredient",
                    storageGroupId: "item_buffer",
                  slotId: "input_slot_1",
                    viewRole: "input-view",
                  itemType: entry.itemId,
                  count: 1,
                  reserved: 1,
                }],
                }
            },
          },
        },
        editor: {
          document: options.documentSnapshot === undefined
            ? undefined
            : {
                getSnapshot: () => options.documentSnapshot,
              },
          queries: {
            listEntities: () => entities,
          },
        },
      } as never,
      textureManager: {
        getTexture: options.getTexture ?? (async () => ({ width: 32, height: 32 })),
      } as never,
    } as never,
    nowMs: options.nowMs ?? 1000,
  }
}

function createEntity(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
  rotation: 0 | 90 | 180 | 270,
) {
  return {
    id,
    definitionId,
    position,
    rotation,
    config: {},
    tags: [],
  }
}

function resolveBeltDefinitionId(beltShape: "straight" | "turn-cw" | "turn-ccw"): string {
  switch (beltShape) {
    case "turn-cw":
      return "belt_turn_cw_1x1"
    case "turn-ccw":
      return "belt_turn_ccw_1x1"
    default:
      return "belt_straight_1x1"
  }
}

function createEmptyBeltRuntimeStatus() {
  return {
    channelRecipes: {},
    slotItems: [],
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

function resolveCargoViewRoot(
  decoration: ReturnType<typeof createBeltCargoDecoration>,
  index: number,
) {
  const root = resolveCargoViewRoots(decoration)[index]
  if (root === undefined) {
    throw new Error(`Expected cargo view root at index ${index}.`)
  }

  return root
}

function resolveCargoViewRoots(
  decoration: ReturnType<typeof createBeltCargoDecoration>,
) {
  const layers = decoration.container.children.slice(1) as Array<{
    children?: Array<{
      parent: unknown;
      visible: boolean;
      x: number;
      y: number;
      rotation: number;
      mask: unknown;
      children: unknown[];
    }>;
  }>

  return layers.flatMap((layer) =>
    (layer.children ?? []).filter((child) => child.children.length === 1),
  )
}

function resolveSharedCargoLayer(
  decoration: ReturnType<typeof createBeltCargoDecoration>,
) {
  const layer = decoration.container.children[1]
  if (layer === undefined) {
    throw new Error("Expected shared cargo layer.")
  }
  return layer
}

function resolveRenderedMaskSource(ctx: unknown) {
  const render = (ctx as {
    renderHost: {
      app: {
        renderer: {
          render: ReturnType<typeof vi.fn>;
        };
      };
    };
  }).renderHost.app.renderer.render
  const lastCall = render.mock.calls.at(-1)
  const source = lastCall?.[0]?.container as {
    drawCommands: Array<{
      type: "rect" | "poly";
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      points?: number[];
    }>;
  } | undefined
  if (source === undefined) {
    throw new Error("Expected shared belt cargo mask source.")
  }
  return source
}

function resolveCargoRoot(
  decoration: ReturnType<typeof createBeltCargoDecoration>,
  index: number,
) {
  const root = resolveCargoViewRoot(decoration, index)
  const cargoRoot = root.children[0] as {
    visible: boolean;
    x: number;
    y: number;
    rotation: number;
    mask: unknown;
    children: unknown[];
  } | undefined
  if (cargoRoot === undefined) {
    throw new Error(`Expected cargo root at index ${index}.`)
  }

  return cargoRoot
}

function createIconTexture(width: number, height: number) {
  return new Texture({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: { width, height } as any,
    frame: new Rectangle(0, 0, width, height),
    orig: new Rectangle(0, 0, width, height),
  })
}
