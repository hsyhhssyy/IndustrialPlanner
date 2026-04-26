import { describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: {
      removeChild: (child: MockContainer) => void;
    } | null = null
    public alpha = 1
    public visible = true

    public addChild<T extends { parent: unknown }>(child: T): T {
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
        (child as { parent: unknown }).parent = null
      }
    }

    public destroy(): void {
      this.children.length = 0
      this.parent = null
    }
  }

  class MockSprite {
    public static instances: MockSprite[] = []
    public readonly anchor = {
      set: vi.fn(),
    }
    public parent: {
      removeChild: (child: MockSprite) => void;
    } | null = null
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public rotation = 0
    public roundPixels = false
    public visible = true
    private currentTexture: unknown

    public constructor(texture: unknown) {
      this.currentTexture = texture
      MockSprite.instances.push(this)
    }

    public destroy(): void {}

    public get texture(): unknown {
      return this.currentTexture
    }

    public set texture(value: unknown) {
      this.currentTexture = value
    }
  }

  class MockTexture {
    public static readonly EMPTY = { id: "empty-texture" }
  }

  class MockGraphics extends MockContainer {
    public clear(): this {
      return this
    }

    public rect(): this {
      return this
    }

    public stroke(): this {
      return this
    }
  }

  return {
    Assets: {
      load: loadTexture,
    },
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    Texture: MockTexture,
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"
import { GenericDeviceSprite } from "@/renderer/sprites/generic-device-sprite"

interface RenderedSpriteSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  roundPixels: boolean;
  visible: boolean;
  texture: unknown;
}

describe("GenericDeviceSprite", () => {
  it("loads the sprite texture before making the device visible", async () => {
    const resolvedTexture = { id: "device-texture" }
    loadTexture.mockResolvedValueOnce(resolvedTexture)

    const entityLayer = {
      addChild: vi.fn((child: {
        parent: unknown;
      }) => {
        child.parent = entityLayer
      }),
      removeChild: vi.fn((child: {
        parent: unknown;
      }) => {
        child.parent = null
      }),
    }
    const sprite = new GenericDeviceSprite(
      "dummy-entity-1",
      "/sprites/item_port_storager_1.webp",
    )

    sprite.attach({
      background: {} as never,
      entity: entityLayer as never,
      overlay: {} as never,
    })
    sprite.syncLayout({
      x: 16,
      y: 24,
      width: 48,
      height: 32,
      rotation: 90,
    }, {
      theme: AYU_LIGHT_THEME,
      workspace: {
        editor: null,
      } as never,
    })

    expect(loadTexture).toHaveBeenCalledWith("/sprites/item_port_storager_1.webp")

    await flushMicrotasks()

    const entityRoot = entityLayer.addChild.mock.calls[0]?.[0] as {
      children?: unknown[];
    } | undefined

    expect(entityRoot).toBeDefined()

    if (!entityRoot) {
      throw new Error("Expected GenericDeviceSprite to attach an entity root container.")
    }

    const renderedSprite = entityRoot.children?.[0]

    expect(renderedSprite).toBeDefined()

    if (!renderedSprite) {
      throw new Error("Expected GenericDeviceSprite to attach a Pixi sprite.")
    }

    const attachedSprite = renderedSprite as unknown as RenderedSpriteSnapshot

    expect(attachedSprite.texture).toBe(resolvedTexture)
    expect(attachedSprite.visible).toBe(true)
    expect(attachedSprite.roundPixels).toBe(true)
    expect(attachedSprite.x).toBe(40)
    expect(attachedSprite.y).toBe(40)
    expect(attachedSprite.width).toBe(32)
    expect(attachedSprite.height).toBe(48)
    expect(attachedSprite.rotation).toBeCloseTo(Math.PI / 2)
  })
})

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}
