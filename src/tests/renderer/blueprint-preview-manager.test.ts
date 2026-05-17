import { beforeEach, describe, expect, it, vi } from "vitest"

const { applicationState, textureManagerState } = vi.hoisted(() => ({
  applicationState: {
    initCalls: [] as unknown[],
    apps: [] as unknown[],
    destroy: vi.fn(),
  },
  textureManagerState: {
    destroy: vi.fn(),
    getTexture: vi.fn((_key?: string) => Promise.resolve({ id: "texture" })),
  },
}))

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public roundPixels = false
    public readonly position = {
      set: vi.fn(),
    }
    public readonly scale = {
      set: vi.fn(),
    }

    public addChild<T>(child: T): T {
      this.children.push(child)
      return child
    }
  }

  class MockGraphics {
    public roundPixels = false
    public renderable = true
    public readonly strokeCalls: unknown[] = []

    public constructor(options?: { roundPixels?: boolean }) {
      this.roundPixels = options?.roundPixels ?? false
    }

    public clear(): this {
      return this
    }

    public moveTo(): this {
      return this
    }

    public lineTo(): this {
      return this
    }

    public rect(): this {
      return this
    }

    public fill(): this {
      return this
    }

    public stroke(options?: unknown): this {
      this.strokeCalls.push(options)
      return this
    }

    public destroy(): void {}
  }

  class MockSprite {
    public readonly anchor = {
      set: vi.fn(),
    }
    public roundPixels = false
    public visible = true
    public destroyed = false
    public texture: unknown

    public constructor(texture: unknown) {
      this.texture = texture
    }

    public destroy(): void {
      this.destroyed = true
    }
  }

  class MockTilingSprite {
    public readonly anchor = {
      set: vi.fn(),
    }
    public readonly tileScale = {
      set: vi.fn(),
    }
    public readonly tilePosition = { x: 0, y: 0 }
    public roundPixels = false
    public visible = true
    public tint = 0
    public x = 0
    public y = 0
    public rotation = 0
    public width = 0
    public height = 0
    public texture: unknown
    public mask: unknown
    public destroyed = false

    public constructor(options: { texture: unknown; width: number; height: number }) {
      this.texture = options.texture
      this.width = options.width
      this.height = options.height
    }

    public destroy(): void {
      this.destroyed = true
    }
  }

  class MockApplication {
    public readonly canvas = {} as HTMLCanvasElement
    public readonly stage = new MockContainer()
    public readonly ticker = {
      add: vi.fn(),
    }
    public readonly renderer = {
      resolution: 1,
      width: 0,
      height: 0,
      resize: vi.fn((width: number, height: number, resolution: number) => {
        this.renderer.width = width
        this.renderer.height = height
        this.renderer.resolution = resolution
      }),
    }

    public constructor() {
      applicationState.apps.push(this)
    }

    public async init(options: unknown): Promise<void> {
      applicationState.initCalls.push(options)
    }

    public readonly destroy = applicationState.destroy
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    Texture: {
      EMPTY: { id: "empty-texture" },
      WHITE: { id: "white-texture" },
    },
    TilingSprite: MockTilingSprite,
  }
})

vi.mock("@/renderer/texture/texture-manager", () => ({
  createTextureActions: vi.fn(() => ({
    destroy: textureManagerState.destroy,
    getTexture: textureManagerState.getTexture,
  })),
}))

import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { createBlueprintDocument } from "@/domain/document/blueprint-document"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { createBlueprintPreviewManager } from "@/renderer/blueprint-preview/blueprint-preview-manager"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

beforeEach(() => {
  applicationState.initCalls.length = 0
  applicationState.apps.length = 0
  applicationState.destroy.mockClear()
  textureManagerState.destroy.mockClear()
  textureManagerState.getTexture.mockReset()
  textureManagerState.getTexture.mockImplementation(() => Promise.resolve({ id: "texture" }))
})

describe("createBlueprintPreviewManager", () => {
  it("uses the light canvas background and grid line color regardless of active theme", async () => {
    const entityDefinition = {
      id: "test-definition",
      nameKey: "test-definition",
      spriteId: "test-sprite",
      footprint: { width: 1, height: 1 },
      uiGroup: "hidden" as const,
      tags: [],
      requiresPower: false,
      powerDemand: 0,
      inspectors: [],
      portGroups: [],
      storageSlotGroups: [],
      portStorageBindings: [],
    }
    const workspace = {
      state: {} as never,
      registry: {
        entityDefinitions: [entityDefinition],
      },
      app: {
        state: {
          screenProfile: {
            devicePixelRatio: 2,
          },
          theme: AYU_DARK_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const manager = createBlueprintPreviewManager({ workspace })
    const blueprint = createBlueprintDocument({
      name: "Preview Background Test",
      baseId: "preview-background-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        "entity-1": {
          id: "entity-1",
          definitionId: "test-definition",
          position: { x: 5, y: 5 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["entity-1"],
      slotLinks: [],
    })

    const handle = await manager.actions.mountBlueprintPreview({
      blueprint,
      width: 240,
      height: 160,
    })

    // Canvas init uses light canvas background
    expect(applicationState.initCalls).toHaveLength(1)
    expect(applicationState.initCalls[0]).toMatchObject({
      width: 240,
      height: 160,
      backgroundAlpha: 1,
      backgroundColor: resolveAppThemeColorNumber(AYU_LIGHT_THEME, "canvas-bg"),
      resolution: 2,
      preference: "webgl",
    })

    manager.actions.disposeBlueprintPreview(handle)

    expect(textureManagerState.destroy).toHaveBeenCalledTimes(1)
    expect(applicationState.destroy).toHaveBeenCalledTimes(1)
  })

  it("keeps the highlight graphics renderable so the scanline mask can draw", async () => {
    textureManagerState.getTexture.mockImplementation((key?: string) => Promise.resolve(
      key === "texture-scanline-45deg-50opacity"
        ? { id: "scanline-texture", width: 64, height: 64 }
        : { id: "texture" },
    ))

    const entityDefinition = {
      id: "test-definition",
      nameKey: "test-definition",
      spriteId: "test-sprite",
      footprint: { width: 2, height: 3 },
      uiGroup: "hidden" as const,
      tags: [],
      requiresPower: false,
      powerDemand: 0,
      inspectors: [],
      portGroups: [],
      storageSlotGroups: [],
      portStorageBindings: [],
    }
    const workspace = {
      state: {} as never,
      registry: {
        entityDefinitions: [entityDefinition],
      },
      app: {
        state: {
          screenProfile: {
            devicePixelRatio: 1,
          },
          theme: AYU_LIGHT_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const manager = createBlueprintPreviewManager({ workspace })
    const blueprint = createBlueprintDocument({
      name: "Preview Highlight Test",
      baseId: "preview-highlight-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        selected: {
          id: "selected",
          definitionId: "test-definition",
          position: { x: 5, y: 5 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["selected"],
      slotLinks: [],
    })

    const handle = await manager.actions.mountBlueprintPreview({
      blueprint,
      width: 240,
      height: 160,
      viewportBounds: {
        left: 1,
        top: 1,
        width: 10,
        height: 10,
      },
      highlightedEntityId: "selected",
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(textureManagerState.getTexture).toHaveBeenCalledWith("texture-scanline-45deg-50opacity")

    const viewportContainer = (
      (applicationState.apps[0] as { stage: { children: unknown[] } }).stage.children[0] as { children: unknown[] }
    )
    const highlightScanline = viewportContainer.children[2] as {
      height?: number;
      mask?: unknown;
      tileScale?: { set: ReturnType<typeof vi.fn> };
      visible?: boolean;
      width?: number;
    }
    const highlightMask = viewportContainer.children[3] as { renderable?: boolean }

    expect(highlightScanline.mask).toBe(highlightMask)
    expect(highlightScanline.visible).toBe(true)
    expect(highlightScanline.width).toBe(6)
    expect(highlightScanline.height).toBe(7)
    expect(highlightScanline.tileScale?.set).toHaveBeenCalledWith(1 / 64, 1 / 64)
    expect(highlightMask.renderable).toBe(true)

    manager.actions.disposeBlueprintPreview(handle)
  })
})
