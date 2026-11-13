import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EntityCollectionType } from "@/domain/editor/types/editor-types"

// AI-REMOVED 2026-11-12:
// Reason: Renderer 输入已从假 Workspace 转为真实 SceneSource/View/Presentation。
// Trigger: REQ-048 D5。
// Evidence: 旧 helper 伪造 Registry/Editor/Simulation 并依赖已删除的 RenderHost 属性。
// Replacement: 本文件真实 SceneSession、真实仿真及版本化场景；仅记录绘制边界。
// Risk: CPU 编排断言不代替真实 GPU 验证；五项原行为目标保留。
// Human Review: Required
// Original code:
// function createEmptyEditorCollections(): Record<string, string[]> {
//   return Object.fromEntries(
//     Object.values(EntityCollectionType).map((collectionType) => [collectionType, []]),
//   )
// }


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
    public readonly position = { set: vi.fn() }
    public readonly pivot = { set: vi.fn() }
    public readonly scale = { set: vi.fn() }
    public rotation = 0
    public visible = true
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

vi.mock("@/renderer/scene/decorations/RegionalDarkPipeLinkDecoration", () => ({
  createRegionalDarkPipeLinkDecoration: () => orchestratorTestState.createDecoration(),
}))

import { createRenderSceneOrchestrator } from "@/renderer/scene/render-scene-orchestrator"
// AI-REMOVED 2026-11-12:
// Reason: Renderer 输入已从假 Workspace 转为真实 SceneSource/View/Presentation。
// Trigger: REQ-048 D5。
// Evidence: 旧 helper 伪造 Registry/Editor/Simulation 并依赖已删除的 RenderHost 属性。
// Replacement: 本文件真实 SceneSession、真实仿真及版本化场景；仅记录绘制边界。
// Risk: CPU 编排断言不代替真实 GPU 验证；五项原行为目标保留。
// Human Review: Required
// Original code:
// import type { RenderHost } from "@/renderer/renderer-host"
// import { AYU_LIGHT_THEME } from "@/app/theme"
//
// function createOrchestratorTestHost(seed: {
//   readonly dom: RenderHost["dom"],
//   readonly app: unknown,
//   readonly internalState: Record<string, unknown>,
//   readonly workspace: unknown,
// }): RenderHost {
//   // REQ-038：沿用本文件既有编排测试布景，补齐新 Editor 查询契约；断言不变。
//   const workspace = seed.workspace as RenderHost["workspace"]
//   Object.assign(workspace.editor!.queries, {
//     subscribeBaseDocuments: () => () => undefined,
//     subscribeCommittedEdits: () => () => undefined,
//     getRegionalDarkPipeLinks: () => [],
//   })
//   const textureManager = {
//     supportsLogisticsAnimation: vi.fn(() => false),
//     acquireLogisticsDynamic: vi.fn(() => {
//       throw new Error("Disabled logistics animation must not acquire dynamic assets")
//     }),
//   } as unknown as RenderHost["textureManager"]
//
//   return {
//     container: document.createElement("div"),
//     queries: {} as RenderHost["queries"],
//     actions: {} as RenderHost["actions"],
//     destroy: vi.fn(),
//     dom: seed.dom,
//     app: seed.app as RenderHost["app"],
//     internalState: {
//       ...seed.internalState,
//       textureConfig: null,
//     },
//     workspace: seed.workspace as RenderHost["workspace"],
//     textureManager,
//   }
// }
//
// describe("createRenderSceneOrchestrator", () => {
//   beforeEach(() => {
//     orchestratorTestState.reset()
//   })
//
//   it("leaves simulation playback advancement to the host scheduler", () => {
//     const advancePlaybackByDeltaMs = vi.fn(async () => null)
//     const ticker = {
//       lastTime: 1200,
//       deltaMS: 16.67,
//       add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
//         if (priority === 50) {
//           orchestratorTestState.setTickHandler(handler)
//         }
//       }),
//       remove: vi.fn(),
//     }
//     const renderHost = createOrchestratorTestHost({
//       dom: {
//         placementGlowOverlay: document.createElement("div"),
//         blueprintGlowOverlay: document.createElement("div"),
//         marqueeGlowOverlay: document.createElement("div"),
//       },
//       app: {
//         stage: {
//           addChild: vi.fn(),
//           addChildAt: vi.fn(),
//         },
//         renderer: {
//           width: 640,
//           height: 480,
//           resolution: 1,
//           resize: vi.fn(),
//         },
//         ticker,
//       },
//       internalState: {
//       },
//       workspace: {
//         state: {} as never,
//         registry: {
//           entityDefinitions: [],
//           baseDefinitions: [],
//           recipeDefinitions: [],
//         },
//         app: {
//           state: {
//             screenProfile: {
//               devicePixelRatio: 1,
//             },
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//             },
//             activeTool: "select",
//             toolInfo: {
//               marqueeType: "marquee",
//             },
//             theme: AYU_LIGHT_THEME,
//           },
//         },
//         editor: {
//           state: {
//             collections: createEmptyEditorCollections(),
//             viewport: {
//               clientRect: {
//                 width: 640,
//                 height: 480,
//               },
//               center: {
//                 x: 0,
//                 y: 0,
//               },
//               gridCellPixelSize: 16,
//             },
//           },
//           queries: {
//             listEntities: () => [],
//           },
//         },
//         render: null,
//         simulation: {
//           state: "start",
//           simulationSpeed: 1,
//           topology: {} as never,
//           queries: {
//             getActiveEnvironmentRanges: () => [],
//           } as never,
//           actions: {
//             start: vi.fn(async () => ({
//               status: "started" as const,
//               topologyId: null,
//               diagnostics: [],
//             })),
//             pause: vi.fn(),
//             stop: vi.fn(),
//             getTickSnapshot: vi.fn(async () => ({
//               status: "not-ready" as const,
//               requestedTickNumber: 0,
//               retainedFromTick: null,
//               latestTickNumber: null,
//               bufferSize: 0,
//             })),
//             advancePlaybackByDeltaMs,
//           },
//         },
//       },
//     })
//
//     const orchestrator = createRenderSceneOrchestrator(renderHost)
//
//     expect(ticker.add).not.toHaveBeenCalled()
//     expect(renderHost.app.stage.addChild).toHaveBeenCalledWith(
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//       expect.anything(),
//     )
//     orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
//
//     expect(advancePlaybackByDeltaMs).not.toHaveBeenCalled()
//
//     orchestrator.destroy()
//     expect(ticker.remove).not.toHaveBeenCalled()
//   })
//
//   it("reuses entity layout while runtime, animation, and sprite visuals keep separate invalidation paths", () => {
//     let runtimeTick = 10
//     const ticker = {
//       lastTime: 1200,
//       deltaMS: 16.67,
//       add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
//         if (priority === 50) {
//           orchestratorTestState.setTickHandler(handler)
//         }
//       }),
//       remove: vi.fn(),
//     }
//     const renderHost = createOrchestratorTestHost({
//       dom: {
//         placementGlowOverlay: document.createElement("div"),
//         blueprintGlowOverlay: document.createElement("div"),
//         marqueeGlowOverlay: document.createElement("div"),
//       },
//       app: {
//         stage: {
//           addChild: vi.fn(),
//           addChildAt: vi.fn(),
//         },
//         renderer: {
//           width: 640,
//           height: 480,
//           resolution: 1,
//           resize: vi.fn(),
//         },
//         ticker,
//       },
//       internalState: {},
//       workspace: {
//         state: {} as never,
//         registry: {
//           entityDefinitions: [{
//             id: "device-a",
//             spriteId: "device-a",
//             footprint: { width: 2, height: 1 },
//           }],
//           baseDefinitions: [],
//           recipeDefinitions: [],
//           queries: {
//             isBelt: (definitionId: string) => definitionId === "belt_straight_1x1",
//             isPipe: () => false,
//             isDedicatedLogisticsDevice: vi.fn(() => false),
//             resolveDedicatedLogisticsKind: vi.fn(() => null),
//             isBeltFamily: vi.fn(() => false),
//             isPipeFamily: vi.fn(() => false),
//           },
//         },
//         app: {
//           state: {
//             screenProfile: {
//               devicePixelRatio: 1,
//               deviceClass: "desktop",
//             },
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//               gameShowDeviceNames: true,
//               gameShowDeviceIcons: false,
//             },
//             activeTool: "select",
//             toolInfo: {
//               marqueeType: "marquee",
//             },
//             theme: AYU_LIGHT_THEME,
//           },
//         },
//         editor: {
//           state: {
//             collections: createEmptyEditorCollections(),
//             viewport: {
//               clientRect: { width: 640, height: 480 },
//               center: { x: 0, y: 0 },
//               gridCellPixelSize: 16,
//               displayRotation: 0,
//             },
//           },
//           queries: {
//             listEntities: () => [{
//               id: "entity-a",
//               definitionId: "device-a",
//               position: { x: 0, y: 0 },
//               rotation: 0,
//               config: {},
//               tags: [],
//             }],
//           },
//         },
//         render: null,
//         simulation: {
//           state: {
//             runningState: "start",
//             timeline: {
//               cursorTickNumber: 10,
//               readiness: "ready",
//               isSeeking: false,
//             },
//           },
//           queries: {
//             getDocumentRuntimeStatus: () => ({
//               tickNumber: runtimeTick,
//               totalPowerDemand: 0,
//               currentPowerGeneration: null,
//               isPowerOutage: false,
//             }),
//             getActiveEnvironmentRanges: () => [],
//           },
//           actions: {
//             advancePlaybackByDeltaMs: vi.fn(async () => null),
//           },
//         },
//       },
//     })
//
//     const orchestrator = createRenderSceneOrchestrator(renderHost)
//     orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
//     orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
//     runtimeTick = 11
//     orchestrator.sync({ nowMs: 1233.34, deltaMs: 16.67 })
//     orchestratorTestState.invalidateVisualSync("entity-a")
//     orchestrator.sync({ nowMs: 1250.01, deltaMs: 16.67 })
//
//     expect(orchestratorTestState.getLayoutSyncs()).toEqual(["entity-a", "entity-a"])
//     expect(orchestratorTestState.getRuntimeSyncs()).toEqual(["entity-a"])
//     expect(orchestratorTestState.getAnimationSyncs()).toEqual([
//       "entity-a",
//       "entity-a",
//       "entity-a",
//       "entity-a",
//     ])
//
//     orchestrator.destroy()
//   })
//
//   it("recreates an entity sprite when an entity keeps its id but changes definition", () => {
//     let entities = [
//       {
//         id: "preview-entity",
//         definitionId: "device-a",
//         position: { x: 0, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//     ]
//     const ticker = {
//       lastTime: 1200,
//       deltaMS: 16.67,
//       add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
//         if (priority === 50) {
//           orchestratorTestState.setTickHandler(handler)
//         }
//       }),
//       remove: vi.fn(),
//     }
//     const renderHost = createOrchestratorTestHost({
//       dom: {
//         placementGlowOverlay: document.createElement("div"),
//         blueprintGlowOverlay: document.createElement("div"),
//         marqueeGlowOverlay: document.createElement("div"),
//       },
//       app: {
//         stage: {
//           addChild: vi.fn(),
//           addChildAt: vi.fn(),
//         },
//         renderer: {
//           width: 640,
//           height: 480,
//           resolution: 1,
//           resize: vi.fn(),
//         },
//         ticker,
//       },
//       internalState: {
//       },
//       workspace: {
//         state: {} as never,
//         registry: {
//           entityDefinitions: [
//             {
//               id: "device-a",
//               spriteId: "device-a",
//               footprint: { width: 2, height: 1 },
//             },
//             {
//               id: "device-b",
//               spriteId: "device-b",
//               footprint: { width: 3, height: 1 },
//             },
//           ],
//           baseDefinitions: [],
//           recipeDefinitions: [],
//           queries: {
//             isBelt: (definitionId: string) => definitionId === "belt_straight_1x1",
//             isPipe: () => false,
//             isDedicatedLogisticsDevice: vi.fn(() => false),
//             resolveDedicatedLogisticsKind: vi.fn(() => null),
//             isBeltFamily: vi.fn(() => false),
//             isPipeFamily: vi.fn(() => false),
//           },
//         },
//         app: {
//           state: {
//             screenProfile: {
//               devicePixelRatio: 1,
//             },
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//             },
//             activeTool: "single-placement",
//             toolInfo: {
//               marqueeType: "marquee",
//             },
//             theme: AYU_LIGHT_THEME,
//           },
//         },
//         editor: {
//           state: {
//             collections: createEmptyEditorCollections(),
//             viewport: {
//               clientRect: {
//                 width: 640,
//                 height: 480,
//               },
//               center: {
//                 x: 0,
//                 y: 0,
//               },
//               gridCellPixelSize: 16,
//             },
//           },
//           queries: {
//             listEntities: () => entities,
//           },
//         },
//         render: null,
//         simulation: null,
//       },
//     })
//
//     const orchestrator = createRenderSceneOrchestrator(renderHost)
//     orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
//     entities = [
//       {
//         ...entities[0]!,
//         definitionId: "device-b",
//       },
//     ]
//     orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
//
//     expect(orchestratorTestState.getCreatedSprites()).toEqual([
//       { kind: "generic", entityId: "preview-entity", definitionId: "device-a" },
//       { kind: "generic", entityId: "preview-entity", definitionId: "device-b" },
//     ])
//     expect(orchestratorTestState.getDestroyedSprites()).toEqual([
//       { kind: "generic", entityId: "preview-entity", definitionId: "device-a" },
//     ])
//
//     orchestrator.destroy()
//   })
//
//   it("keeps pipes above belts when entity order is reversed", () => {
//     const entities = [
//       {
//         id: "pipe-entity",
//         definitionId: "pipe_straight_1x1",
//         position: { x: 0, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//       {
//         id: "belt-entity",
//         definitionId: "belt_straight_1x1",
//         position: { x: 0, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//     ]
//     const ticker = {
//       lastTime: 1200,
//       deltaMS: 16.67,
//       add: vi.fn(),
//       remove: vi.fn(),
//     }
//     const stage = {
//       addChild: vi.fn(),
//       addChildAt: vi.fn(),
//     }
//     const renderHost = createOrchestratorTestHost({
//       dom: {
//         placementGlowOverlay: document.createElement("div"),
//         blueprintGlowOverlay: document.createElement("div"),
//         marqueeGlowOverlay: document.createElement("div"),
//       },
//       app: {
//         stage,
//         renderer: {
//           width: 640,
//           height: 480,
//           resolution: 1,
//           resize: vi.fn(),
//         },
//         ticker,
//       },
//       internalState: {},
//       workspace: {
//         state: {} as never,
//         registry: {
//           entityDefinitions: [
//             {
//               id: "belt_straight_1x1",
//               spriteId: "belt_straight_1x1",
//               footprint: { width: 1, height: 1 },
//             },
//             {
//               id: "pipe_straight_1x1",
//               spriteId: "pipe_straight_1x1",
//               footprint: { width: 1, height: 1 },
//             },
//           ],
//           baseDefinitions: [],
//           recipeDefinitions: [],
//           queries: {
//             isBelt: (definitionId: string) => definitionId === "belt_straight_1x1",
//             isPipe: (definitionId: string) => definitionId === "pipe_straight_1x1",
//             isDedicatedLogisticsDevice: vi.fn((definitionId: string) =>
//               definitionId === "belt_straight_1x1"
//               || definitionId === "pipe_straight_1x1",
//             ),
//             resolveDedicatedLogisticsKind: vi.fn((definitionId: string) =>
//               definitionId === "belt_straight_1x1" ? "belt" : "pipe",
//             ),
//             isBeltFamily: vi.fn((definitionId: string) =>
//               definitionId === "belt_straight_1x1",
//             ),
//             isPipeFamily: vi.fn((definitionId: string) =>
//               definitionId === "pipe_straight_1x1",
//             ),
//           },
//         },
//         app: {
//           state: {
//             screenProfile: {
//               devicePixelRatio: 1,
//             },
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//             },
//             activeTool: "select",
//             toolInfo: {
//               marqueeType: "marquee",
//             },
//             theme: AYU_LIGHT_THEME,
//           },
//         },
//         editor: {
//           state: {
//             collections: createEmptyEditorCollections(),
//             viewport: {
//               clientRect: {
//                 width: 640,
//                 height: 480,
//               },
//               center: {
//                 x: 0,
//                 y: 0,
//               },
//               gridCellPixelSize: 16,
//             },
//           },
//           queries: {
//             listEntities: () => entities,
//           },
//         },
//         render: null,
//         simulation: null,
//       },
//     })
//
//     const orchestrator = createRenderSceneOrchestrator(renderHost)
//     const stageLayers = stage.addChild.mock.calls[0] ?? []
//     const beltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
//     const pipeLayer = stageLayers[5] as { readonly children: readonly unknown[] }
//     const beltSubEntity = beltLayer.children[0]
//     const pipeSubEntity = pipeLayer.children[2]
//
//     orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
//
//     expect(orchestratorTestState.getCreatedSprites()).toEqual([
//       { kind: "pipe", entityId: "pipe-entity", definitionId: "pipe_straight_1x1" },
//       { kind: "belt", entityId: "belt-entity", definitionId: "belt_straight_1x1" },
//     ])
//     expect(orchestratorTestState.getAttachedSprites()).toEqual([
//       {
//         kind: "pipe",
//         entityId: "pipe-entity",
//         definitionId: "pipe_straight_1x1",
//         entityLayer: pipeSubEntity,
//       },
//       {
//         kind: "belt",
//         entityId: "belt-entity",
//         definitionId: "belt_straight_1x1",
//         entityLayer: beltSubEntity,
//       },
//     ])
//     expect(stageLayers.indexOf(beltLayer)).toBeLessThan(stageLayers.indexOf(pipeLayer))
//
//     orchestrator.destroy()
//   })
//
//   it("reattaches a logistics draft belt sprite when the same id becomes a formal belt entity", () => {
//     const beltEntityId = "logistics-draft:belt:1:0"
//     let entities: Array<{
//       id: string;
//       originalEntityId?: string;
//       definitionId: string;
//       position: { x: number; y: number };
//       rotation: number;
//       config: Record<string, never>;
//       tags: string[];
//     }> = [
//       {
//         id: beltEntityId,
//         originalEntityId: beltEntityId,
//         definitionId: "belt_straight_1x1",
//         position: { x: 0, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//     ]
//     const ticker = {
//       lastTime: 1200,
//       deltaMS: 16.67,
//       add: vi.fn((handler: () => void, _context: unknown, priority: number) => {
//         if (priority === 50) {
//           orchestratorTestState.setTickHandler(handler)
//         }
//       }),
//       remove: vi.fn(),
//     }
//     const stage = {
//       addChild: vi.fn(),
//       addChildAt: vi.fn(),
//     }
//     const renderHost = createOrchestratorTestHost({
//       dom: {
//         placementGlowOverlay: document.createElement("div"),
//         blueprintGlowOverlay: document.createElement("div"),
//         marqueeGlowOverlay: document.createElement("div"),
//       },
//       app: {
//         stage,
//         renderer: {
//           width: 640,
//           height: 480,
//           resolution: 1,
//           resize: vi.fn(),
//         },
//         ticker,
//       },
//       internalState: {
//       },
//       workspace: {
//         state: {} as never,
//         registry: {
//           entityDefinitions: [
//             {
//               id: "belt_straight_1x1",
//               spriteId: "belt_straight_1x1",
//               footprint: { width: 1, height: 1 },
//             },
//           ],
//           baseDefinitions: [],
//           recipeDefinitions: [],
//           queries: {
//             isBelt: (definitionId: string) => definitionId === "belt_straight_1x1",
//             isPipe: () => false,
//             isDedicatedLogisticsDevice: vi.fn((definitionId: string) =>
//               definitionId === "belt_straight_1x1",
//             ),
//             resolveDedicatedLogisticsKind: vi.fn(() => "belt"),
//             isBeltFamily: vi.fn((definitionId: string) =>
//               definitionId === "belt_straight_1x1",
//             ),
//             isPipeFamily: vi.fn(() => false),
//           },
//         },
//         app: {
//           state: {
//             screenProfile: {
//               devicePixelRatio: 1,
//             },
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//             },
//             activeTool: "select",
//             toolInfo: {
//               marqueeType: "marquee",
//             },
//             theme: AYU_LIGHT_THEME,
//           },
//         },
//         editor: {
//           state: {
//             collections: createEmptyEditorCollections(),
//             viewport: {
//               clientRect: {
//                 width: 640,
//                 height: 480,
//               },
//               center: {
//                 x: 0,
//                 y: 0,
//               },
//               gridCellPixelSize: 16,
//             },
//           },
//           queries: {
//             listEntities: () => entities,
//           },
//         },
//         render: null,
//         simulation: null,
//       },
//     })
//
//     const orchestrator = createRenderSceneOrchestrator(renderHost)
//     const stageLayers = stage.addChild.mock.calls[0] ?? []
//     const logisticsBeltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
//     const beltSubEntity = logisticsBeltLayer.children[0]
//     const draftLayer = stageLayers[6]
//
//     orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
//     entities = [
//       {
//         id: beltEntityId,
//         definitionId: "belt_straight_1x1",
//         position: { x: 0, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//     ]
//     orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
//
//     expect(orchestratorTestState.getCreatedSprites()).toEqual([
//       { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1" },
//     ])
//     expect(orchestratorTestState.getDestroyedSprites()).toEqual([])
//     expect(orchestratorTestState.getAttachedSprites()).toMatchObject([
//       {
//         kind: "belt",
//         entityId: beltEntityId,
//         definitionId: "belt_straight_1x1",
//         entityLayer: draftLayer,
//       },
//       {
//         kind: "belt",
//         entityId: beltEntityId,
//         definitionId: "belt_straight_1x1",
//         entityLayer: beltSubEntity,
//       },
//     ])
//
//     orchestrator.destroy()
//   })
// })
//
import type { RenderSurfaceContext } from "@/renderer/render-surface-context"
import { createRenderTestScene } from "@/tests/helpers/render-test-scene"
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers"
import { createSimulationHost } from "@/simulation/simulation-host"
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry"

const cleanups: Array<() => void> = []
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks() })

function createOrchestratorTestHost(fixture?: "device" | "layers", withSimulation = false) {
  const scene = createRenderTestScene({ document: fixture === undefined ? undefined : createWorldDocumentFromBlueprint(
    loadBlueprintFromFile(`src/tests/fixtures/blueprints/collections/req048/orchestrator-${fixture}.schema7.json`)) })
  cleanups.push(scene.dispose)
  scene.view.actions.setViewportClientRect({ left: 0, top: 0, width: 640, height: 480 })
  // 2026-11-12：相机按真实场景聚焦，设备位于 (20,20)，物流场景与空场景起笔在原点。
  const box = resolveEntityGridGeometry({ entities: scene.editor.queries.listEntities(),
    entityDefinitionMap: new Map(scene.workspace.registry.entityDefinitions.map(definition => [definition.id, definition])) })?.boundingBox
  scene.view.actions.focusOnBounds({ x: box?.left ?? 0, y: box?.top ?? 0, width: box?.width ?? 1, height: box?.height ?? 1 },
    { durationMs: 0, gridSize: 1 })
  scene.workspace.editor = scene.editor
  const simulation = withSimulation ? createSimulationHost(scene.workspace, { workerMode: "runtime" }) : null
  if (simulation !== null) cleanups.push(simulation.dispose)
  const ticker = { add: vi.fn(), remove: vi.fn() }
  const stage = { addChild: vi.fn(), addChildAt: vi.fn() }
  const host: RenderSurfaceContext = {
    input: { ...scene.input, simulation }, resources: scene.resources, invalidate: vi.fn(),
    container: document.createElement("div"), internalState: { textureConfig: null },
    dom: { placementGlowOverlay: document.createElement("div"), blueprintGlowOverlay: document.createElement("div"), marqueeGlowOverlay: document.createElement("div") },
    app: { stage, ticker, renderer: { width: 640, height: 480, resolution: 1, resize: vi.fn(), background: { color: 0, alpha: 1 } } } as unknown as RenderSurfaceContext["app"],
    textureManager: {
      supportsLogisticsAnimation: vi.fn(() => false),
      acquireLogisticsDynamic: vi.fn(() => { throw new Error("Disabled logistics animation must not acquire dynamic assets") }),
    } as unknown as RenderSurfaceContext["textureManager"],
  }
  const orchestrator = createRenderSceneOrchestrator(host)
  cleanups.push(orchestrator.destroy)
  return { scene, host, simulation, ticker, stage, orchestrator }
}

describe("createRenderSceneOrchestrator", () => {
  beforeEach(() => { orchestratorTestState.reset() })

  it("leaves simulation playback advancement to the host scheduler", async () => {
    const { simulation, ticker, stage, orchestrator } = createOrchestratorTestHost("device", true)
    await simulation!.actions.start()
    expect(simulation!.state.runningState).toBe("start")
    const advancePlaybackByDeltaMs = vi.spyOn(simulation!.actions, "advancePlaybackByDeltaMs")
    expect(ticker.add).not.toHaveBeenCalled()
    expect(stage.addChild).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(advancePlaybackByDeltaMs).not.toHaveBeenCalled()
    orchestrator.destroy()
    expect(ticker.remove).not.toHaveBeenCalled()
  })

  it("reuses entity layout while runtime, animation, and sprite visuals keep separate invalidation paths", async () => {
    const { simulation, orchestrator } = createOrchestratorTestHost("device", true)
    await simulation!.actions.start()
    expect(simulation!.state.runningState).toBe("start")
    expect((await simulation!.internalActions.syncToTick(10)).status).toBe("ready")
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect((await simulation!.internalActions.syncToTick(11)).status).toBe("ready")
    orchestrator.sync({ nowMs: 1233.34, deltaMs: 16.67 })
    orchestratorTestState.invalidateVisualSync("entity-a")
    orchestrator.sync({ nowMs: 1250.01, deltaMs: 16.67 })
    expect(orchestratorTestState.getLayoutSyncs()).toEqual(["entity-a", "entity-a"])
    expect(orchestratorTestState.getRuntimeSyncs()).toEqual(["entity-a"])
    expect(orchestratorTestState.getAnimationSyncs()).toEqual(["entity-a", "entity-a", "entity-a", "entity-a"])
  })

  it("recreates an entity sprite when an entity keeps its id but changes definition", () => {
    const { scene, orchestrator } = createOrchestratorTestHost("device")
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(scene.editor.actions.replaceEntityDefinition("entity-a", "filling_pd_mc_1" )).toBe(true)
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "generic", entityId: "entity-a", definitionId: "storager_1" },
      { kind: "generic", entityId: "entity-a", definitionId: "filling_pd_mc_1" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([
      { kind: "generic", entityId: "entity-a", definitionId: "storager_1" },
    ])
  })

  it("keeps pipes above belts when entity order is reversed", () => {
    const { stage, orchestrator } = createOrchestratorTestHost("layers")
    const stageLayers = stage.addChild.mock.calls[0] ?? []
    const beltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
    const pipeLayer = stageLayers[5] as { readonly children: readonly unknown[] }
    const beltSubEntity = beltLayer.children[0]
    const pipeSubEntity = pipeLayer.children[2]
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "pipe", entityId: "pipe-entity", definitionId: "pipe_straight_1x1" },
      { kind: "belt", entityId: "belt-entity", definitionId: "belt_straight_1x1" },
    ])
    expect(orchestratorTestState.getAttachedSprites()).toEqual([
      { kind: "pipe", entityId: "pipe-entity", definitionId: "pipe_straight_1x1", entityLayer: pipeSubEntity },
      { kind: "belt", entityId: "belt-entity", definitionId: "belt_straight_1x1", entityLayer: beltSubEntity },
    ])
    expect(stageLayers.indexOf(beltLayer)).toBeLessThan(stageLayers.indexOf(pipeLayer))
  })

  it("reattaches a logistics draft belt sprite when the same id becomes a formal belt entity", () => {
    const { scene, stage, orchestrator } = createOrchestratorTestHost()
    expect(scene.editor.actions.createLogisticsDraftStart({ kind: "belt",
      source: { type: "empty-cell", gridPoint: { x: 0, y: 0 } } }).canApply).toBe(true)
    const beltEntityId = scene.editor.state.collections[EntityCollectionType.preview][0]!
    expect(beltEntityId).toBeTruthy()
    const stageLayers = stage.addChild.mock.calls[0] ?? []
    const logisticsBeltLayer = stageLayers[4] as { readonly children: readonly unknown[] }
    const beltSubEntity = logisticsBeltLayer.children[0]
    const draftLayer = stageLayers[6]
    orchestrator.sync({ nowMs: 1200, deltaMs: 16.67 })
    expect(scene.editor.actions.applyLogisticDraft()).toBe(true)
    expect(scene.editor.document.getSnapshot().entityOrder).toContain(beltEntityId)
    orchestrator.sync({ nowMs: 1216.67, deltaMs: 16.67 })
    expect(orchestratorTestState.getCreatedSprites()).toEqual([
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1" },
    ])
    expect(orchestratorTestState.getDestroyedSprites()).toEqual([])
    expect(orchestratorTestState.getAttachedSprites()).toMatchObject([
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1", entityLayer: draftLayer },
      { kind: "belt", entityId: beltEntityId, definitionId: "belt_straight_1x1", entityLayer: beltSubEntity },
    ])
  })

  it("samples placement glow from the explicit view time", () => {
    const { scene, host, orchestrator } = createOrchestratorTestHost()
    scene.canvas.actions.setActiveTool("single-placement")
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(host.dom.placementGlowOverlay.style.animationPlayState).toBe("paused")
    expect(host.dom.placementGlowOverlay.style.animationDelay).toBe("-1234ms")
    expect(orchestrator.needsContinuousFrame()).toBe(true)
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(host.dom.placementGlowOverlay.style.animationDelay).toBe("-1234ms")
    scene.canvas.actions.setActiveTool("select")
    orchestrator.sync({ nowMs: 1234, deltaMs: 0 })
    expect(orchestrator.needsContinuousFrame()).toBe(false)
  })
})
