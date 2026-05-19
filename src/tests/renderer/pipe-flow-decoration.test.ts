import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Graphics } from "pixi.js"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { createRegistryContract } from "@/registry"

const originalGetContext = HTMLCanvasElement.prototype.getContext
let createPipeFlowDecoration: typeof import("@/renderer/scene/decorations/PipeFlowDecoration")["createPipeFlowDecoration"]

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  createPipeFlowDecoration = (await import("@/renderer/scene/decorations/PipeFlowDecoration"))
    .createPipeFlowDecoration
})

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
})

describe("PipeFlowDecoration", () => {
  it("draws double chevrons only for pipe transport components that contain fluid", () => {
    const decoration = createPipeFlowDecoration()
    const pipeFluidItemIds = new Map<string, string | null>([
      ["pipe-a", null],
      ["pipe-b", null],
    ])
    const getPipeFluidItemId = vi.fn((entityId: string) => pipeFluidItemIds.get(entityId) ?? null)
    const ctx = createPipeFlowContext({ getPipeFluidItemId })

    decoration.sync(ctx as never)

    const arrowGraphics = decoration.container.children[0] as Graphics
    const arrowMask = decoration.container.children[1] as Graphics
    expect(decoration.container.visible).toBe(false)
    expect(arrowGraphics.context.instructions).toHaveLength(0)
    expect(arrowMask.context.instructions).toHaveLength(0)

    pipeFluidItemIds.set("pipe-a", "item_liquid_water")
    pipeFluidItemIds.set("pipe-b", "item_liquid_water")
    decoration.sync(ctx as never)

    expect(getPipeFluidItemId).toHaveBeenCalledWith("pipe-a")
    expect(getPipeFluidItemId).toHaveBeenCalledWith("pipe-b")
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
    expect(arrowGraphics.context.instructions).toHaveLength(2)
    expect(arrowMask.context.instructions).toHaveLength(2)

    pipeFluidItemIds.set("pipe-a", null)
    pipeFluidItemIds.set("pipe-b", null)
    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(false)
    expect(arrowGraphics.context.instructions).toHaveLength(0)
    expect(arrowMask.context.instructions).toHaveLength(0)

    decoration.destroy()
  })
})

function createPipeFlowContext(options: {
  getPipeFluidItemId: (entityId: string) => string | null;
}) {
  const registry = createRegistryContract()
  const entities = [
    {
      id: "pipe-a",
      definitionId: "pipe_straight_1x1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
    {
      id: "pipe-b",
      definitionId: "pipe_straight_1x1",
      position: { x: 1, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
  ]

  return {
    viewportState: {
      width: 400,
      height: 300,
      resolution: 1,
      centerX: 0,
      centerY: 0,
      gridCellPixelSize: 100,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    },
    renderHost: {
      workspace: {
        app: {
          state: {
            settings: {
              gameUseSimplifiedDeviceIcons: false,
            },
          },
        },
        editor: {
          state: {},
          queries: {
            listEntities: () => entities,
          },
        },
        registry,
        simulation: {
          queries: {
            getPipeFluidItemId: options.getPipeFluidItemId,
          },
        },
      },
    },
    theme: AYU_LIGHT_THEME,
    nowMs: 0,
  }
}