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

  class MockRopeGeometry {
    public points: Array<{ x: number; y: number }>
    public width: number
    public textureScale: number

    public constructor(options: {
      points: Array<{ x: number; y: number }>;
      width: number;
      textureScale?: number;
    }) {
      this.points = options.points
      this.width = options.width
      this.textureScale = options.textureScale ?? 0
    }

    public destroy = vi.fn()
  }

  class MockMesh {
    public texture: unknown
    public geometry: MockRopeGeometry
    public visible = true
    public tint = 0xffffff
    public alpha = 1
    public roundPixels = false

    public constructor(options: {
      texture: unknown;
      geometry: MockRopeGeometry;
      roundPixels?: boolean;
    }) {
      this.texture = options.texture
      this.geometry = options.geometry
      this.roundPixels = options.roundPixels ?? false
    }

    public destroy = vi.fn()
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      type: "poly" | "rect";
      points?: number[];
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public visible = true

    public constructor(_options?: { roundPixels?: boolean }) {}

    public clear(): this {
      this.drawCommands.length = 0
      return this
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({
        type: "rect",
        x,
        y,
        width,
        height,
      })
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
    Mesh: MockMesh,
    RopeGeometry: MockRopeGeometry,
    Sprite: MockSprite,
    Texture: {
      EMPTY: { id: "empty-texture" },
    },
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import { createRegistryContract } from "@/registry"
import {
  createBeltFlowDecoration,
  resolveBeltFlowMarks,
  resolveRepeatingLocalDistances,
  resolveRepeatingLocalIntervals,
} from "@/renderer/scene/decorations/BeltFlowDecoration"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

describe("BeltFlowDecoration", () => {
  it("resolves arrow and highlight marks with path-continuous phase across belt tiles", () => {
    const marksAtStart = resolveBeltFlowMarks(createFlowContext({ nowMs: 0 }) as never)
    const marksAfterHalfSecond = resolveBeltFlowMarks(createFlowContext({ nowMs: 500 }) as never)

    expect(marksAtStart.filter((mark) => mark.kind === "highlight").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
      length: mark.lengthCells,
    }))).toEqual([
      { kind: "highlight", x: 150, length: 1 },
      { kind: "highlight", x: 250, length: 1 },
    ])
    expect(marksAtStart.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "arrow", x: 100 },
      { kind: "arrow", x: 200 },
    ])
    expect(marksAfterHalfSecond.filter((mark) => mark.kind === "highlight").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
      length: mark.lengthCells,
    }))).toEqual([
      { kind: "highlight", x: 175, length: 1.5 },
      { kind: "highlight", x: 275, length: 0.5 },
    ])
    expect(marksAfterHalfSecond.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "arrow", x: 125 },
      { kind: "arrow", x: 225 },
    ])
  })

  it("draws textured highlight paths and solid belt-colored arrows", async () => {
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
      geometry: {
        points: Array<{ x: number; y: number }>;
        width: number;
        textureScale: number;
      };
      tint: number;
      alpha: number;
    }
    const graphics = decoration.container.children[2] as unknown as {
      drawCommands: Array<{
        type: "poly";
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(decoration.container.visible).toBe(true)
    expect(highlight.texture).toBe(highlightTexture)
    expect(highlight.geometry.points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
    expect(highlight.geometry.width).toBeCloseTo(78)
    expect(highlight.geometry.textureScale).toBeCloseTo(2 / 0.78)
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

  it("uses the current belt collection tint for highlights and arrows", () => {
    const marks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 0,
      selectionIds: ["belt-a", "other-entity"],
    }) as never)
    const selectionTint = resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.worldPreviewRectFillColorKey,
    )

    expect(marks.filter((mark) => mark.kind === "highlight").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
      tint: mark.tint,
    }))).toEqual([
      { kind: "highlight", x: 150, tint: selectionTint },
      { kind: "highlight", x: 250, tint: 0xd9822b },
    ])
    expect(marks.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
      tint: mark.tint,
    }))).toEqual([
      { kind: "arrow", x: 100, tint: selectionTint },
      { kind: "arrow", x: 200, tint: 0xd9822b },
    ])
  })

  it("hides in simplified display mode", () => {
    const decoration = createBeltFlowDecoration()
    decoration.sync(createFlowContext({ nowMs: 0 }) as never)

    const graphics = decoration.container.children[2] as unknown as {
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

  it("clips repeated highlight intervals to each belt tile span", () => {
    expect(resolveRepeatingLocalIntervals({
      phaseOffsetCells: 0,
      pathLengthCells: 1,
      spacingCells: 2,
      lengthCells: 2,
      speedCellsPerSecond: 1,
      nowMs: 0,
    })).toEqual([{
      startCells: 0,
      endCells: 1,
    }])
    expect(resolveRepeatingLocalIntervals({
      phaseOffsetCells: 1,
      pathLengthCells: 1,
      spacingCells: 2,
      lengthCells: 2,
      speedCellsPerSecond: 1,
      nowMs: 500,
    })).toEqual([
      {
        startCells: 0,
        endCells: 0.5,
      },
      {
        startCells: 0.5,
        endCells: 1,
      },
    ])
  })
})

function createFlowContext(options: {
  nowMs: number;
  simplifiedDeviceIcons?: boolean;
  getTexture?: (key: string) => Promise<unknown>;
  selectionIds?: readonly string[];
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
        state: {
          collections: {
            [EntityCollectionType.selection]: createCollectionStub(options.selectionIds ?? []),
          },
        },
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

function createCollectionStub(ids: readonly string[]) {
  return {
    length: ids.length,
    contains: (entityId: string) => ids.includes(entityId),
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}
