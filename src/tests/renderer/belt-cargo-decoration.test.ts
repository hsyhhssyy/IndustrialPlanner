import { describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public visible = true

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
      x: number;
      y: number;
      width: number;
      height: number;
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public parent: MockContainer | null = null
    public visible = true

    public constructor(_options?: { roundPixels?: boolean }) {}

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ x, y, width, height })
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
        x: number;
        y: number;
        width: number;
        height: number;
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)
    expect(boxGraphics.drawCommands[0]).toMatchObject({
      x: 70,
      y: 70,
      width: 60,
      height: 60,
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
    }
    expect(sprite.texture).toBe(iconTexture)
    expect(sprite.x).toBeCloseTo(78.4)
    expect(sprite.y).toBeCloseTo(78.4)
    expect(sprite.width).toBeCloseTo(43.2)
    expect(sprite.height).toBeCloseTo(43.2)

    decoration.destroy()
  })

  it("draws every cargo entry returned by the simulation query", () => {
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

  it("draws turn belts along the belt centerline", () => {
    const cases = [
      {
        beltShape: "turn-cw" as const,
        expected: {
          x: 55.35533905932738,
          y: 84.64466094067262,
        },
      },
      {
        beltShape: "turn-ccw" as const,
        expected: {
          x: 55.35533905932738,
          y: 55.35533905932738,
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
          x: number;
          y: number;
          width: number;
          height: number;
        }>;
      }
      expect(boxGraphics.drawCommands).toHaveLength(1)
      expect(boxGraphics.drawCommands[0]?.x).toBeCloseTo(testCase.expected.x)
      expect(boxGraphics.drawCommands[0]?.y).toBeCloseTo(testCase.expected.y)

      decoration.destroy()
    }
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
})

function createContext(options: {
  getTexture: (key: string) => Promise<unknown>;
  entries?: readonly {
    beltShape: "straight" | "turn-cw" | "turn-ccw";
    position: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    itemId: string;
    progress: number;
  }[];
  beltShape?: "straight" | "turn-cw" | "turn-ccw";
}) {
  const entries = options.entries ?? [{
    beltShape: options.beltShape ?? "straight",
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    itemId: "item_iron_ore",
    progress: 0.5,
  }]

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
      registry: {
        itemDefinitions: [{
          id: "item_iron_ore",
          nameKey: "registry.item.item_iron_ore.name",
          iconId: "item_iron_ore",
          tags: [],
        }],
      },
      render: {
        textureManager: {
          getTexture: options.getTexture,
        },
      },
      simulation: {
        queries: {
          getBeltCargoEntries: () => entries,
        },
      },
    },
    nowMs: 1000,
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}