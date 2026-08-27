import { beforeEach, describe, expect, it, vi } from "vitest"

import { EntityCollectionType } from "@/domain/editor/types/editor-types"

function createEmptyEditorCollections(): Record<string, string[]> {
  return Object.fromEntries(
    Object.values(EntityCollectionType).map((collectionType) => [collectionType, []]),
  )
}

const orchestratorTestState = vi.hoisted(() => {
  let tickHandler: (() => void) | null = null
  const createdSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []
  const destroyedSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []
  const attachedSprites: Array<{
    kind: string;
    entityId: string;
    definitionId: string;
    entityLayer: unknown;
  }> = []
  const layoutSyncs: string[] = []
  const runtimeSyncs: string[] = []
  const animationSyncs: string[] = []
  const visualSyncInvalidatedEntityIds = new Set<string>()

  return {
    reset() {
      tickHandler = null
      createdSprites.length = 0
      destroyedSprites.length = 0
      attachedSprites.length = 0
      layoutSyncs.length = 0
      runtimeSyncs.length = 0
      animationSyncs.length = 0
      visualSyncInvalidatedEntityIds.clear()
    },
    setTickHandler(handler: () => void) {
      tickHandler = handler
    },
    getTickHandler() {
      return tickHandler
    },
    createDecoration() {
      return {
        container: {
          destroy: vi.fn(),
        },
        sync: vi.fn(),
        destroy: vi.fn(),
      }
    },
    recordCreatedSprite(kind: string, entityId: string, definitionId: string) {
      createdSprites.push({ kind, entityId, definitionId })
    },
    recordDestroyedSprite(kind: string, entityId: string, definitionId: string) {
      destroyedSprites.push({ kind, entityId, definitionId })
    },
    recordAttachedSprite(kind: string, entityId: string, definitionId: string, entityLayer: unknown) {
      attachedSprites.push({
        kind,
        entityId,
        definitionId,
        entityLayer,
      })
    },
    getCreatedSprites() {
      return [...createdSprites]
    },
    getDestroyedSprites() {
      return [...destroyedSprites]
    },
    getAttachedSprites() {
      return [...attachedSprites]
    },
    recordLayoutSync(entityId: string) {
      visualSyncInvalidatedEntityIds.delete(entityId)
      layoutSyncs.push(entityId)
    },
    invalidateVisualSync(entityId: string) {
      visualSyncInvalidatedEntityIds.add(entityId)
    },
    isVisualSyncInvalidated(entityId: string) {
      return visualSyncInvalidatedEntityIds.has(entityId)
    },
    recordRuntimeSync(entityId: string) {
      runtimeSyncs.push(entityId)
    },
    recordAnimationSync(entityId: string) {
      animationSyncs.push(entityId)
    },
    getLayoutSyncs() {
      return [...layoutSyncs]
    },
    getRuntimeSyncs() {
      return [...runtimeSyncs]
    },
    getAnimationSyncs() {
      return [...animationSyncs]
    },
  }
})

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public readonly addChild = vi.fn((...children: unknown[]) => {
      this.children.push(...children)
      return children[0]
    })
    public readonly addChildAt = vi.fn()
    public readonly destroy = vi.fn()
  }

  return {
    Container: MockContainer,
    Graphics: class {
      public rect = vi.fn().mockReturnThis()
      public fill = vi.fn().mockReturnThis()
      public stroke = vi.fn().mockReturnThis()
      public clear = vi.fn()
      public destroy = vi.fn()
    },
    UPDATE_PRIORITY: {
      HIGH: 50,
      LOW: -25,
    },
  }
})

vi.mock("@/renderer/sprites/belt-sprite", () => ({
  BeltSprite: class {
    private readonly kind = "belt"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/generic-device-sprite", () => ({
  GenericDeviceSprite: class {
    private readonly kind = "generic"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncRuntime = vi.fn(() => {
      orchestratorTestState.recordRuntimeSync(this.entityId)
    })
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/pipe-sprite", () => ({
  PipeSprite: class {
    private readonly kind = "pipe"
    public readonly attach = vi.fn((layers: { readonly entity: unknown }) => {
      orchestratorTestState.recordAttachedSprite(
        this.kind,
        this.entityId,
        this.definition.id,
        layers.entity,
      )
    })
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn(() => {
      orchestratorTestState.recordLayoutSync(this.entityId)
    })
    public readonly isVisualSyncInvalidated = vi.fn(() =>
      orchestratorTestState.isVisualSyncInvalidated(this.entityId))
    public readonly syncRuntime = vi.fn(() => {
      orchestratorTestState.recordRuntimeSync(this.entityId)
    })
    public readonly syncAnimation = vi.fn(() => {
      orchestratorTestState.recordAnimationSync(this.entityId)
    })

    public constructor(
      private readonly entityId: string,
      private readonly definition: { readonly id: string },
    ) {
      orchestratorTestState.recordCreatedSprite(this.kind, entityId, definition.id)
    }

    public destroy(): void {
      orchestratorTestState.recordDestroyedSprite(this.kind, this.entityId, this.definition.id)
    }
  },
}))

vi.mock("@/renderer/sprites/render-sprite", () => ({
  RenderLayerMap: {},
  RenderSprite: class {},
}))

vi.mock("@/renderer/scene/decorations/GridLineDecoration", () => ({
  createGridLineDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BaseBoundaryDecoration", () => ({
  createBaseBoundaryDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/DiagnosticsDecoration", () => ({
  createDiagnosticsDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BlueprintPlacementCanvasDecoration", () => ({
  createBlueprintPlacementCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/LogisticsPlacementCanvasDecoration", () => ({
  createLogisticsPlacementCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/MarqueeRectDecoration", () => ({
  createMarqueeRectDecoration: () => orchestratorTestState.createDecoration(),
  resolveMarqueeGridRectLayout: () => null,
  resolveWorldAuxiliaryStrokeWidth: () => 1,
}))

vi.mock("@/renderer/scene/decorations/MarqueeCanvasDecoration", () => ({
  createMarqueeCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PreviewRectDecoration", () => ({
  createPreviewRectDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/InvalidPlacementDecoration", () => ({
  createInvalidPlacementDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/GrassBackgroundDecoration", () => ({
  createGrassBackgroundDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltCargoDecoration", () => ({
  createBeltCargoDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltPortInsertionDecoration", () => ({
  createBeltPortInsertionDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/BeltFlowDecoration", () => ({
  createBeltFlowDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PipeFlowDecoration", () => ({
  createPipeFlowDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PowerRangeDecoration", () => ({
  createPowerRangeDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PortOverlayDecoration", () => ({
  createPortOverlayDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/PipePortGhostDecoration", () => ({
  createPipePortGhostDecoration: () => orchestratorTestState.createDecoration(),
}))

import { createRenderSceneOrchestrator } from "@/renderer/scene/render-scene-orchestrator"
import type { RenderHost } from "@/renderer/renderer-host"
import { AYU_LIGHT_THEME } from "@/app/theme"

describe("createRenderSceneOrchestrator", () => {
  beforeEach(() => {
    orchestratorTestState.reset()
  })

  it("passes raf delta ms to simulation playback advancement", () => {
    const advancePlaybackByDeltaMs = vi.fn(async () => null)
    const ticker = {
      lastTime: 1200,
      deltaMS: 16.67,
      add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
        if (priority === 50) {
          orchestratorTestState.setTickHandler(handler)
        }
      }),
      remove: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
        blueprintGlowOverlay: document.createElement("div"),
        marqueeGlowOverlay: document.createElement("div"),
      },
      app: {
        stage: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
        },
        renderer: {
          width: 640,
          height: 480,
          resolution: 1,
          resize: vi.fn(),
        },
        ticker,
      },
      internalState: {
      },
      workspace: {
        state: {} as never,
        registry: {
          entityDefinitions: [],
          baseDefinitions: [],
          recipeDefinitions: [],
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
            },
            settings: {
              gameUseBlueprintStyleDeviceImages: false,
            },
            activeTool: "select",
            toolInfo: {
              marqueeType: "marquee",
            },
            theme: AYU_LIGHT_THEME,
          },
        },
        editor: {
          state: {
            collections: createEmptyEditorCollections(),
            viewport: {
              clientRect: {
                width: 640,
                height: 480,
              },
              center: {
                x: 0,
                y: 0,
              },
              gridCellPixelSize: 16,
            },
          },
          queries: {
            listEntities: () => [],
          },
        },
        render: null,
        simulation: {
          state: "start",
          simulationSpeed: 1,
          topology: {} as never,
          queries: {
            getActiveGasDiffusionRanges: () => [],
          } as never,
          actions: {
            start: vi.fn(async () => ({
              status: "started" as const,
              topologyId: null,
              diagnostics: [],
            })),
            pause: vi.fn(),
            stop: vi.fn(),
            getTickSnapshot: vi.fn(async () => ({
              status: "not-ready" as const,
              requestedTickNumber: 0,
              retainedFromTick: null,
              latestTickNumber: null,
              bufferSize: 0,
            })),
            advancePlaybackByDeltaMs,
          },
        },
      },
    } as unknown as RenderHost

    const orchestrator = createRenderSceneOrchestrator(renderHost)
    const tickHandler = orchestratorTestState.getTickHandler()

    expect(ticker.add).toHaveBeenCalledTimes(3)
    expect(renderHost.app.stage.addChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(tickHandler).not.toBeNull()

    tickHandler?.()

    expect(advancePlaybackByDeltaMs).toHaveBeenCalledWith(16.67)

    orchestrator.destroy()
    expect(ticker.remove).toHaveBeenCalledTimes(3)
  })

  it("reuses entity layout while runtime, animation, and sprite visuals keep separate invalidation paths", () => {
    let runtimeTick = 10
    const ticker = {
      lastTime: 1200,
      deltaMS: 16.67,
      add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
        if (priority === 50) {
          orchestratorTestState.setTickHandler(handler)
        }
      }),
      remove: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
        blueprintGlowOverlay: document.createElement("div"),
        marqueeGlowOverlay: document.createElement("div"),
      },
      app: {
        stage: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
        },
        renderer: {
          width: 640,
          height: 480,
          resolution: 1,
          resize: vi.fn(),
        },
        ticker,
      },
      internalState: {},
      workspace: {
        state: {} as never,
        registry: {
          entityDefinitions: [{
            id: "device-a",
            spriteId: "device-a",
            footprint: { width: 2, height: 1 },
          }],
          baseDefinitions: [],
          recipeDefinitions: [],
          queries: {
            isDedicatedLogisticsDevice: vi.fn(() => false),
            resolveDedicatedLogisticsKind: vi.fn(() => null),
            isBeltFamily: vi.fn(() => false),
            isPipeFamily: vi.fn(() => false),
          },
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
              deviceClass: "desktop",
            },
            settings: {
              gameUseBlueprintStyleDeviceImages: false,
              gameShowDeviceNames: true,
              gameShowDeviceIcons: false,
            },
            activeTool: "select",
            toolInfo: {
              marqueeType: "marquee",
            },
            theme: AYU_LIGHT_THEME,
          },
        },
        editor: {
          state: {
            collections: createEmptyEditorCollections(),
            viewport: {
              clientRect: { width: 640, height: 480 },
              center: { x: 0, y: 0 },
              gridCellPixelSize: 16,
              displayRotation: 0,
            },
          },
          queries: {
            listEntities: () => [{
              id: "entity-a",
              definitionId: "device-a",
              position: { x: 0, y: 0 },
              rotation: 0,
              config: {},
              tags: [],
            }],
          },
        },
        render: null,
        simulation: {
          state: {
            runningState: "start",
            timeline: {
              cursorTickNumber: 10,
              readiness: "ready",
              isSeeking: false,
            },
          },
          queries: {
            getDocumentRuntimeStatus: () => ({
              tickNumber: runtimeTick,
              totalPowerDemand: 0,
              currentPowerGeneration: null,
              isPowerOutage: false,
            }),
            getActiveGasDiffusionRanges: () => [],
          },
          actions: {
            advancePlaybackByDeltaMs: vi.fn(async () => null),
          },
        },
      },
    } as unknown as RenderHost

    const orchestrator = createRenderSceneOrchestrator(renderHost)
    const tickHandler = orchestratorTestState.getTickHandler()

    tickHandler?.()
    tickHandler?.()
    runtimeTick = 11
    tickHandler?.()
    orchestratorTestState.invalidateVisualSync("entity-a")
    tickHandler?.()

    expect(orchestratorTestState.getLayoutSyncs()).toEqual(["entity-a", "entity-a"])
    expect(orchestratorTestState.getRuntimeSyncs()).toEqual(["entity-a"])
    expect(orchestratorTestState.getAnimationSyncs()).toEqual([
      "entity-a",
      "entity-a",
      "entity-a",
      "entity-a",
    ])

    orchestrator.destroy()
  })

  it("recreates an entity sprite when an entity keeps its id but changes definition", () => {
    let entities = [
      {
        id: "preview-entity",
        definitionId: "device-a",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ]
    const ticker = {
      lastTime: 1200,
      deltaMS: 16.67,
      add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
        if (priority === 50) {
          orchestratorTestState.setTickHandler(handler)
        }
      }),
      remove: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
        blueprintGlowOverlay: document.createElement("div"),
        marqueeGlowOverlay: document.createElement("div"),
      },
      app: {
        stage: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
        },
        renderer: {
          width: 640,
          height: 480,
          resolution: 1,
          resize: vi.fn(),
        },
        ticker,
      },
      internalState: {
      },
      workspace: {
        state: {} as never,
        registry: {
          entityDefinitions: [
            {
              id: "device-a",
              spriteId: "device-a",
              footprint: { width: 2, height: 1 },
            },
            {
              id: "device-b",
              spriteId: "device-b",
              footprint: { width: 3, height: 1 },
            },
          ],
          baseDefinitions: [],
          recipeDefinitions: [],
          queries: {
            isDedicatedLogisticsDevice: vi.fn(() => false),
            resolveDedicatedLogisticsKind: vi.fn(() => null),
            isBeltFamily: vi.fn(() => false),
            isPipeFamily: vi.fn(() => false),
          },
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
            },
            settings: {
              gameUseBlueprintStyleDeviceImages: false,
            },
            activeTool: "single-placement",
            toolInfo: {
              marqueeType: "marquee",
            },
            theme: AYU_LIGHT_THEME,
          },
        },
        editor: {
          state: {
            collections: createEmptyEditorCollections(),
            viewport: {
              clientRect: {
                width: 640,
                height: 480,
              },
              center: {
                x: 0,
                y: 0,
              },
              gridCellPixelSize: 16,
            },
          },
          queries: {
            listEntities: () => entities,
          },
        },
        render: null,
        simulation: null,
      },
    } as unknown as RenderHost

    const orchestrator = createRenderSceneOrchestrator(renderHost)
    const tickHandler = orchestratorTestState.getTickHandler()

    tickHandler?.()
    entities = [
      {
        ...entities[0]!,
        definitionId: "device-b",
      },
    ]
    tickHandler?.()

    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "generic", entityId: "preview-entity", definitionId: "device-a" },
      { kind: "generic", entityId: "preview-entity", definitionId: "device-b" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([
      { kind: "generic", entityId: "preview-entity", definitionId: "device-a" },
    ])

    orchestrator.destroy()
  })

  it("reattaches a logistics draft belt sprite when the same id becomes a formal belt entity", () => {
    const beltEntityId = "logistics-draft:belt:1:0"
    let entities: Array<{
      id: string;
      originalEntityId?: string;
      definitionId: string;
      position: { x: number; y: number };
      rotation: number;
      config: Record<string, never>;
      tags: string[];
    }> = [
      {
        id: beltEntityId,
        originalEntityId: beltEntityId,
        definitionId: "belt_straight_1x1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ]
    const ticker = {
      lastTime: 1200,
      deltaMS: 16.67,
      add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
        if (priority === 50) {
          orchestratorTestState.setTickHandler(handler)
        }
      }),
      remove: vi.fn(),
    }
    const stage = {
      addChild: vi.fn(),
      addChildAt: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
        blueprintGlowOverlay: document.createElement("div"),
        marqueeGlowOverlay: document.createElement("div"),
      },
      app: {
        stage,
        renderer: {
          width: 640,
          height: 480,
          resolution: 1,
          resize: vi.fn(),
        },
        ticker,
      },
      internalState: {
      },
      workspace: {
        state: {} as never,
        registry: {
          entityDefinitions: [
            {
              id: "belt_straight_1x1",
              spriteId: "belt_straight_1x1",
              footprint: { width: 1, height: 1 },
            },
          ],
          baseDefinitions: [],
          recipeDefinitions: [],
          queries: {
            isDedicatedLogisticsDevice: vi.fn((definitionId: string) =>
              definitionId === "belt_straight_1x1",
            ),
            resolveDedicatedLogisticsKind: vi.fn(() => "belt"),
            isBeltFamily: vi.fn((definitionId: string) =>
              definitionId === "belt_straight_1x1",
            ),
            isPipeFamily: vi.fn(() => false),
          },
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
            },
            settings: {
              gameUseBlueprintStyleDeviceImages: false,
            },
            activeTool: "select",
            toolInfo: {
              marqueeType: "marquee",
            },
            theme: AYU_LIGHT_THEME,
          },
        },
        editor: {
          state: {
            collections: createEmptyEditorCollections(),
            viewport: {
              clientRect: {
                width: 640,
                height: 480,
              },
              center: {
                x: 0,
                y: 0,
              },
              gridCellPixelSize: 16,
            },
          },
          queries: {
            listEntities: () => entities,
          },
        },
        render: null,
        simulation: null,
      },
    } as unknown as RenderHost

    const orchestrator = createRenderSceneOrchestrator(renderHost)
    const tickHandler = orchestratorTestState.getTickHandler()
    const stageLayers = stage.addChild.mock.calls[0] ?? []
    const logisticsBeltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
    const beltSubEntity = logisticsBeltLayer.children[0]
    const draftLayer = stageLayers[6]

    tickHandler?.()
    entities = [
      {
        id: beltEntityId,
        definitionId: "belt_straight_1x1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ]
    tickHandler?.()

    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([])
    expect(orchestratorTestState.getAttachedSprites()).toMatchObject([
      {
        kind: "belt",
        entityId: beltEntityId,
        definitionId: "belt_straight_1x1",
        entityLayer: draftLayer,
      },
      {
        kind: "belt",
        entityId: beltEntityId,
        definitionId: "belt_straight_1x1",
        entityLayer: beltSubEntity,
      },
    ])

    orchestrator.destroy()
  })
})
