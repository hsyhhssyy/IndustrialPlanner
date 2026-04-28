import { describe, expect, it, vi } from "vitest"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/state/types"
import { BaseRenderSprite } from "@/renderer/sprites/base-render-sprite"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "@/renderer/sprites/render-sprite"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public alpha = 1
    public visible = true

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

      if (child && typeof child === "object" && "parent" in child) {
        (child as { parent: MockContainer | null }).parent = null
      }
    }

    public destroy(options?: { children?: boolean }): void {
      if (options?.children) {
        for (const child of this.children) {
          if (child && typeof child === "object" && "parent" in child) {
            (child as { parent: MockContainer | null }).parent = null
          }
        }
      }

      this.children.length = 0
      this.parent = null
    }
  }

  return {
    Container: MockContainer,
  }
})

class OverlayRecordingSprite extends BaseRenderSprite {
  public readonly overlayCalls: Array<readonly string[]> = []

  public constructor(entityId: string) {
    super(entityId)
  }

  protected syncSpriteLayout(): void {}

  protected resetCollectionOverlay(): void {}

  protected drawGhostOverlay(): void {}

  protected drawPreviewOverlay(): void {}

  protected drawSelectionOverlay(): void {}

  protected syncCollectionOverlay(collectionTypes: readonly string[]): void {
    this.overlayCalls.push([...collectionTypes])
  }
}

describe("BaseRenderSprite", () => {
  it("calls the overlay hook once with the active collection types in sync order", () => {
    const sprite = new OverlayRecordingSprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.marquee]: ["entity-1"],
      [EntityCollectionType.reverseMarquee]: ["entity-1"],
      [EntityCollectionType.preview]: [],
      [EntityCollectionType.ghost]: ["entity-1"],
    }))

    expect(sprite.overlayCalls).toEqual([
      [
        EntityCollectionType.ghost,
        EntityCollectionType.marquee,
        EntityCollectionType.reverseMarquee,
        EntityCollectionType.selection,
      ],
    ])
  })
})

function createLayout(): RenderSpriteLayout {
  return {
    x: 10,
    y: 20,
    width: 36,
    height: 20,
    rotation: 0,
  }
}

function createContext(collections: Partial<Record<string, readonly string[]>>): RenderSpriteSyncContext {
  const contains = (collectionType: string) => (entityId: string) =>
    collections[collectionType]?.includes(entityId) ?? false

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
            [EntityCollectionType.selection]: {
              contains: contains(EntityCollectionType.selection),
            },
            [EntityCollectionType.marquee]: {
              contains: contains(EntityCollectionType.marquee),
            },
            [EntityCollectionType.reverseMarquee]: {
              contains: contains(EntityCollectionType.reverseMarquee),
            },
            [EntityCollectionType.preview]: {
              contains: contains(EntityCollectionType.preview),
            },
            [EntityCollectionType.ghost]: {
              contains: contains(EntityCollectionType.ghost),
            },
          },
        },
      },
    } as never,
    time: {
      nowMs: 1000,
      deltaMs: 16.67,
    },
  }
}