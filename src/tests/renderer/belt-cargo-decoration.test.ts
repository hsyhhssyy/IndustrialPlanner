import { describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public visible = true
    public x = 0
    public y = 0
    public rotation = 0
    public mask: unknown = null

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
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
      type: "rect" | "poly";
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      points?: number[];
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public parent: MockContainer | null = null
    public visible = true

    public constructor(_options?: { roundPixels?: boolean }) {}

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ type: "rect", x, y, width, height })
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

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    Texture: {
      EMPTY: { id: "empty-texture" },
    },
  }
})

import { createBeltCargoDecoration } from "@/renderer/scene/decorations/BeltCargoDecoration"
import { createRegistryContract } from "@/registry"

describe("createBeltCargoDecoration", () => {
  it("draws the moving cargo box and only requests each item icon once", async () => {
    const decoration = createBeltCargoDecoration()
    const iconTexture = { id: "item-iron-ore-texture" }
    const getTexture = vi.fn().mockResolvedValue(iconTexture)
    const ctx = createContext({ getTexture })

    decoration.sync(ctx as never)
    decoration.sync(ctx as never)

    expect(getTexture).toHaveBeenCalledTimes(1)
    expect(getTexture).toHaveBeenCalledWith("item-icon-item_iron_ore")

    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<{
        type: "poly";
        points: number[];
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)
    expect(boxGraphics.drawCommands[0]).toMatchObject({
      type: "poly",
      points: [70, 70, 130, 70, 130, 130, 70, 130],
      fill: 0xffffff,
      stroke: {
        width: 1,
        color: 0x000000,
        pixelLine: true,
      },
    })

    const iconLayer = decoration.container.children[1] as { children: unknown[] }
    expect(iconLayer.children).toHaveLength(0)

    await flushMicrotasks()
    decoration.sync(ctx as never)

    expect(iconLayer.children).toHaveLength(1)
    const sprite = iconLayer.children[0] as {
      texture: unknown;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    }
    expect(sprite.texture).toBe(iconTexture)
    expect(sprite.x).toBeCloseTo(100)
    expect(sprite.y).toBeCloseTo(100)
    expect(sprite.width).toBeCloseTo(43.2)
    expect(sprite.height).toBeCloseTo(43.2)
    expect(sprite.rotation).toBeCloseTo(0)

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
    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<unknown>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(2)

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

      const boxGraphics = decoration.container.children[0] as unknown as {
        drawCommands: Array<{
          points: number[];
        }>;
      }
      expect(boxGraphics.drawCommands).toHaveLength(1)
      const center = resolvePolygonCenter(boxGraphics.drawCommands[0]?.points ?? [])
      expect(center.x).toBeCloseTo(testCase.expected.x)
      expect(center.y).toBeCloseTo(testCase.expected.y)

      await flushMicrotasks()
      decoration.sync(ctx as never)
      const iconLayer = decoration.container.children[1] as { children: unknown[] }
      const sprite = iconLayer.children[0] as { rotation: number }
      expect(sprite.rotation).toBeCloseTo(testCase.expected.rotation)

      decoration.destroy()
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
          recipeId: null,
          progressSeconds: null,
          desiredSeconds: null,
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

    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<{
        points: number[];
      }>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)
    const center = resolvePolygonCenter(boxGraphics.drawCommands[0]?.points ?? [])
    expect(center.x).toBeCloseTo(50)
    expect(center.y).toBeCloseTo(100)

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
          recipeId: null,
          progressSeconds: null,
          desiredSeconds: null,
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

    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<{
        points: number[];
      }>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)
    const center = resolvePolygonCenter(boxGraphics.drawCommands[0]?.points ?? [])
    expect(center.x).toBeCloseTo(150)
    expect(center.y).toBeCloseTo(100)

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

  it("renders accepted cargo as a masked handoff into the target device", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const firstFrame = createContext({
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
    const secondFrame = createContext({
      getTexture,
      includeInsertionTarget: true,
      nowMs: 1100,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
        runtimeStatus: createEmptyBeltRuntimeStatus(),
      }],
    })
    const thirdFrame = createContext({
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

    decoration.sync(firstFrame as never)
    decoration.sync(secondFrame as never)
    decoration.sync(thirdFrame as never)

    const handoffLayer = decoration.container.children[2] as {
      children: Array<{
        visible: boolean;
        x: number;
        y: number;
        rotation: number;
        children: unknown[];
      }>;
    }
    expect(handoffLayer.children).toHaveLength(1)
    const root = handoffLayer.children[0]
    expect(root?.visible).toBe(true)
    expect(root?.x).toBeCloseTo(150)
    expect(root?.y).toBeCloseTo(100)
    expect(root?.rotation).toBeCloseTo(0)

    const mask = root?.children[0] as {
      drawCommands: Array<{
        type: "rect";
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
    }
    expect(mask.drawCommands[0]).toMatchObject({
      type: "rect",
      x: -60,
      y: -50,
      width: 80,
      height: 100,
    })

    const cargoRoot = root?.children[1] as {
      x: number;
    }
    expect(cargoRoot.x).toBeGreaterThan(-10)
    expect(cargoRoot.x).toBeLessThan(50)

    decoration.destroy()
  })

  it("does not render handoff masks in simplified blueprint-style display", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const firstFrame = createContext({
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
    const secondFrame = createContext({
      getTexture,
      includeInsertionTarget: true,
      simplifiedDeviceIcons: true,
      nowMs: 1100,
      entries: [{
        beltShape: "straight",
        position: { x: 0, y: 0 },
        rotation: 0,
        itemId: "item_iron_ore",
        progress: 0.95,
        runtimeStatus: createEmptyBeltRuntimeStatus(),
      }],
    })

    decoration.sync(firstFrame as never)
    decoration.sync(secondFrame as never)

    expect(decoration.container.visible).toBe(false)

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
      recipeId: string | null;
      progressSeconds: number | null;
      desiredSeconds: number | null;
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
  simplifiedDeviceIcons?: boolean;
  nowMs?: number;
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
  const entities = runtimeEntries.map((entry) => ({
    id: entry.id,
    definitionId: entry.definitionId,
    position: entry.position,
    rotation: entry.rotation,
    config: {},
    tags: [],
  }))
  if (options.includeInsertionTarget === true) {
    entities.push({
      id: "target-admission",
      definitionId: "item_log_admission",
      position: { x: 1, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    })
  }

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
    workspace: {
      app: {
        state: {
          settings: {
            gameUseSimplifiedDeviceIcons: options.simplifiedDeviceIcons ?? false,
          },
        },
      },
      registry: {
        itemDefinitions: registry.itemDefinitions,
        entityDefinitions: registry.entityDefinitions,
      },
      render: {
        textureManager: {
          getTexture: options.getTexture,
        },
      },
      simulation: {
        state: {
          runningState: "start",
          simulationSpeed: 1,
        },
        queries: {
          getDeviceRuntimeStatus: (entityId: string) => {
            const entry = entriesByEntityId.get(entityId)
            if (entry === undefined) {
              return null
            }

              return entry.runtimeStatus ?? {
              recipeId: `${entry.definitionId}:dynamic-belt-transfer`,
              progressSeconds: entry.progress,
              desiredSeconds: 1,
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
        queries: {
          listEntities: () => entities,
        },
      },
    },
    nowMs: options.nowMs ?? 1000,
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
    recipeId: null,
    progressSeconds: null,
    desiredSeconds: null,
    slotItems: [],
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

function resolvePolygonCenter(points: readonly number[]): { x: number; y: number } {
  let x = 0
  let y = 0
  const pointCount = points.length / 2

  for (let index = 0; index < points.length; index += 2) {
    x += points[index] ?? 0
    y += points[index + 1] ?? 0
  }

  return {
    x: x / pointCount,
    y: y / pointCount,
  }
}
