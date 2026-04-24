import { describe, expect, it, vi } from "vitest"

const { loadTexture } = vi.hoisted(() => ({
  loadTexture: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("pixi.js", () => {
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

  return {
    Assets: {
      load: loadTexture,
    },
    Sprite: MockSprite,
    Texture: MockTexture,
  }
})

import { GenericDeviceSprite } from "@/renderer/sprites/generic-device-sprite"

interface RenderedSpriteSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
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
    const sprite = new GenericDeviceSprite("/sprites/item_port_storager_1.webp")

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
    })

    expect(loadTexture).toHaveBeenCalledWith("/sprites/item_port_storager_1.webp")

    await flushMicrotasks()

    const renderedSprite = entityLayer.addChild.mock.calls[0]?.[0]

    expect(renderedSprite).toBeDefined()

    if (!renderedSprite) {
      throw new Error("Expected GenericDeviceSprite to attach a Pixi sprite.")
    }

    const attachedSprite = renderedSprite as unknown as RenderedSpriteSnapshot

    expect(attachedSprite.texture).toBe(resolvedTexture)
    expect(attachedSprite.visible).toBe(true)
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