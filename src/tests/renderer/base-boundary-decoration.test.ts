import { describe, expect, it, vi } from "vitest"

interface MockGraphicsSnapshot {
  readonly rectCommands: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly strokeCommands: unknown[];
  clearCount: number;
}

const graphicsInstances = vi.hoisted(() => [] as MockGraphicsSnapshot[])

vi.mock("pixi.js", () => {
  class MockGraphics implements MockGraphicsSnapshot {
    public readonly rectCommands: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = []
    public readonly strokeCommands: unknown[] = []
    public clearCount = 0
    public destroy = vi.fn()

    public constructor() {
      graphicsInstances.push(this)
    }

    public clear() {
      this.clearCount += 1
      this.rectCommands.length = 0
      this.strokeCommands.length = 0
      return this
    }

    public rect(
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      this.rectCommands.push({ x, y, width, height })
      return this
    }

    public stroke(style: unknown) {
      this.strokeCommands.push(style)
      return this
    }
  }

  return {
    BlurFilter: class {
      public strength = 0
      public destroy = vi.fn()
    },
    Graphics: MockGraphics,
  }
})

import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import {
  createBaseBoundaryDecoration,
  resolveBaseBoundaryGridRect,
  resolveBaseBoundaryStrokeWidth,
  resolveBaseOuterGridRect,
  resolveExpandedGridRect,
} from "@/renderer/scene/decorations/BaseBoundaryDecoration"
import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext"

describe("BaseBoundaryDecoration", () => {
  it("resolves the placeable area boundary without the outer ring", () => {
    const registry = createRegistryContract()
    const wuling = registry.baseDefinitions.find(
      (definition) => definition.id === "wuling_protocol_core",
    )
    const valleyShelter = registry.baseDefinitions.find(
      (definition) => definition.id === "valley4_refugee_shelter",
    )

    expect(wuling).toBeDefined()
    expect(valleyShelter).toBeDefined()

    if (wuling === undefined || valleyShelter === undefined) {
      throw new Error("Expected base definitions to exist.")
    }

    expect(resolveBaseBoundaryGridRect(wuling)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 80,
    })
    expect(resolveBaseBoundaryGridRect(valleyShelter)).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    })
  })

  it("resolves the full outer expansion rect from placeable area and outer ring", () => {
    const registry = createRegistryContract()
    const wuling = registry.baseDefinitions.find(
      (definition) => definition.id === "wuling_protocol_core",
    )
    const valleyShelter = registry.baseDefinitions.find(
      (definition) => definition.id === "valley4_refugee_shelter",
    )

    expect(wuling).toBeDefined()
    expect(valleyShelter).toBeDefined()

    if (wuling === undefined || valleyShelter === undefined) {
      throw new Error("Expected base definitions to exist.")
    }

    expect(resolveBaseOuterGridRect(wuling)).toEqual({
      x: -5,
      y: -5,
      width: 90,
      height: 90,
    })
    expect(resolveBaseOuterGridRect(valleyShelter)).toEqual({
      x: -5,
      y: -5,
      width: 50,
      height: 50,
    })
  })

  it("expands a grid rect symmetrically for the out-of-bounds warning ring", () => {
    expect(resolveExpandedGridRect({
      x: -5,
      y: -5,
      width: 90,
      height: 90,
    }, 2)).toEqual({
      x: -7,
      y: -7,
      width: 94,
      height: 94,
    })
  })

  it("draws the current base boundary in viewport pixels", () => {
    graphicsInstances.length = 0
    const decoration = createBaseBoundaryDecoration()
    const graphics = graphicsInstances[0]

    decoration.sync(createDecorationContext("wuling_protocol_core"))

    expect(graphics?.clearCount).toBe(1)
    expect(graphics?.rectCommands).toHaveLength(1)
    expect(graphics?.rectCommands[0]).toEqual({
      x: 100,
      y: 50,
      width: 800,
      height: 800,
    })
    expect(graphics?.strokeCommands[0]).toEqual({
      width: resolveBaseBoundaryStrokeWidth(10),
      color: 0xf2c94c,
      alpha: 0.95,
    })
  })

  it("clears without drawing when the current base is unknown", () => {
    graphicsInstances.length = 0
    const decoration = createBaseBoundaryDecoration()
    const graphics = graphicsInstances[0]

    decoration.sync(createDecorationContext("missing_base"))

    expect(graphics?.clearCount).toBe(1)
    expect(graphics?.rectCommands).toEqual([])
    expect(graphics?.strokeCommands).toEqual([])
  })
})

function createDecorationContext(baseId: string): DecorationSyncContext {
  const registry = createRegistryContract()
  const document = {
    ...createDummyWorldDocument(),
    baseId,
  }

  return {
    viewportState: {
      width: 200,
      height: 100,
      resolution: 1,
      centerX: 0,
      centerY: 0,
      gridCellPixelSize: 10,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    },
    workspace: {
      state: {} as never,
      registry,
      app: null,
      editor: {
        document: {
          getSnapshot: () => document,
          subscribe: () => () => undefined,
        },
      } as never,
      render: null,
      simulation: null,
    },
    nowMs: 0,
  }
}
