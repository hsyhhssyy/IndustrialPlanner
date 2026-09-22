import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { beforeEach, describe, expect, it, vi } from "vitest"

const { applicationState, entitySceneState, textureManagerState } = vi.hoisted(() => ({
  applicationState: {
    initCalls: [] as unknown[],
    apps: [] as unknown[],
    destroy: vi.fn(),
  },
  entitySceneState: {
    renderContexts: [] as unknown[],
    syncCalls: [] as unknown[],
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

    public readonly render = vi.fn()

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

vi.mock("@/renderer/scene", () => {
  const createContainer = () => ({
    children: [] as unknown[],
    addChild(...children: unknown[]) {
      this.children.push(...children)
      return children[0]
    },
    removeChild(child: unknown) {
      this.children = this.children.filter((candidate) => candidate !== child)
      return child
    },
    destroy: vi.fn(),
  })
  const createDecoration = () => ({
    container: createContainer(),
    sync: vi.fn(),
    destroy: vi.fn(),
  })

  return {
    createEntitySpriteScene: vi.fn((renderContext: unknown) => {
      entitySceneState.renderContexts.push(renderContext)
      return {
        layers: {
          background: createContainer(),
          entityLow: createContainer(),
          entity: createContainer(),
          entityHigh: createContainer(),
          logisticsBelt: createContainer(),
          logisticsPipe: createContainer(),
          draft: createContainer(),
          overlay: createContainer(),
        },
        attach: vi.fn(),
        sync: vi.fn((options: unknown) => {
          entitySceneState.syncCalls.push(options)
        }),
        destroy: vi.fn(),
      }
    }),
    createGridLineDecoration: vi.fn(createDecoration),
    createRegionAnnotationBackgroundDecoration: vi.fn(createDecoration),
    createRegionAnnotationOverlayDecoration: vi.fn(createDecoration),
  }
})

import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { createBlueprintDocument } from "@/domain/document/blueprint-document"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { createBlueprintPreviewManager } from "@/renderer/blueprint-preview/blueprint-preview-manager"
import { createRenderSurfaceRegistry } from "@/renderer/surface"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

beforeEach(() => {
  applicationState.initCalls.length = 0
  applicationState.apps.length = 0
  applicationState.destroy.mockClear()
  entitySceneState.renderContexts.length = 0
  entitySceneState.syncCalls.length = 0
  textureManagerState.destroy.mockClear()
  textureManagerState.getTexture.mockReset()
  textureManagerState.getTexture.mockImplementation(() => Promise.resolve({ id: "texture" }))
})

describe("createBlueprintPreviewManager", () => {
  it("derives adaptive blueprint and save-preview labels strictly from user zoom", async () => {
    const entityDefinition = {
      id: "test-definition",
      nameKey: "test-definition",
      spriteId: "test-sprite",
      footprint: { width: 1, height: 1 },
      uiGroup: "hidden" as const,
      displayOrder: 100,
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
          settings: {
            gameAlwaysShowGridLines: false,
            gamePlayDeviceAnimations: true,
            gameShowDeviceIcons: false,
            gameShowDeviceNames: true,
            gameUseBlueprintStyleDeviceImages: false,
            locale: "zh-CN",
            showGrassBackground: false,
            showRegionAnnotations: true,
          },
          theme: AYU_LIGHT_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const surfaceRegistry = createRenderSurfaceRegistry()
    const manager = createBlueprintPreviewManager({ workspace, surfaceRegistry })
    const blueprint = createBlueprintDocument({
      name: "Adaptive Label Test",
      baseId: "adaptive-label-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/scene-01-variant-1.schema6.json").entities,
      entityOrder: ["entity-1"],
      slotLinks: [],
    })

    const handle = await manager.actions.mountBlueprintPreview({
      blueprint,
      width: 240,
      height: 160,
      viewport: { zoom: 1 },
    })
    const settings = (
      entitySceneState.renderContexts[0] as {
        workspace: {
          app: {
            state: {
              settings: {
                gameShowDeviceIcons: boolean
                gameShowDeviceNames: boolean
              }
            }
          }
        }
      }
    ).workspace.app.state.settings
    const surface = surfaceRegistry.get(handle)

    expect(surface).not.toBeNull()
    expect(settings.gameShowDeviceIcons).toBe(true)
    expect(settings.gameShowDeviceNames).toBe(false)

    surface?.renderFrame({ nowMs: 1000, deltaMs: 16 })
    const defaultPresentationVersion = (
      entitySceneState.syncCalls.at(-1) as { versions: { presentation: number } }
    ).versions.presentation

    manager.actions.resizeBlueprintPreview(handle, 1200, 80)
    surface?.renderFrame({ nowMs: 1016, deltaMs: 16 })

    expect(settings.gameShowDeviceIcons).toBe(true)
    expect(settings.gameShowDeviceNames).toBe(false)
    expect(
      (entitySceneState.syncCalls.at(-1) as { versions: { presentation: number } })
        .versions.presentation,
    ).toBe(defaultPresentationVersion)

    manager.actions.updateBlueprintPreviewViewport(handle, { zoom: 1.000001 })
    surface?.renderFrame({ nowMs: 1032, deltaMs: 16 })

    expect(settings.gameShowDeviceNames).toBe(true)
    expect(
      (entitySceneState.syncCalls.at(-1) as { versions: { presentation: number } })
        .versions.presentation,
    ).toBe(defaultPresentationVersion + 1)

    manager.actions.updateBlueprintPreviewViewport(handle, { zoom: 1 })
    surface?.renderFrame({ nowMs: 1048, deltaMs: 16 })

    expect(settings.gameShowDeviceNames).toBe(false)
    expect(
      (entitySceneState.syncCalls.at(-1) as { versions: { presentation: number } })
        .versions.presentation,
    ).toBe(defaultPresentationVersion + 2)

    manager.destroy()
  })

  it("keeps Inspector fixed-neighborhood device labels disabled", async () => {
    const entityDefinition = {
      id: "test-definition",
      nameKey: "test-definition",
      spriteId: "test-sprite",
      footprint: { width: 1, height: 1 },
      uiGroup: "hidden" as const,
      displayOrder: 100,
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
          settings: {
            gameShowDeviceIcons: true,
            gameShowDeviceNames: true,
            locale: "zh-CN",
            showRegionAnnotations: true,
          },
          theme: AYU_LIGHT_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const surfaceRegistry = createRenderSurfaceRegistry()
    const manager = createBlueprintPreviewManager({ workspace, surfaceRegistry })
    const blueprint = createBlueprintDocument({
      name: "Inspector Label Test",
      baseId: "inspector-label-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/scene-02-variant-1.schema6.json").entities,
      entityOrder: ["selected"],
      slotLinks: [],
    })

    const handle = await manager.actions.mountBlueprintPreview({
      blueprint,
      width: 240,
      height: 160,
      viewport: { zoom: 2 },
      viewportBounds: {
        left: 1,
        top: 1,
        width: 10,
        height: 10,
      },
      highlightedEntityId: "selected",
    })
    const settings = (
      entitySceneState.renderContexts[0] as {
        workspace: {
          app: {
            state: {
              settings: {
                gameShowDeviceIcons: boolean
                gameShowDeviceNames: boolean
              }
            }
          }
        }
      }
    ).workspace.app.state.settings

    expect(settings.gameShowDeviceIcons).toBe(false)
    expect(settings.gameShowDeviceNames).toBe(false)

    manager.actions.updateBlueprintPreviewViewport(handle, { zoom: 4 })

    expect(settings.gameShowDeviceIcons).toBe(false)
    expect(settings.gameShowDeviceNames).toBe(false)

    manager.destroy()
  })

  it("uses the light canvas background and grid line color regardless of active theme", async () => {
    const entityDefinition = {
      id: "test-definition",
      nameKey: "test-definition",
      spriteId: "test-sprite",
      footprint: { width: 1, height: 1 },
      uiGroup: "hidden" as const,
      displayOrder: 100,
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
          settings: {
            gameAlwaysShowGridLines: false,
            gamePlayDeviceAnimations: true,
            gameShowDeviceIcons: true,
            gameShowDeviceNames: true,
            gameUseBlueprintStyleDeviceImages: false,
            locale: "zh-CN",
            showGrassBackground: false,
            showRegionAnnotations: true,
          },
          theme: AYU_DARK_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const surfaceRegistry = createRenderSurfaceRegistry()
    const manager = createBlueprintPreviewManager({ workspace, surfaceRegistry })
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // {
    //         "entity-1": {
    //           id: "entity-1",
    //           definitionId: "test-definition",
    //           position: { x: 5, y: 5 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       }
    const blueprint = createBlueprintDocument({
      name: "Preview Background Test",
      baseId: "preview-background-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/scene-01-variant-1.schema6.json").entities,
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

  it("registers multiple preview canvases and disposes them independently", async () => {
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
      displayOrder: 100,
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
          settings: {
            gameAlwaysShowGridLines: false,
            gamePlayDeviceAnimations: true,
            gameShowDeviceIcons: true,
            gameShowDeviceNames: true,
            gameUseBlueprintStyleDeviceImages: false,
            locale: "zh-CN",
            showGrassBackground: false,
            showRegionAnnotations: true,
          },
          theme: AYU_LIGHT_THEME,
        },
      },
      editor: null,
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract
    const surfaceRegistry = createRenderSurfaceRegistry()
    const manager = createBlueprintPreviewManager({ workspace, surfaceRegistry })
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // {
    //         selected: {
    //           id: "selected",
    //           definitionId: "test-definition",
    //           position: { x: 5, y: 5 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       }
    const blueprint = createBlueprintDocument({
      name: "Preview Highlight Test",
      baseId: "preview-highlight-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/scene-02-variant-1.schema6.json").entities,
      entityOrder: ["selected"],
      slotLinks: [],
    })

    const firstHandle = await manager.actions.mountBlueprintPreview({
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
    const secondHandle = await manager.actions.mountBlueprintPreview({
      blueprint,
      width: 180,
      height: 120,
    })

    expect(firstHandle).not.toBe(secondHandle)
    expect(manager.queries.getBlueprintPreviewCanvas(firstHandle)).not.toBeNull()
    expect(manager.queries.getBlueprintPreviewCanvas(secondHandle)).not.toBeNull()
    expect(surfaceRegistry.listActive()).toHaveLength(2)

    manager.actions.disposeBlueprintPreview(firstHandle)

    expect(manager.queries.getBlueprintPreviewCanvas(firstHandle)).toBeNull()
    expect(manager.queries.getBlueprintPreviewCanvas(secondHandle)).not.toBeNull()
    expect(surfaceRegistry.listActive()).toHaveLength(1)

    manager.destroy()
    expect(surfaceRegistry.listActive()).toHaveLength(0)
  })

  // AI-REMOVED 2026-09-21:
  // Reason: Inspector 高亮已由共享 GenericDeviceSprite selection overlay 实现，不再存在 preview 专用 scanline texture/mask 显示对象可供该测试断言。
  // Trigger: ST2-RQ-037 第一阶段移除蓝图 preview 平行 renderer。
  // Evidence: blueprint-preview-manager.ts 使用 highlightedEntityId 投影 selection collection；真实浏览器与多 Surface 生命周期回归通过。
  // Replacement: 上方 multiple preview canvases 生命周期测试；GenericDeviceSprite 的 selection overlay 由既有 sprite 测试覆盖。
  // Risk: Inspector 高亮视觉仍需真实浏览器保持验证。
  // Human Review: Required
  //
  // Original code:
  /*
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
      displayOrder: 100,
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
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // {
    //         selected: {
    //           id: "selected",
    //           definitionId: "test-definition",
    //           position: { x: 5, y: 5 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       }
    const blueprint = createBlueprintDocument({
      name: "Preview Highlight Test",
      baseId: "preview-highlight-test",
      initialGridPoint: { x: 0, y: 0 },
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/blueprint-preview-manager/scene-02-variant-1.schema6.json").entities,
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
  */
})
