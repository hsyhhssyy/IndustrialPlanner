import { describe, expect, it, vi } from "vitest"

interface MockGraphicsSnapshot {
  readonly rectCommands: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly strokeCommands: unknown[];
  readonly roundRectCommands: Array<{ x: number; y: number; width: number; height: number }>;
  readonly children: MockTextSnapshot[];
  clearCount: number;
}

interface MockTextSnapshot {
  text: string;
  visible: boolean;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
}

const graphicsInstances = vi.hoisted(() => [] as MockGraphicsSnapshot[])

vi.mock("pixi.js", () => {
  class MockText implements MockTextSnapshot {
    public text: string
    public visible = true
    public x = 0
    public y = 0
    public roundPixels = false
    public eventMode = "none"
    public resolution = 1
    public readonly height = 18
    public readonly position = { set: (x: number, y: number) => { this.x = x; this.y = y } }
    public destroy = vi.fn()
    public constructor(options: { text: string }) { this.text = options.text }
    public get width() { return this.text.length * 14 }
  }

  class MockGraphics implements MockGraphicsSnapshot {
    public readonly rectCommands: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = []
    public readonly strokeCommands: unknown[] = []
    public readonly roundRectCommands: Array<{ x: number; y: number; width: number; height: number }> = []
    public readonly children: MockTextSnapshot[] = []
    public clearCount = 0
    public destroy = vi.fn()

    public constructor() {
      graphicsInstances.push(this)
    }

    public clear() {
      this.clearCount += 1
      this.rectCommands.length = 0
      this.strokeCommands.length = 0
      this.roundRectCommands.length = 0
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

    public addChild(text: MockTextSnapshot) { this.children.push(text); return text }
    public roundRect(x: number, y: number, width: number, height: number) {
      this.roundRectCommands.push({ x, y, width, height })
      return this
    }
    public fill() { return this }
  }

  return {
    BlurFilter: class {
      public strength = 0
      public destroy = vi.fn()
    },
    Graphics: MockGraphics,
    Text: MockText,
  }
})

import { createDummyWorldDocument } from "@/tests/helpers/dummy-document"
import { AYU_LIGHT_THEME } from "@/app/theme"
import { createRegistryContract } from "@/registry"
import {
  createBaseBoundaryDecoration,
  resolveBaseBoundaryGridRect,
  resolveBaseBoundaryGridRects,
  resolveBaseBoundaryStrokeWidth,
  resolveBaseOuterGridRect,
  resolveBaseOuterGridRects,
  resolveExpandedGridRect,
} from "@/renderer/scene/decorations/BaseBoundaryDecoration"
import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext"

describe("BaseBoundaryDecoration", () => {
  it("draws both agricultural nameplates above their outer warning rings and follows viewport changes", () => {
    graphicsInstances.length = 0
    const decoration = createBaseBoundaryDecoration()
    const graphics = graphicsInstances[0]!
    const ctx = createDecorationContext("wuling_agricultural_land")
    ctx.viewportBounds.width = 1000
    ctx.viewportBounds.height = 600
    ctx.viewportState.centerX = 35
    ctx.viewportState.centerY = 10

    decoration.sync(ctx)
    expect(graphics.rectCommands).toHaveLength(2)
    expect(graphics.children.map((text) => text.text)).toEqual(["武陵农用地", "缘缘庄"])
    expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-50, 990])
    for (const plate of graphics.roundRectCommands) {
      expect(plate.y + plate.height).toBeLessThan(80)
    }
    expect(graphics.children.every((text) => text.visible)).toBe(true)

    decoration.sync(ctx)
    expect(graphics.clearCount).toBe(1)
    ctx.viewportState.centerX += 2
    decoration.sync(ctx)
    expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-70, 970])
    expect(graphics.children).toHaveLength(2)

    ctx.viewportState.displayRotation = 90
    decoration.sync(ctx)
    expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-40, 20])
    expect(graphics.roundRectCommands[1]!.y - graphics.roundRectCommands[0]!.y).toBe(1040)
    decoration.destroy()
    expect((graphics as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy)
      .toHaveBeenCalledWith({ children: true })
  })

  it("hides agricultural nameplates when switching to a base without names or an unknown base", () => {
    graphicsInstances.length = 0
    const decoration = createBaseBoundaryDecoration()
    const graphics = graphicsInstances[0]!
    decoration.sync(createDecorationContext("wuling_agricultural_land"))
    decoration.sync(createDecorationContext("wuling_protocol_core"))
    expect(graphics.roundRectCommands).toEqual([])
    expect(graphics.children.every((text) => !text.visible)).toBe(true)
    decoration.sync(createDecorationContext("wuling_agricultural_land"))
    expect(graphics.children.every((text) => text.visible)).toBe(true)
    decoration.sync(createDecorationContext("missing_base"))
    expect(graphics.roundRectCommands).toEqual([])
    expect(graphics.children.every((text) => !text.visible)).toBe(true)
    decoration.destroy()
  })

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
      x: -10,
      y: -10,
      width: 100,
      height: 100,
    })
    expect(resolveBaseOuterGridRect(valleyShelter)).toEqual({
      x: -5,
      y: -5,
      width: 50,
      height: 50,
    })
  })

  it("draws only the draft box main boundaries", () => {
    const draftBox = createRegistryContract().baseDefinitions.find(
      (definition) => definition.id === "draft_box",
    )!
    // 当前零核心分区以 (-60, -60) 为原点，四侧各扩展 20 格；与 Registry 和 base-areas 契约一致。
    // AI-CORRECTION 2026-09-28: 用户要求移除该分区，现在仅绘制主区域及其外环。
    expect(resolveBaseBoundaryGridRects(draftBox)).toEqual([
      { x: 0, y: 0, width: 320, height: 320 },
      // AI-REMOVED 2026-09-28:
      // Reason: 草稿箱取消左上角独立外环区。
      // Trigger: 用户要求删除该区域并更新对应测试。
      // Evidence: draft_box 改为仅保留主区域。
      // Replacement: 当前数组仅保留主区域矩形。
      // Risk: 原独立区域内已有设备将判定为越界。
      // Human Review: Required
      // Original code:
      // { x: -80, y: -80, width: 40, height: 40 },
    ])
    expect(resolveBaseOuterGridRects(draftBox)).toEqual([
      { x: -20, y: -20, width: 360, height: 360 },
      // AI-REMOVED 2026-09-28:
      // Reason: 草稿箱取消左上角独立外环区。
      // Trigger: 用户要求删除该区域并更新对应测试。
      // Evidence: draft_box 改为仅保留主区域。
      // Replacement: 当前数组仅保留主区域矩形。
      // Risk: 原独立区域内已有设备将判定为越界。
      // Human Review: Required
      // Original code:
      // { x: -80, y: -80, width: 40, height: 40 },
    ])
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
      displayRotation: 0,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    },
    theme: AYU_LIGHT_THEME,
    renderHost: {
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
      } as never,
      textureManager: {
        getTexture: (async () => ({ width: 32, height: 32 })) as never,
      } as never,
    } as never,
    nowMs: 0,
  }
}
