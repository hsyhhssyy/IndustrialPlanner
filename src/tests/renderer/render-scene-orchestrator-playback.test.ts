import { beforeEach, describe, expect, it, vi } from "vitest"

const orchestratorTestState = vi.hoisted(() => {
  let tickHandler: (() => void) | null = null
  const createdSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []
  const destroyedSprites: Array<{ kind: string; entityId: string; definitionId: string }> = []

  return {
    reset() {
      tickHandler = null
      createdSprites.length = 0
      destroyedSprites.length = 0
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
    getCreatedSprites() {
      return [...createdSprites]
    },
    getDestroyedSprites() {
      return [...destroyedSprites]
    },
  }
})

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly addChild = vi.fn()
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
    },
  }
})

vi.mock("@/renderer/sprites/belt-sprite", () => ({
  BeltSprite: class {
    private readonly kind = "belt"
    public readonly attach = vi.fn()
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn()

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
    public readonly attach = vi.fn()
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn()

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
    public readonly attach = vi.fn()
    public readonly setVisible = vi.fn()
    public readonly syncLayout = vi.fn()

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

vi.mock("@/renderer/scene/decorations/LogisticsPlacementCanvasDecoration", () => ({
  createLogisticsPlacementCanvasDecoration: () => orchestratorTestState.createDecoration(),
}))

vi.mock("@/renderer/scene/decorations/MarqueeRectDecoration", () => ({
  createMarqueeRectDecoration: () => orchestratorTestState.createDecoration(),
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
      add: vi.fn((handler: () => void) => {
        orchestratorTestState.setTickHandler(handler)
      }),
      remove: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
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
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
            },
            settings: {
              gameUseSimplifiedDeviceIcons: false,
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
          queries: {} as never,
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

    expect(ticker.add).toHaveBeenCalledTimes(1)
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
      expect.anything(),
      expect.anything(),
    )
    expect(tickHandler).not.toBeNull()

    tickHandler?.()

    expect(advancePlaybackByDeltaMs).toHaveBeenCalledWith(16.67)

    orchestrator.destroy()
    expect(ticker.remove).toHaveBeenCalledTimes(1)
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
      add: vi.fn((handler: () => void) => {
        orchestratorTestState.setTickHandler(handler)
      }),
      remove: vi.fn(),
    }
    const renderHost = {
      dom: {
        placementGlowOverlay: document.createElement("div"),
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
          queries: {
            isDedicatedLogisticsDevice: vi.fn(() => false),
            resolveDedicatedLogisticsKind: vi.fn(() => null),
          },
        },
        app: {
          state: {
            screenProfile: {
              devicePixelRatio: 1,
            },
            settings: {
              gameUseSimplifiedDeviceIcons: false,
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
})
