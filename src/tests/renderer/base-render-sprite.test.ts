import { describe, expect, it, vi } from "vitest"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/state/types"
import { BaseRenderSprite } from "@/renderer/sprites/base-render-sprite"
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

  class MockGraphics extends MockContainer {
    public readonly commands: Array<
      | { type: "clear" }
      | {
        type: "rect";
        x: number;
        y: number;
        width: number;
        height: number;
      }
      | {
        type: "stroke";
        options: {
          width: number;
          color: number;
        };
      }
    > = []

    public clear(): this {
      this.commands.push({ type: "clear" })
      return this
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.commands.push({ type: "rect", x, y, width, height })
      return this
    }

    public stroke(options: { width: number; color: number }): this {
      this.commands.push({ type: "stroke", options })
      return this
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  }
})

class OverlayRecordingSprite extends BaseRenderSprite {
  public readonly overlayCalls: Array<readonly string[]> = []

  public constructor(entityId: string) {
    super(entityId)
  }

  protected syncSpriteLayout(): void {}

  protected syncCollectionOverlay(collectionTypes: readonly string[]): void {
    this.overlayCalls.push([...collectionTypes])
  }
}

class DefaultOverlaySprite extends BaseRenderSprite {
  public constructor(entityId: string) {
    super(entityId)
  }

  protected syncSpriteLayout(): void {}

  public getEntityRootSnapshot(): { alpha: number; visible: boolean } {
    const root = this.getRootOfLayer("entity")

    return {
      alpha: root.alpha,
      visible: root.visible,
    }
  }

  public getOverlayCommands(): unknown[] {
    const overlayRoot = this.getExistingRootOfLayer("overlay")
    const graphics = overlayRoot?.children[0] as {
      commands?: unknown[];
    } | undefined

    return graphics?.commands ?? []
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

  it("applies the default ghost, preview, and selection overlays from one dispatch", () => {
    const sprite = new DefaultOverlaySprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.preview]: ["entity-1"],
      [EntityCollectionType.ghost]: ["entity-1"],
    }))

    expect(sprite.getEntityRootSnapshot()).toEqual({
      alpha: 0.2,
      visible: true,
    })
    expect(sprite.getOverlayCommands()).toMatchObject([
      {
        type: "rect",
        x: 12,
        y: 22,
        width: 32,
        height: 16,
      },
      {
        type: "stroke",
        options: {
          width: 4,
        },
      },
      {
        type: "rect",
        x: 11,
        y: 21,
        width: 34,
        height: 18,
      },
      {
        type: "stroke",
        options: {
          width: 2,
        },
      },
    ])
  })

  it("reuses the selection overlay for marquee without drawing it twice", () => {
    const sprite = new DefaultOverlaySprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.marquee]: ["entity-1"],
    }))

    expect(sprite.getOverlayCommands()).toMatchObject([
      {
        type: "rect",
        x: 11,
        y: 21,
        width: 34,
        height: 18,
      },
      {
        type: "stroke",
        options: {
          width: 2,
        },
      },
    ])
    expect(sprite.getOverlayCommands()).toHaveLength(2)
  })

  it("suppresses the selection overlay when reverse marquee is active", () => {
    const sprite = new DefaultOverlaySprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.reverseMarquee]: ["entity-1"],
    }))

    expect(sprite.getOverlayCommands()).toEqual([])
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
  }
}