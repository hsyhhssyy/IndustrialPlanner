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
  it("resolves arrow and light marks with path-continuous phase across belt tiles", () => {
    const marksAtStart = resolveBeltFlowMarks(createFlowContext({ nowMs: 0 }) as never)
    const marksAfterHalfSecond = resolveBeltFlowMarks(createFlowContext({ nowMs: 500 }) as never)

    expect(marksAtStart.map((mark) => mark.kind)).toEqual(["light", "arrow", "arrow"])
    expect(marksAtStart.map((mark) => mark.centerX)).toEqual([100, 100, 200])
    expect(marksAfterHalfSecond.map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "light", x: 150 },
      { kind: "arrow", x: 125 },
      { kind: "arrow", x: 225 },
    ])
  })

  it("draws lights before arrows and hides in simplified display mode", () => {
    const decoration = createBeltFlowDecoration()
    decoration.sync(createFlowContext({ nowMs: 0 }) as never)

    const graphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<{
        type: "poly";
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(decoration.container.visible).toBe(true)
    expect(graphics.drawCommands).toHaveLength(3)
    expect(graphics.drawCommands[0]?.fill).toMatchObject({
      color: 0xffffff,
      alpha: 0.72,
    })
    expect(graphics.drawCommands[1]?.stroke).toMatchObject({
      color: 0x555555,
      pixelLine: true,
    })

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
