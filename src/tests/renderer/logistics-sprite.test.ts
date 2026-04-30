import { describe, expect, it, vi } from "vitest"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/state/types"
import { LogisticsSprite } from "@/renderer/sprites/logistics-sprite"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import type { RenderLayerMap, RenderSpriteLayout, RenderSpriteSyncContext } from "@/renderer/sprites/render-sprite"

const pixiMocks = vi.hoisted(() => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public alpha = 1
    public visible = true
    public rotation = 0
    public readonly pivot = createPoint()
    public readonly position = createPoint()

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    }

    public removeChild(child: unknown): void {
      const index = this.children.indexOf(child)
      if (index >= 0) {
        this.children.splice(index, 1)
      }
    }

    public destroy(): void {}
  }

  function createPoint() {
    return {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x
        this.y = y
      },
    }
  }

  class MockGraphics extends MockContainer {
    public readonly commands: string[] = []

    public clear(): this {
      this.commands.push("clear")
      return this
    }

    public roundRect(): this {
      this.commands.push("roundRect")
      return this
    }

    public rect(): this {
      this.commands.push("rect")
      return this
    }

    public fill(): this {
      this.commands.push("fill")
      return this
    }

    public stroke(): this {
      this.commands.push("stroke")
      return this
    }

    public poly(): this {
      this.commands.push("poly")
      return this
    }

    public moveTo(): this {
      this.commands.push("moveTo")
      return this
    }

    public quadraticCurveTo(): this {
      this.commands.push("quadraticCurveTo")
      return this
    }
  }

  return {
    MockContainer,
    MockGraphics,
  }
})

vi.mock("pixi.js", () => ({
  Container: pixiMocks.MockContainer,
  Graphics: pixiMocks.MockGraphics,
}))

describe("LogisticsSprite", () => {
  it("draws invalid preview and logistics head overlays for the head draft", () => {
    const sprite = new LogisticsSprite("draft-head", "belt_straight_1x1")
    const layers = createLayers()

    sprite.attach(layers)
    sprite.syncLayout(createLayout(), createContext({
      previewIds: ["draft-head"],
      logisticsHeadIds: ["draft-head"],
      canApply: false,
    }))

    const overlayRoot = layers.overlay.children[0] as InstanceType<typeof pixiMocks.MockContainer> | undefined
    const overlayGraphics = overlayRoot?.children as Array<InstanceType<typeof pixiMocks.MockGraphics>> | undefined

    expect(overlayGraphics).toHaveLength(2)
    expect(overlayGraphics?.[0]?.commands).toContain("fill")
    expect(overlayGraphics?.[0]?.commands).toContain("stroke")
    expect(overlayGraphics?.[1]?.commands).toContain("stroke")
  })

  it("rotates the logistics arrow around the tile center", () => {
    const sprite = new LogisticsSprite("draft-head", "belt_turn_cw_1x1")
    const layers = createLayers()

    sprite.attach(layers)
    sprite.syncLayout({
      ...createLayout(),
      rotation: 90,
    }, createContext({
      previewIds: [],
      logisticsHeadIds: [],
      canApply: true,
    }))

    const entityRoot = layers.entity.children[0] as InstanceType<typeof pixiMocks.MockContainer> | undefined
    const arrow = entityRoot?.children[1] as InstanceType<typeof pixiMocks.MockGraphics> | undefined

    expect(arrow?.rotation).toBeCloseTo(Math.PI / 2)
    expect(arrow?.pivot).toMatchObject({ x: 26, y: 36 })
    expect(arrow?.position).toMatchObject({ x: 26, y: 36 })
  })
})

function createLayers(): RenderLayerMap {
  return {
    background: new pixiMocks.MockContainer() as never,
    entity: new pixiMocks.MockContainer() as never,
    overlay: new pixiMocks.MockContainer() as never,
  }
}

function createLayout(): RenderSpriteLayout {
  return {
    x: 10,
    y: 20,
    width: 32,
    height: 32,
    rotation: 0,
  }
}

function createContext(options: {
  previewIds: readonly string[]
  logisticsHeadIds: readonly string[]
  canApply: boolean
}): RenderSpriteSyncContext {
  const createCollection = (entityIds: readonly string[]) => ({
    contains: (entityId: string) => entityIds.includes(entityId),
  })

  return {
    theme: AYU_LIGHT_THEME,
    workspace: {
      editor: {
        state: {
          viewport: {
            gridSize: 1,
            gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
          },
          collections: {
            [EntityCollectionType.selection]: createCollection([]),
            [EntityCollectionType.marquee]: createCollection([]),
            [EntityCollectionType.reverseMarquee]: createCollection([]),
            [EntityCollectionType.preview]: createCollection(options.previewIds),
            [EntityCollectionType.ghost]: createCollection([]),
            [EntityCollectionType.logisticsHead]: createCollection(options.logisticsHeadIds),
          },
        },
        queries: {
          resolveLogisticsDraftState: () => ({
            kind: "belt",
            source: null,
            target: null,
            routeOrder: "vertical-first",
            cells: [],
            headDraftEntityId: "draft-head",
            replacingEntityId: null,
            canApply: options.canApply,
            invalidReason: options.canApply ? null : "overlap-existing-logistics",
          }),
        },
      },
    } as never,
    time: {
      nowMs: 1000,
      deltaMs: 16.67,
    },
  }
}
