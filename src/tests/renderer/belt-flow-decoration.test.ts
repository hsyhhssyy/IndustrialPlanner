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
  it("resolves only arrow marks with path-continuous phase across belt tiles", () => {
    const marksAtStart = resolveBeltFlowMarks(createFlowContext({ nowMs: 0 }) as never)
    const marksAfterHalfSecond = resolveBeltFlowMarks(createFlowContext({ nowMs: 500 }) as never)

    expect(marksAtStart.filter((mark) => mark.kind === "highlight")).toEqual([])
    expect(marksAtStart.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "arrow", x: 100 },
      { kind: "arrow", x: 200 },
      { kind: "arrow", x: 300 },
    ])
    expect(marksAfterHalfSecond.filter((mark) => mark.kind === "highlight")).toEqual([])
    expect(marksAfterHalfSecond.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
    }))).toEqual([
      { kind: "arrow", x: 125 },
      { kind: "arrow", x: 225 },
    ])
  })

  it("draws only solid belt-colored arrows after removing highlight ribbons", async () => {
    const decoration = createBeltFlowDecoration()
    const highlightTexture = { id: "highlight-texture" }
    const getTexture = vi.fn().mockResolvedValue(highlightTexture)
    decoration.sync(createFlowContext({ nowMs: 0, getTexture }) as never)

    expect(getTexture).not.toHaveBeenCalled()

    await flushMicrotasks()
    decoration.sync(createFlowContext({ nowMs: 0, getTexture }) as never)

    const highlightLayer = decoration.container.children[0] as {
      children: unknown[];
      visible: boolean;
    }
    const graphics = decoration.container.children[2] as unknown as {
      drawCommands: Array<{
        type: "poly";
        points?: number[];
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    const arrowMask = decoration.container.children[3] as unknown as {
      drawCommands: Array<{
        type: "poly" | "rect";
      }>;
    }
    expect(decoration.container.visible).toBe(true)
    expect(highlightLayer.visible).toBe(false)
    expect(highlightLayer.children).toHaveLength(0)
    expect(graphics.drawCommands).toHaveLength(3)
    expect(arrowMask.drawCommands).toHaveLength(2)
    expect(graphics.drawCommands[0]?.points?.map((value) => Number(value.toFixed(2)))).toEqual([
      114,
      100,
      86,
      88,
      91.04,
      100,
      86,
      112,
    ])
    expect(graphics.drawCommands[0]?.fill).toMatchObject({
      color: 0xd9822b,
      alpha: 1,
    })
    expect(graphics.drawCommands[0]?.stroke).toBeUndefined()

    decoration.destroy()
  })

  it("keeps chain-end arrows alive while the mask still contains part of the arrow", () => {
    const emptyEndMarks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 250,
      entities: [createEntity("belt-a", "belt_straight_1x1", { x: 0, y: 0 })],
    }) as never)
    const admissionEndMarks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 500,
      entities: [
        createEntity("belt-a", "belt_straight_1x1", { x: 0, y: 0 }),
        createEntity("target-admission", "item_log_admission", { x: 1, y: 0 }),
      ],
    }) as never)
    const generalLogisticsEndMarks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 250,
      entities: [
        createEntity("belt-a", "belt_straight_1x1", { x: 0, y: 0 }),
        createEntity("target-connector", "item_log_connector", { x: 1, y: 0 }),
      ],
    }) as never)

    expect(emptyEndMarks.filter((mark) => mark.kind === "arrow").map((mark) =>
      Number(mark.centerX.toFixed(1)),
    )).toEqual([112.5, 212.5])
    expect(admissionEndMarks.filter((mark) => mark.kind === "arrow").map((mark) =>
      Number(mark.centerX.toFixed(1)),
    )).toEqual([125, 225])
    expect(generalLogisticsEndMarks.filter((mark) => mark.kind === "arrow").map((mark) =>
      Number(mark.centerX.toFixed(1)),
    )).toEqual([112.5, 212.5])
  })

  it("extends the arrow mask into device insertion segments but not into general logistics devices", () => {
    const admissionDecoration = createBeltFlowDecoration()
    admissionDecoration.sync(createFlowContext({
      nowMs: 0,
      entities: [
        {
          id: "belt-a",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "target-admission",
          definitionId: "item_log_admission",
          position: { x: 1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    }) as never)

    const admissionMask = admissionDecoration.container.children[3] as unknown as {
      drawCommands: Array<{
        type: "poly" | "rect";
        points?: number[];
      }>;
    }
    expect(admissionMask.drawCommands).toHaveLength(2)
    expect(admissionMask.drawCommands[1]).toMatchObject({
      type: "poly",
      points: [200, 50, 220, 50, 220, 150, 200, 150],
    })
    admissionDecoration.destroy()

    const logisticsDecoration = createBeltFlowDecoration()
    logisticsDecoration.sync(createFlowContext({
      nowMs: 0,
      entities: [
        {
          id: "belt-a",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "target-connector",
          definitionId: "item_log_connector",
          position: { x: 1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    }) as never)

    const logisticsMask = logisticsDecoration.container.children[3] as unknown as {
      drawCommands: Array<{
        type: "poly" | "rect";
      }>;
    }
    expect(logisticsMask.drawCommands).toHaveLength(1)
    expect(logisticsMask.drawCommands[0]).toMatchObject({
      type: "rect",
    })
    logisticsDecoration.destroy()
  })

  it("uses the current belt collection tint for arrows", () => {
    const marks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 0,
      selectionIds: ["belt-a", "other-entity"],
    }) as never)
    const selectionTint = resolveAppThemeColorNumber(
      AYU_LIGHT_THEME,
      AYU_LIGHT_THEME.renderer.worldPreviewRectFillColorKey,
    )

    expect(marks.filter((mark) => mark.kind === "highlight")).toEqual([])
    expect(marks.filter((mark) => mark.kind === "arrow").map((mark) => ({
      kind: mark.kind,
      x: Math.round(mark.centerX),
      tint: mark.tint,
    }))).toEqual([
      { kind: "arrow", x: 100, tint: selectionTint },
      { kind: "arrow", x: 200, tint: 0xd9822b },
      { kind: "arrow", x: 300, tint: 0xd9822b },
    ])
  })

  it("skips highlight ribbons on turn belts while keeping flow arrows", () => {
    const marks = resolveBeltFlowMarks(createFlowContext({
      nowMs: 0,
      entities: [
        {
          id: "belt-turn",
          definitionId: "belt_turn_cw_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    }) as never)

    expect(marks.some((mark) => mark.kind === "highlight")).toBe(false)
    expect(marks.some((mark) => mark.kind === "arrow")).toBe(true)
  })

  it("hides in simplified display mode", () => {
    const decoration = createBeltFlowDecoration()
    decoration.sync(createFlowContext({ nowMs: 0 }) as never)

    const graphics = decoration.container.children[2] as unknown as {
      drawCommands: Array<unknown>;
    }
    const arrowMask = decoration.container.children[3] as unknown as {
      drawCommands: Array<unknown>;
    }

    decoration.sync(createFlowContext({
      nowMs: 0,
      simplifiedDeviceIcons: true,
    }) as never)

    expect(decoration.container.visible).toBe(false)
    expect(graphics.drawCommands).toHaveLength(0)
    expect(arrowMask.drawCommands).toHaveLength(0)

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
    expect(resolveRepeatingLocalDistances({
      phaseOffsetCells: 0,
      pathLengthCells: 1,
      spacingCells: 1,
      speedCellsPerSecond: 0,
      nowMs: 0,
      endOverflowCells: 0.14,
    })).toEqual([0, 1])
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
  entities?: Array<{
    id: string;
    definitionId: string;
    position: { x: number; y: number };
    rotation: number;
    config: Record<string, never>;
    tags: string[];
  }>;
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
    theme: AYU_LIGHT_THEME,
    renderHost: {
      workspace: {
        state: {} as never,
        app: {
          state: {
            theme: AYU_LIGHT_THEME,
            settings: {
              gameUseSimplifiedDeviceIcons: options.simplifiedDeviceIcons ?? false,
            },
          },
        },
        registry: {
          ...registry,
        },
        render: {},
        simulation: null,
        editor: {
          state: {
            collections: {
              [EntityCollectionType.selection]: createCollectionStub(options.selectionIds ?? []),
            },
          },
          queries: {
            listEntities: () => options.entities ?? [
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
      } as never,
      textureManager: {
        getTexture: options.getTexture ?? (async () => ({ width: 32, height: 32 })),
      } as never,
    } as never,
    nowMs: options.nowMs,
  }
}

function createEntity(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
) {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
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
