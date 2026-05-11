import { describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public visible = true

    public addChild<T>(child: T): T {
      this.children.push(child)
      return child
    }

    public destroy = vi.fn()
  }

  class MockSprite {
    public texture: unknown
    public visible = true
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public rotation = 0
    public roundPixels = false
    public tint = 0xffffff
    public alpha = 1
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

    public destroy = vi.fn()
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      type: "poly";
      points: number[];
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public visible = true

    public constructor(_options?: { roundPixels?: boolean }) {}

    public clear(): this {
      this.drawCommands.length = 0
      return this
    }

    public poly(points: number[]): this {
      this.drawCommands.push({
        type: "poly",
        points,
      })
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

    public destroy = vi.fn()
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

import { AYU_LIGHT_THEME } from "@/app/theme"
import { createRegistryContract } from "@/registry"
import {
  createBeltFlowDecoration,
  resolveBeltFlowMarks,
  resolveRepeatingLocalDistances,
} from "@/renderer/scene/decorations/BeltFlowDecoration"

describe("BeltFlowDecoration", () => {
  it("resolves arrow and highlight marks with path-continuous phase across belt tiles", () => {
    const marksAtStart = resolveBeltFlowMarks(createFlowContext({ nowMs: 0 }) as never)
    const marksAfterHalfSecond = resolveBeltFlowMarks(createFlowContext({ nowMs: 500 }) as never)

    expect(marksAtStart.map((mark) => mark.kind)).toEqual(["highlight", "arrow", "arrow"])
    expect(marksAtStart.map((mark) => mark.centerX)).toEqual([100, 100, 200])
    expect(marksAfterHalfSecond.map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "highlight", x: 150 },
      { kind: "arrow", x: 125 },
      { kind: "arrow", x: 225 },
    ])
  })

  it("draws textured highlights and solid belt-colored arrows", async () => {
    const decoration = createBeltFlowDecoration()
    const highlightTexture = { id: "highlight-texture" }
    const getTexture = vi.fn().mockResolvedValue(highlightTexture)
    decoration.sync(createFlowContext({ nowMs: 0, getTexture }) as never)

    expect(getTexture).toHaveBeenCalledWith("texture-belt-highlight-strip-texture")

    await flushMicrotasks()
    decoration.sync(createFlowContext({ nowMs: 0, getTexture }) as never)

    const highlightLayer = decoration.container.children[0] as { children: unknown[] }
    const highlight = highlightLayer.children[0] as {
      texture: unknown;
      width: number;
      height: number;
      tint: number;
      alpha: number;
    }
    const graphics = decoration.container.children[1] as unknown as {
      drawCommands: Array<{
        type: "poly";
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(decoration.container.visible).toBe(true)
    expect(highlight.texture).toBe(highlightTexture)
    expect(highlight.width).toBeCloseTo(56)
    expect(highlight.height).toBeCloseTo(78)
    expect(highlight.tint).toBe(0xd9822b)
    expect(highlight.alpha).toBeCloseTo(0.82)
    expect(graphics.drawCommands).toHaveLength(2)
    expect(graphics.drawCommands[0]?.fill).toMatchObject({
      color: 0xd9822b,
      alpha: 1,
    })
    expect(graphics.drawCommands[0]?.stroke).toBeUndefined()

    decoration.destroy()
  })

  it("hides in simplified display mode", () => {
    const decoration = createBeltFlowDecoration()
    decoration.sync(createFlowContext({ nowMs: 0 }) as never)

    const graphics = decoration.container.children[1] as unknown as {
      drawCommands: Array<unknown>;
    }

    decoration.sync(createFlowContext({
      nowMs: 0,
      simplifiedDeviceIcons: true,
    }) as never)

    expect(decoration.container.visible).toBe(false)
    expect(graphics.drawCommands).toHaveLength(0)

    decoration.destroy()
  })

  it("keeps repeated local distances inside the path span", () => {
    expect(resolveRepeatingLocalDistances({
      phaseOffsetCells: 1,
      pathLengthCells: 1,
      spacingCells: 1,
      speedCellsPerSecond: 0.5,
      nowMs: 500,
    })).toEqual([0.25])
    expect(resolveRepeatingLocalDistances({
      phaseOffsetCells: 1,
      pathLengthCells: 1,
      spacingCells: 2,
      speedCellsPerSecond: 1,
      nowMs: 0,
    })).toEqual([])
  })
})

function createFlowContext(options: {
  nowMs: number;
  simplifiedDeviceIcons?: boolean;
  getTexture?: (key: string) => Promise<unknown>;
}) {
  const registry = createRegistryContract()

  return {
    viewportState: {
      width: 400,
      height: 200,
      resolution: 1,
      centerX: 1,
      centerY: 0.5,
      gridCellPixelSize: 100,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    },
    workspace: {
      app: {
        state: {
          theme: AYU_LIGHT_THEME,
          settings: {
            gameUseSimplifiedDeviceIcons: options.simplifiedDeviceIcons ?? false,
          },
        },
      },
      registry: {
        entityDefinitions: registry.entityDefinitions,
      },
      render: options.getTexture === undefined
        ? null
        : {
          textureManager: {
            getTexture: options.getTexture,
          },
        },
      editor: {
        queries: {
          listEntities: () => [
            {
              id: "belt-a",
              definitionId: "belt_straight_1x1",
              position: { x: 0, y: 0 },
              rotation: 0,
              config: {},
              tags: [],
            },
            {
              id: "belt-b",
              definitionId: "belt_straight_1x1",
              position: { x: 1, y: 0 },
              rotation: 0,
              config: {},
              tags: [],
            },
          ],
        },
      },
    },
    nowMs: options.nowMs,
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}
