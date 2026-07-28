import type {
  WorldEntity,
} from "@/domain/document/world-document"
import type { AppTheme } from "@/domain/app/types/theme"
import {
  EntityCollectionType,
  type EntityCollections,
  type EntityCollectionType as EntityCollectionTypeValue,
} from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RegistryQuery } from "@/domain/registry/registry-query"
import { LOGISTICS_KIND } from "@/domain/shared/logistics"
import {
  rotateGridRotation,
  resolveSpriteGridRect,
} from "@/shared/geometry/grid"
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform"
import type { GridEdge, GridPoint, GridRectSize, GridRotation } from "@/domain/shared/grid"
import type {
  LogisticsDraftReadonlyState,
  LogisticsKind,
} from "@/domain/shared/logistics"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import { resolveEffectiveCanvasTheme } from "@/shared/theme/canvas-theme"
import { createMemorySnapshotCollector, type MemorySnapshotCollector } from "./memory-monitor"
import {
  Container,
  UPDATE_PRIORITY,
} from "pixi.js"
import { resolveRenderResolutionFromApp } from "../render-resolution"
import {
  createPixiRenderDiagnostics,
  type PixiRenderDiagnosticsSnapshot,
} from "../pixi-render-diagnostics"
import type { RenderHost } from "../renderer-host"

import { BeltSprite } from "../sprites/belt-sprite"
import { GenericDeviceSprite } from "../sprites/generic-device-sprite"
import { PipeSprite } from "../sprites/pipe-sprite"
import {
  RenderLayerMap,
  RenderSprite,
  type RenderSpriteLayout,
  type RenderSpriteSyncContext,
  type RenderSpriteSyncVersions,
} from "../sprites/render-sprite"
import {
  type DecorationProfiler,
  type DecorationSyncContext,
  type RenderViewportState,
} from "./decorations/DecorationSyncContext"
import {
  resolveVisibleWorldRect,
  type VisibleWorldRect,
} from "./decorations/BeltVisualGeometry"
import { createGridLineDecoration } from "./decorations/GridLineDecoration"
import { createBaseBoundaryDecoration } from "./decorations/BaseBoundaryDecoration"
import { createBlueprintPlacementCanvasDecoration } from "./decorations/BlueprintPlacementCanvasDecoration"
import { createLogisticsPlacementCanvasDecoration } from "./decorations/LogisticsPlacementCanvasDecoration"
import { createLogisticsPlacementIdleCursorDecoration } from "./decorations/LogisticsPlacementIdleCursorDecoration"
import { createMarqueeRectDecoration } from "./decorations/MarqueeRectDecoration"
import { createMarqueeCanvasDecoration } from "./decorations/MarqueeCanvasDecoration"
import { createPreviewRectDecoration } from "./decorations/PreviewRectDecoration"
import { createInvalidPlacementDecoration } from "./decorations/InvalidPlacementDecoration"
import { createGrassBackgroundDecoration } from "./decorations/GrassBackgroundDecoration"
import { createBeltCargoDecoration } from "./decorations/BeltCargoDecoration"
import { createBeltPortInsertionDecoration } from "./decorations/BeltPortInsertionDecoration"
import { createBeltFlowDecoration } from "./decorations/BeltFlowDecoration"
import { createPipeFlowDecoration } from "./decorations/PipeFlowDecoration"
import { createPowerRangeDecoration } from "./decorations/PowerRangeDecoration"
import { createGasDiffusionRangeDecoration } from "./decorations/GasDiffusionRangeDecoration"
import { createDarkPipeLinkLineDecoration } from "./decorations/DarkPipeLinkLineDecoration"
import { createDarkPipeLinkSelectionDecoration } from "./decorations/DarkPipeLinkSelectionDecoration"
import { createHoverCornersDecoration } from "./decorations/HoverCornersDecoration"
import { createPortOverlayDecoration } from "./decorations/PortOverlayDecoration"
import { createPipePortGhostDecoration } from "./decorations/PipePortGhostDecoration"
import { createAdmissionItemIconDecoration } from "./decorations/AdmissionItemIconDecoration"

const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4
const RENDER_PERF_LOG_WINDOW_MS = 10_000
const RENDER_PERF_LONG_FRAME_MS = 50
const RENDER_PERF_TOP_STAGE_COUNT = 12
const PIXI_RENDER_START_PRIORITY = UPDATE_PRIORITY.LOW + 1
const PIXI_RENDER_FINISH_PRIORITY = UPDATE_PRIORITY.LOW - 1
const RENDER_INVALIDATION_COLLECTION_TYPES: readonly EntityCollectionTypeValue[] = [
  EntityCollectionType.selection,
  EntityCollectionType.marquee,
  EntityCollectionType.reverseMarquee,
  EntityCollectionType.preview,
  EntityCollectionType.ghost,
  EntityCollectionType.logisticsHead,
  EntityCollectionType.powered,
  EntityCollectionType.invalidPlacement,
]

/** 渲染低层设备定义 ID —— 先渲染，被其他设备覆盖 */
/** AI-CORRECTION 2026-07-19: 设备定义 ID 已移除 item_/item_port_ 前缀。 */
const ENTITY_LOW_DEFINITION_IDS = new Set([
  "log_hongs_bus",         // 仓库存取线基段
  "log_hongs_bus_source",  // 源桩
])

/** 渲染高层设备定义 ID —— 最后渲染，覆盖其他设备 */
const ENTITY_HIGH_DEFINITION_IDS = new Set([
  "water_pump_1",          // 抽水泵
])

// AI-REMOVED 2026-07-27:
// Reason: renderer 不应维护传送带族和管道设备族 definition ID 集合。
// Trigger: 用户要求设备 ID 归 registry 内部常量所有，registry 外只使用 RegistryQuery。
// Evidence: RegistryQuery.isBeltFamily/isPipeFamily 已覆盖渲染分层。
// Replacement: selectRenderLayerMap / resolveEntitySpriteLayerKey 的 queries 参数。
// Risk: Low
// Human Review: Required
//
// Original code:
// const BELT_DEFINITION_IDS = new Set([
//   "belt_straight_1x1", "belt_turn_cw_1x1", "belt_turn_ccw_1x1",
//   "log_splitter", "log_converger", "log_connector", "log_admission",
// ])
// const PIPE_DEFINITION_IDS = new Set([
//   "pipe_straight_1x1", "pipe_turn_cw_1x1", "pipe_turn_ccw_1x1",
//   "pipe_splitter", "pipe_converger", "pipe_connector", "pipe_admission",
// ])

function selectRenderLayerMap(
  spriteLayerKey: EntitySpriteLayerKey,
  layers: RenderLayerMap,
  beltSubEntity: Container,
  pipeSubEntity: Container,
): RenderLayerMap {
  if (spriteLayerKey === "entityLow") {
    return { ...layers, entity: layers.entityLow }
  }
  if (spriteLayerKey === "entityHigh") {
    return { ...layers, entity: layers.entityHigh }
  }
  if (spriteLayerKey === LOGISTICS_KIND.belt) {
    return { ...layers, entity: beltSubEntity }
  }
  if (spriteLayerKey === LOGISTICS_KIND.pipe) {
    return { ...layers, entity: pipeSubEntity }
  }
  return layers
}

interface PerfAggregate {
  total: number;
  max: number;
  count: number;
}

interface RenderFrameProfiler extends DecorationProfiler {
  finishSceneSync(): void;
  startPixiRender(): void;
  finishPixiRender(): void;
  finishFrame(options: {
    activeTool: string;
  }): void;
}

interface EntitySpriteSyncStats {
  missingDefinitions: number;
  visibleEntities: number;
  hiddenEntities: number;
  createdSprites: number;
  destroyedSprites: number;
  recreatedSprites: number;
  syncLayoutCalls: number;
  syncRuntimeCalls: number;
  syncAnimationCalls: number;
}

interface EntitySpriteSyncCache {
  documentVersion: number;
  viewportVersion: number;
  collectionVersion: number;
  presentationVersion: number;
  simulationVersion: number;
  readonly layouts: Map<string, RenderSpriteLayout>;
  readonly visibility: Map<string, boolean>;
}

interface EntityGeometryStamp {
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: GridRotation;
  readonly layerKey: EntitySpriteLayerKey;
}

type EntitySpriteLayerKey =
  | "entityLow"
  | "entity"
  | "entityHigh"
  | LogisticsKind
  | "draft"

interface RenderFrameTimeState {
  nowMs: number;
  deltaMs: number;
}

interface AppWithLogisticsPlacementRuntime {
  internalState: {
    runtime: {
      logisticsPlacement: {
        kind: LogisticsKind | null;
      };
    };
  };
}

export interface RenderSceneOrchestrator {
  destroy(): void;
}

export function createRenderSceneOrchestrator(
  renderHost: RenderHost,
): RenderSceneOrchestrator {
  const app = renderHost.app
  const layers = createRenderLayers()
  // 物流子容器 — sprite 本体挂载点，在各自物流层的最底层
  const beltSubEntity = new Container()
  const pipeSubEntity = new Container()
  const gridDecoration = createGridLineDecoration()
  const baseBoundaryDecoration = createBaseBoundaryDecoration()
  const powerRangeDecoration = createPowerRangeDecoration()
  const gasDiffusionRangeDecoration = createGasDiffusionRangeDecoration()
  const previewRectDecoration = createPreviewRectDecoration()
  const invalidPlacementDecoration = createInvalidPlacementDecoration()
  const marqueeDecoration = createMarqueeRectDecoration()
  const marqueeCanvasDecoration = createMarqueeCanvasDecoration()
  const blueprintPlacementCanvasDecoration = createBlueprintPlacementCanvasDecoration()
  const logisticsPlacementCanvasDecoration = createLogisticsPlacementCanvasDecoration()
  const logisticsPlacementIdleCursorDecoration = createLogisticsPlacementIdleCursorDecoration()
  const hoverCornersDecoration = createHoverCornersDecoration()
  const portOverlayDecoration = createPortOverlayDecoration()
  const pipePortGhostDecoration = createPipePortGhostDecoration()
  const admissionItemIconDecoration = createAdmissionItemIconDecoration()
  const beltFlowDecoration = createBeltFlowDecoration()
  const pipeFlowDecoration = createPipeFlowDecoration()
  const darkPipeLinkLineDecoration = createDarkPipeLinkLineDecoration()
  const darkPipeLinkSelectionDecoration = createDarkPipeLinkSelectionDecoration()
  const beltPortInsertionDecoration = createBeltPortInsertionDecoration()
  const beltCargoDecoration = createBeltCargoDecoration()
  const beltFlowLayer = new Container()
  const pipeFlowLayer = new Container()
  const darkPipeLinkLineLayer = new Container()
  const beltInsertionLayer = new Container()
  const beltCargoOverlayLayer = new Container()
  const invalidPlacementOverlayLayer = new Container()
  const marqueeOverlayLayer = new Container()
  const entityDefinitionMap = createEntityDefinitionMap(renderHost)
  const entitySprites = new Map<string, RenderSprite>()
  const entitySpriteDefinitionIds = new Map<string, string>()
  const entitySpriteLayerKeys = new Map<string, EntitySpriteLayerKey>()
  const entityGeometryStamps = new Map<string, EntityGeometryStamp>()
  const entitySpriteSyncCache: EntitySpriteSyncCache = {
    documentVersion: -1,
    viewportVersion: -1,
    collectionVersion: -1,
    presentationVersion: -1,
    simulationVersion: -1,
    layouts: new Map(),
    visibility: new Map(),
  }
  const grassBackgroundDecoration = createGrassBackgroundDecoration(renderHost)
  const pixiRenderDiagnostics = createPixiRenderDiagnostics({
    app,
    layers: {
      stage: app.stage,
      pipeFlow: pipeFlowLayer,
      beltFlow: beltFlowLayer,
      beltInsertion: beltInsertionLayer,
      beltCargo: beltCargoOverlayLayer,
      entities: [
        layers.entityLow,
        layers.entity,
        layers.entityHigh,
        beltSubEntity,
        pipeSubEntity,
        layers.draft,
      ],
    },
  })
  const renderPerfDiagnostics = createRenderPerfDiagnostics(
    renderHost,
    () => pixiRenderDiagnostics.readSnapshot(),
  )
  let activeFrameProfiler: RenderFrameProfiler | null = null
  let documentVersion = 0
  let viewportVersion = 0
  let collectionVersion = 0
  let presentationVersion = 0
  let simulationVersion = 0
  let lastViewportState: RenderViewportState | null = null
  let lastPresentationSignature: string | null = null
  let lastSimulationSignature: string | null = null
  const collectionSnapshots = new Map<string, readonly string[]>()
  const disposeDocumentVersionSubscription = renderHost.workspace.editor?.document?.subscribe?.(() => {
    documentVersion += 1
  }) ?? (() => undefined)
  const memoryCollector: MemorySnapshotCollector = createMemorySnapshotCollector(
    app,
    (snap) => {
      console.debug("[memory-monitor] " + JSON.stringify(snap))
    },
  )

  // 物流端口占用缓存：entityId → 已连接端口键集合("portGroupId:portId")
  // 仅当 entityOrder 长度或 draft 指纹变化时重新计算
  let portOccupancyCacheEntityCount = -1;
  let portOccupancyCacheDraftFingerprint = "";
  let portOccupancyCache: ReadonlyMap<string, ReadonlySet<string>> | null = null;

  function resolveLogisticsPortOccupancy(
    entities: readonly WorldEntity[],
    definitionMap: Map<string, EntityDefinition>,
  ): ReadonlyMap<string, ReadonlySet<string>> | null {
    const app = renderHost.workspace.app;
    if (!app || app.state.activeTool !== "logistics-placement") {
      return null;
    }

    const draft = renderHost.workspace.editor?.queries?.resolveLogisticsDraftState?.() ?? null;
    const draftFp = draftFingerprintOf(draft);

    if (
      entities.length === portOccupancyCacheEntityCount
      && draftFp === portOccupancyCacheDraftFingerprint
      && portOccupancyCache !== null
    ) {
      return portOccupancyCache;
    }

    // 构建格点 → 实体映射
    const gridEntityMap = new Map<string, WorldEntity>();
    for (const entity of entities) {
      gridEntityMap.set(gridPointKey(entity.position), entity);
    }

    const occupancy = new Map<string, Set<string>>();

    for (const entity of entities) {
      const definition = definitionMap.get(entity.definitionId);
      if (
        !definition
        || isLogisticsEntity(definition, renderHost.workspace.registry.queries)
      ) {
        continue;
      }

      const connectedKeys = new Set<string>();
      for (const portGroup of definition.portGroups) {
        for (const port of portGroup.ports) {
          const outsideCell = resolvePortOutsideGridPoint(entity, port, definition.footprint);
          const neighbor = gridEntityMap.get(gridPointKey(outsideCell));
          if (neighbor !== undefined) {
            const neighborDef = definitionMap.get(neighbor.definitionId);
            if (
              neighborDef !== undefined
              && isLogisticsEntity(neighborDef, renderHost.workspace.registry.queries)
            ) {
              connectedKeys.add(`${portGroup.id}:${port.id}`);
            }
          }
        }
      }

      if (connectedKeys.size > 0) {
        occupancy.set(entity.id, connectedKeys);
      }
    }

    // 虚影端点：仅 head 已拉出时纳入占用，idle 悬浮不隐藏端口箭头
    if (draft && draft.headDraftEntityId !== null) {
      addDraftPortToOccupancy(occupancy, draft.source);
      addDraftPortToOccupancy(occupancy, draft.target);
    }

    portOccupancyCacheEntityCount = entities.length;
    portOccupancyCacheDraftFingerprint = draftFp;
    portOccupancyCache = occupancy;
    return occupancy;
  }
  // AI-CORRECTION 2026-06-18:
  // 旧的“外侧格存在物流实体即视为占用”逻辑已由 PortOverlayDecoration 的合法引出判断替代。
  // 保留函数用于删除审计；禁止执行，避免与全局 decoration 重复扫描实体。
  void resolveLogisticsPortOccupancy;

  const flushViewport = (): void => {
    const frameStartedAtMs = performance.now()
    const frameProfiler = renderPerfDiagnostics.startFrame({
      startedAtMs: frameStartedAtMs,
      tickerDeltaMs: renderHost.app.ticker.deltaMS,
    })
    pixiRenderDiagnostics.syncDebugState(frameProfiler !== null)
    activeFrameProfiler = frameProfiler
    const viewportState = measureRenderStage(
      frameProfiler,
      "viewport.readState",
      () => readViewportState(renderHost),
    )
    const frameTime: RenderFrameTimeState = {
      nowMs: renderHost.app.ticker.lastTime,
      deltaMs: renderHost.app.ticker.deltaMS,
    }
    const workspaceApp = renderHost.workspace.app!
    const effectiveCanvasTheme = measureRenderStage(
      frameProfiler,
      "theme.resolveEffectiveCanvasTheme",
      () => resolveEffectiveCanvasTheme(
        workspaceApp.state.theme,
        workspaceApp.state.settings.gameUseBlueprintStyleDeviceImages,
      ),
    )

    measureRenderStage(frameProfiler, "renderer.domOverlays", () => {
      syncRendererDomOverlays(renderHost, effectiveCanvasTheme)
    })

    measureRenderStage(frameProfiler, "viewport.applySize", () => {
      applyViewportSize(app, viewportState)
    })
    measureRenderStage(frameProfiler, "simulation.advancePlayback", () => {
      void renderHost.workspace.simulation?.actions.advancePlaybackByDeltaMs(frameTime.deltaMs)
    })

    if (!areRenderViewportStatesEqual(lastViewportState, viewportState)) {
      lastViewportState = viewportState
      viewportVersion += 1
    }
    if (refreshCollectionSnapshots(
      renderHost.workspace.editor?.state.collections,
      collectionSnapshots,
    )) {
      collectionVersion += 1
    }

    const presentationSignature = createRenderPresentationSignature(renderHost)
    if (presentationSignature !== lastPresentationSignature) {
      lastPresentationSignature = presentationSignature
      presentationVersion += 1
    }

    const runtimeStatus = renderHost.workspace.simulation?.queries.getDocumentRuntimeStatus?.() ?? null
    const simulationSignature = createRenderSimulationSignature(renderHost, runtimeStatus?.tickNumber ?? null)
    if (simulationSignature !== lastSimulationSignature) {
      lastSimulationSignature = simulationSignature
      simulationVersion += 1
    }

    let frameVersions: RenderSpriteSyncVersions = {
      document: documentVersion,
      viewport: viewportVersion,
      collections: collectionVersion,
      presentation: presentationVersion,
      simulation: simulationVersion,
    }

    const ctx: DecorationSyncContext = {
      viewportState,
      viewportBounds: {
        left: 0,
        top: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      },
      renderHost,
      theme: effectiveCanvasTheme,
      nowMs: frameTime.nowMs,
      profiler: frameProfiler ?? undefined,
      versions: frameVersions,
    }

    measureRenderStage(frameProfiler, "decoration.grid", () => {
      gridDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.baseBoundary", () => {
      baseBoundaryDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.powerRange", () => {
      powerRangeDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.gasDiffusionRange", () => {
      gasDiffusionRangeDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.previewRect", () => {
      previewRectDecoration.sync(ctx)
    })

    const entities = measureRenderStage(
      frameProfiler,
      "editor.listEntities",
      () => renderHost.workspace.editor!.queries.listEntities(),
    )
    if (refreshEntityGeometryStamps(
      entities,
      entityGeometryStamps,
      renderHost.workspace.registry.queries,
    )) {
      documentVersion += 1
      frameVersions = {
        ...frameVersions,
        document: documentVersion,
      }
      ctx.versions = frameVersions
    }
    recordRenderFrameCounters(frameProfiler, renderHost, entities.length, entitySprites.size)

    const entitySpriteStats = measureRenderStage(frameProfiler, "entitySprites.sync", () =>
      syncWorldEntitySprites({
        renderHost,
        workspace: renderHost.workspace,
        entities,
        entityDefinitionMap,
        entitySprites,
        entitySpriteDefinitionIds,
        entitySpriteLayerKeys,
        layers,
        beltSubEntity,
        pipeSubEntity,
        viewportState,
        frameTime,
        viewportBounds: ctx.viewportBounds,
        theme: effectiveCanvasTheme,
        profiler: frameProfiler,
        logisticsPortOccupancy: null,
        versions: frameVersions,
        cache: entitySpriteSyncCache,
      }),
    )
    recordEntitySpriteSyncStats(frameProfiler, entitySpriteStats)

    measureRenderStage(frameProfiler, "decoration.invalidPlacement", () => {
      invalidPlacementDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.marqueeRect", () => {
      marqueeDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.marqueeCanvas", () => {
      marqueeCanvasDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.blueprintPlacementCanvas", () => {
      blueprintPlacementCanvasDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.logisticsPlacementCanvas", () => {
      logisticsPlacementCanvasDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.logisticsPlacementIdleCursor", () => {
      logisticsPlacementIdleCursorDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.hoverCorners", () => {
      hoverCornersDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.portOverlay", () => {
      portOverlayDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.pipePortGhost", () => {
      pipePortGhostDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.admissionItemIcon", () => {
      admissionItemIconDecoration.sync(ctx, entities)
    })

    measureRenderStage(frameProfiler, "decoration.beltFlow", () => {
      beltFlowDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.pipeFlow", () => {
      pipeFlowDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.darkPipeLinkLine", () => {
      darkPipeLinkLineDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.beltPortInsertion", () => {
      beltPortInsertionDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.beltCargo", () => {
      beltCargoDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.grassBackground", () => {
      grassBackgroundDecoration.sync(ctx)
    })

    measureRenderStage(frameProfiler, "decoration.darkPipeLinkSelection", () => {
      darkPipeLinkSelectionDecoration.sync(ctx)
    })

    frameProfiler?.finishSceneSync()

    // 内存快照：仅在 debugMode 下输出
    if (isRenderPerfDiagnosticsEnabled(renderHost)) {
      memoryCollector.tick(Date.now(), {
        "entities.total": entities.length,
        "sprites.liveBeforeSync": entitySprites.size,
      })
    }
  }

  const startPixiRenderMeasurement = (): void => {
    const frameProfiler = activeFrameProfiler
    pixiRenderDiagnostics.beforeRender(frameProfiler)
    frameProfiler?.startPixiRender()
  }

  const finishPixiRenderMeasurement = (): void => {
    const frameProfiler = activeFrameProfiler
    frameProfiler?.finishPixiRender()
    pixiRenderDiagnostics.afterRender(frameProfiler)
    activeFrameProfiler = null
    frameProfiler?.finishFrame({
      activeTool: readRenderActiveTool(renderHost),
    })
  }

  // 物流传送带层级（从底到顶）
  layers.logisticsBelt.addChild(beltSubEntity)
  layers.logisticsBelt.addChild(beltFlowLayer)
  layers.logisticsBelt.addChild(beltInsertionLayer)
  layers.logisticsBelt.addChild(beltCargoOverlayLayer)

  // 物流管道层级（从底到顶）
  layers.logisticsPipe.addChild(pipePortGhostDecoration.container)
  layers.logisticsPipe.addChild(pipeSubEntity)
  layers.logisticsPipe.addChild(pipeFlowLayer)
  layers.logisticsPipe.addChild(darkPipeLinkLineLayer)

  app.stage.addChild(
    layers.background,
    layers.entityLow,
    layers.entity,
    layers.entityHigh,
    layers.logisticsBelt,
    layers.logisticsPipe,
    layers.draft,
    layers.overlay,
    invalidPlacementOverlayLayer,
    marqueeOverlayLayer,
  )
  app.stage.addChildAt(grassBackgroundDecoration.container, 0)
  layers.background.addChild(gridDecoration.container)
  layers.background.addChild(baseBoundaryDecoration.container)
  layers.background.addChild(powerRangeDecoration.container)
  layers.background.addChild(gasDiffusionRangeDecoration.container)
  layers.background.addChild(previewRectDecoration.container)
  invalidPlacementOverlayLayer.addChild(invalidPlacementDecoration.container)
  beltFlowLayer.addChild(beltFlowDecoration.container)
  pipeFlowLayer.addChild(pipeFlowDecoration.container)
  darkPipeLinkLineLayer.addChild(darkPipeLinkLineDecoration.container)
  beltInsertionLayer.addChild(beltPortInsertionDecoration.container)
  beltCargoOverlayLayer.addChild(beltCargoDecoration.container)
  marqueeOverlayLayer.addChild(marqueeCanvasDecoration.container)
  marqueeOverlayLayer.addChild(blueprintPlacementCanvasDecoration.container)
  marqueeOverlayLayer.addChild(logisticsPlacementCanvasDecoration.container)
  marqueeOverlayLayer.addChild(logisticsPlacementIdleCursorDecoration.container)
  marqueeOverlayLayer.addChild(hoverCornersDecoration.container)
  marqueeOverlayLayer.addChild(portOverlayDecoration.container)
  marqueeOverlayLayer.addChild(admissionItemIconDecoration.container)
  marqueeOverlayLayer.addChild(marqueeDecoration.container)
  marqueeOverlayLayer.addChild(darkPipeLinkSelectionDecoration.container)
  app.ticker.add(flushViewport, undefined, UPDATE_PRIORITY.HIGH)
  app.ticker.add(startPixiRenderMeasurement, undefined, PIXI_RENDER_START_PRIORITY)
  app.ticker.add(finishPixiRenderMeasurement, undefined, PIXI_RENDER_FINISH_PRIORITY)

  const host: RenderSceneOrchestrator = {
    destroy: () => {
      app.ticker.remove(flushViewport)
      app.ticker.remove(startPixiRenderMeasurement)
      app.ticker.remove(finishPixiRenderMeasurement)
      disposeDocumentVersionSubscription()
      memoryCollector.stop()
      pixiRenderDiagnostics.destroy()

      for (const sprite of entitySprites.values()) {
        sprite.destroy()
      }

      entitySprites.clear()
      entitySpriteDefinitionIds.clear()
      entitySpriteLayerKeys.clear()
      entityGeometryStamps.clear()
      entitySpriteSyncCache.layouts.clear()
      entitySpriteSyncCache.visibility.clear()
      gridDecoration.destroy()
      baseBoundaryDecoration.destroy()
      powerRangeDecoration.destroy()
      gasDiffusionRangeDecoration.destroy()
      previewRectDecoration.destroy()
      invalidPlacementDecoration.destroy()
      marqueeDecoration.destroy()
      marqueeCanvasDecoration.destroy()
      blueprintPlacementCanvasDecoration.destroy()
      logisticsPlacementCanvasDecoration.destroy()
      logisticsPlacementIdleCursorDecoration.destroy()
      hoverCornersDecoration.destroy()
      portOverlayDecoration.destroy()
      pipePortGhostDecoration.destroy()
      admissionItemIconDecoration.destroy()
      beltFlowDecoration.destroy()
      pipeFlowDecoration.destroy()
      darkPipeLinkLineDecoration.destroy()
      darkPipeLinkSelectionDecoration.destroy()
      beltPortInsertionDecoration.destroy()
      beltCargoDecoration.destroy()
      layers.background.destroy({ children: true })
      layers.entityLow.destroy({ children: true })
      layers.entity.destroy({ children: true })
      layers.entityHigh.destroy({ children: true })
      layers.logisticsBelt.destroy({ children: true })
      layers.logisticsPipe.destroy({ children: true })
      layers.draft.destroy({ children: true })
      invalidPlacementOverlayLayer.destroy({ children: true })
      layers.overlay.destroy({ children: true })
      marqueeOverlayLayer.destroy({ children: true })
      grassBackgroundDecoration.destroy()
    },
  }

  return host
}

function createRenderLayers(): RenderLayerMap {
  return {
    background: new Container(),
    entityLow: new Container(),
    entity: new Container(),
    entityHigh: new Container(),
    logisticsBelt: new Container(),
    logisticsPipe: new Container(),
    draft: new Container(),
    overlay: new Container(),
  }
}

function syncRendererDomOverlays(
  renderHost: RenderHost,
  theme: AppTheme,
): void {
  const app = renderHost.workspace.app

  if (app === null) {
    renderHost.dom.placementGlowOverlay.classList.remove("is-active")
    renderHost.dom.blueprintGlowOverlay.classList.remove("is-active")
    renderHost.dom.marqueeGlowOverlay.classList.remove("is-active")
    return
  }

  const activeTool = app.state.activeTool
  const logisticsKind = resolveRendererLogisticsPlacementKind(renderHost)
  const isPlacementGlowActive = activeTool === "single-placement"
    || (activeTool === "logistics-placement" && logisticsKind !== null)
  const isBlueprintGlowActive = activeTool === "blueprint-placement"
  const isMarqueeGlowActive = activeTool === "marquee"

  renderHost.dom.placementGlowOverlay.classList.toggle("is-active", isPlacementGlowActive)
  renderHost.dom.blueprintGlowOverlay.classList.toggle("is-active", isBlueprintGlowActive)
  renderHost.dom.marqueeGlowOverlay.classList.toggle("is-active", isMarqueeGlowActive)

  const canvasLongerSide = Math.max(
    renderHost.app.renderer.width,
    renderHost.app.renderer.height,
  )
  const glowDepth = canvasLongerSide / 20
  const glowSpread = glowDepth / 2

  renderHost.dom.placementGlowOverlay.style.setProperty("--glow-depth", `${glowDepth}px`)
  renderHost.dom.placementGlowOverlay.style.setProperty("--glow-spread", `${glowSpread}px`)
  renderHost.dom.blueprintGlowOverlay.style.setProperty("--glow-depth", `${glowDepth}px`)
  renderHost.dom.blueprintGlowOverlay.style.setProperty("--glow-spread", `${glowSpread}px`)
  renderHost.dom.marqueeGlowOverlay.style.setProperty("--glow-depth", `${glowDepth}px`)
  renderHost.dom.marqueeGlowOverlay.style.setProperty("--glow-spread", `${glowSpread}px`)

  if (!isMarqueeGlowActive) {
    return
  }

  const marqueeGlowColor = resolveAppThemeColorNumber(
    theme,
    app.state.toolInfo.marqueeType === EntityCollectionType.marquee
      ? "accent"
      : "danger",
  )

  renderHost.dom.marqueeGlowOverlay.style.setProperty(
    "--industrial-planner-renderer-marquee-glow-rgb",
    formatCssRgbColor(marqueeGlowColor),
  )
}

function resolveRendererLogisticsPlacementKind(
  renderHost: RenderHost,
): LogisticsKind | null {
  const app = renderHost.workspace.app

  if (app === null || !("internalState" in app)) {
    return null
  }

  return (app as AppWithLogisticsPlacementRuntime)
    .internalState.runtime.logisticsPlacement.kind
}

function formatCssRgbColor(color: number): string {
  const red = (color >> 16) & 0xff
  const green = (color >> 8) & 0xff
  const blue = color & 0xff

  return `${red}, ${green}, ${blue}`
}

function createSpriteForDefinition(
  renderHost: RenderHost,
  entityId: string,
  definition: EntityDefinition,
): RenderSprite | null {
  if (renderHost.workspace.registry.queries.isDedicatedLogisticsDevice(definition.id)) {
    const dedicatedLogisticsKind = renderHost.workspace.registry.queries.resolveDedicatedLogisticsKind(definition.id)

    if (dedicatedLogisticsKind === LOGISTICS_KIND.belt) {
      return new BeltSprite(entityId, definition, renderHost)
    }

    return new PipeSprite(entityId, definition, renderHost)
  }

  return new GenericDeviceSprite(entityId, definition, renderHost)
}

export function applyViewportSize(
  app: RenderHost["app"],
  viewportSize: {
    width: number;
    height: number;
    resolution: number;
  },
): void {
  if (
    app.renderer.width === viewportSize.width
    && app.renderer.height === viewportSize.height
    && app.renderer.resolution === viewportSize.resolution
  ) {
    return
  }

  app.renderer.resize(
    viewportSize.width,
    viewportSize.height,
    viewportSize.resolution,
  )
}

function readViewportState(renderHost: RenderHost): RenderViewportState {
  const editor = renderHost.workspace.editor!

  return {
    width: resolveViewportAxisSize(
      editor.state.viewport.clientRect.width,
      renderHost.app.renderer.width,
    ),
    height: resolveViewportAxisSize(
      editor.state.viewport.clientRect.height,
      renderHost.app.renderer.height,
    ),
    resolution: resolveRenderResolutionFromApp(
      renderHost.workspace.app,
      renderHost.app.renderer.resolution,
    ),
    centerX: resolveViewportCoordinate(editor.state.viewport.center.x),
    centerY: resolveViewportCoordinate(editor.state.viewport.center.y),
    gridCellPixelSize: requireViewportGridCellPixelSize(
      editor.state.viewport.gridCellPixelSize,
    ),
    displayRotation: editor.state.viewport.displayRotation,
  }
}

function areRenderViewportStatesEqual(
  previous: RenderViewportState | null,
  next: RenderViewportState,
): boolean {
  return previous !== null
    && previous.width === next.width
    && previous.height === next.height
    && previous.resolution === next.resolution
    && previous.centerX === next.centerX
    && previous.centerY === next.centerY
    && previous.gridCellPixelSize === next.gridCellPixelSize
    && previous.displayRotation === next.displayRotation
}

function refreshCollectionSnapshots(
  collections: EntityCollections | undefined,
  snapshots: Map<string, readonly string[]>,
): boolean {
  if (collections === undefined) {
    const changed = snapshots.size !== 0
    snapshots.clear()
    return changed
  }

  let changed = snapshots.size !== RENDER_INVALIDATION_COLLECTION_TYPES.length
  for (const collectionType of RENDER_INVALIDATION_COLLECTION_TYPES) {
    const collection = collections[collectionType]
    const snapshot = snapshots.get(collectionType)
    if (
      snapshot === undefined
      || snapshot.length !== collection.length
      || snapshot.some((entityId, index) => entityId !== collection[index])
    ) {
      changed = true
    }
  }

  if (!changed) {
    return false
  }

  snapshots.clear()
  for (const collectionType of RENDER_INVALIDATION_COLLECTION_TYPES) {
    snapshots.set(collectionType, [...collections[collectionType]])
  }
  return true
}

function createRenderPresentationSignature(renderHost: RenderHost): string {
  const appState = renderHost.workspace.app?.state
  const editor = renderHost.workspace.editor
  const settings = appState?.settings
  const draft = editor?.queries.resolveLogisticsDraftState?.() ?? null

  return [
    settings?.locale,
    settings?.themeId,
    settings?.gameUseBlueprintStyleDeviceImages,
    settings?.gameShowDeviceNames,
    settings?.gameShowDeviceIcons,
    settings?.gameAlwaysShowGridLines,
    settings?.showGrassBackground,
    appState?.activeTool,
    appState?.toolInfo?.marqueeType,
    appState?.screenProfile?.deviceClass,
    editor?.state.suppressBelts,
    editor?.state.suppressPipes,
    draftFingerprintOf(draft),
    draft?.headDraftEntityId,
    draft?.invalidReason,
  ].join("|")
}

function createRenderSimulationSignature(
  renderHost: RenderHost,
  tickNumber: number | null,
): string {
  const simulationState = renderHost.workspace.simulation?.state
  if (simulationState === undefined || typeof simulationState !== "object") {
    return `${tickNumber ?? "none"}`
  }

  return [
    simulationState.runningState,
    tickNumber ?? "none",
    simulationState.timeline?.cursorTickNumber ?? "none",
    simulationState.timeline?.readiness ?? "none",
    simulationState.timeline?.isSeeking ?? false,
  ].join("|")
}

function refreshEntityGeometryStamps(
  entities: readonly WorldEntity[],
  stamps: Map<string, EntityGeometryStamp>,
  queries: RegistryQuery,
): boolean {
  let changed = stamps.size !== entities.length
  if (!changed) {
    for (const entity of entities) {
      const stamp = stamps.get(entity.id)
      if (
        stamp === undefined
        || stamp.definitionId !== entity.definitionId
        || stamp.x !== entity.position.x
        || stamp.y !== entity.position.y
        || stamp.rotation !== entity.rotation
        || stamp.layerKey !== resolveEntitySpriteLayerKey(entity, queries)
      ) {
        changed = true
        break
      }
    }
  }

  if (!changed) {
    return false
  }

  stamps.clear()
  for (const entity of entities) {
    stamps.set(entity.id, {
      definitionId: entity.definitionId,
      x: entity.position.x,
      y: entity.position.y,
      rotation: entity.rotation,
      layerKey: resolveEntitySpriteLayerKey(entity, queries),
    })
  }
  return true
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback
  }

  return Math.floor(value)
}

function resolveViewportCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value
}

function requireViewportGridCellPixelSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Renderer requires a positive viewport gridCellPixelSize.")
  }

  return value
}

function createEntityDefinitionMap(
  renderHost: RenderHost,
): Map<string, EntityDefinition> {
  return new Map(
    renderHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  )
}

// ---- 物流端口占用：纯工具函数（无闭包依赖）----

type PortGroupDefFromEntity = EntityDefinition["portGroups"][number];
type PortDefFromEntity = PortGroupDefFromEntity["ports"][number];

function gridPointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function isLogisticsEntity(
  definition: EntityDefinition,
  queries: RegistryQuery,
): boolean {
  return queries.isBeltFamily(definition.id) || queries.isPipeFamily(definition.id);
}

function resolvePortOutsideGridPoint(
  entity: WorldEntity,
  port: PortDefFromEntity,
  footprint: GridRectSize,
): GridPoint {
  const localCell = rotateLocalCell({
    footprint,
    localCellX: port.localCellX,
    localCellY: port.localCellY,
    rotation: entity.rotation,
  });
  const edge = rotateEdge(port.edge, entity.rotation);
  const delta = resolveEdgeDelta(edge);
  return {
    x: entity.position.x + localCell.x + delta.x,
    y: entity.position.y + localCell.y + delta.y,
  };
}

function rotateLocalCell(options: {
  footprint: GridRectSize;
  localCellX: number;
  localCellY: number;
  rotation: GridRotation;
}): GridPoint {
  const { footprint, localCellX, localCellY, rotation } = options;
  switch (rotation) {
    case 0: return { x: localCellX, y: localCellY };
    case 90: return { x: footprint.height - 1 - localCellY, y: localCellX };
    case 180: return { x: footprint.width - 1 - localCellX, y: footprint.height - 1 - localCellY };
    case 270: return { x: localCellY, y: footprint.width - 1 - localCellX };
  }
}

const EDGE_ROTATION_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

function rotateEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const steps = rotation / 90;
  const idx = EDGE_ROTATION_ORDER.indexOf(edge);
  return EDGE_ROTATION_ORDER[(idx + steps) % EDGE_ROTATION_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH": return { x: 0, y: -1 };
    case "EAST": return { x: 1, y: 0 };
    case "SOUTH": return { x: 0, y: 1 };
    case "WEST": return { x: -1, y: 0 };
  }
}

function draftFingerprintOf(draft: LogisticsDraftReadonlyState | null | undefined): string {
  if (!draft) return "";
  const src = draft.source?.type === "device-port"
    ? `${draft.source.entityId}/${draft.source.portGroupId}/${draft.source.portId}`
    : "none";
  const tgt = draft.target?.type === "device-port"
    ? `${draft.target.entityId}/${draft.target.portGroupId}/${draft.target.portId}`
    : "none";
  return `${draft.kind}|${src}|${tgt}`;
}

function addDraftPortToOccupancy(
  occupancy: Map<string, Set<string>>,
  endpoint: LogisticsDraftReadonlyState["source"],
): void {
  if (!endpoint || endpoint.type !== "device-port") return;
  const keys = occupancy.get(endpoint.entityId);
  if (keys) {
    keys.add(`${endpoint.portGroupId}:${endpoint.portId}`);
  } else {
    occupancy.set(endpoint.entityId, new Set([`${endpoint.portGroupId}:${endpoint.portId}`]));
  }
}

function syncWorldEntitySprites(options: {
  renderHost: RenderHost;
  workspace: RenderHost["workspace"];
  entities: readonly WorldEntity[];
  entityDefinitionMap: Map<string, EntityDefinition>;
  entitySprites: Map<string, RenderSprite>;
  entitySpriteDefinitionIds: Map<string, string>;
  entitySpriteLayerKeys: Map<string, EntitySpriteLayerKey>;
  layers: RenderLayerMap;
  beltSubEntity: Container;
  pipeSubEntity: Container;
  viewportState: RenderViewportState;
  frameTime: RenderFrameTimeState;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  theme: AppTheme;
  logisticsPortOccupancy: ReadonlyMap<string, ReadonlySet<string>> | null;
  profiler: DecorationProfiler | null;
  versions: RenderSpriteSyncVersions;
  cache: EntitySpriteSyncCache;
}): EntitySpriteSyncStats | null {
  const stats: EntitySpriteSyncStats | null = options.profiler === null
    ? null
    : {
        missingDefinitions: 0,
        visibleEntities: 0,
        hiddenEntities: 0,
        createdSprites: 0,
        destroyedSprites: 0,
        recreatedSprites: 0,
        syncLayoutCalls: 0,
        syncRuntimeCalls: 0,
        syncAnimationCalls: 0,
      }
  const spriteContext: RenderSpriteSyncContext = {
    theme: options.theme,
    workspace: options.workspace,
    time: options.frameTime,
    suppressBelts: options.workspace.editor?.state.suppressBelts ?? false,
    suppressPipes: options.workspace.editor?.state.suppressPipes ?? false,
    logisticsPortOccupancy: options.logisticsPortOccupancy,
    portOverlayManagedGlobally: true,
    versions: options.versions,
  }
  const layoutInvalidated =
    options.cache.documentVersion !== options.versions.document
    || options.cache.viewportVersion !== options.versions.viewport
    || options.cache.collectionVersion !== options.versions.collections
    || options.cache.presentationVersion !== options.versions.presentation
  const simulationInvalidated = options.cache.simulationVersion !== options.versions.simulation

  if (!layoutInvalidated) {
    for (const [entityId, sprite] of options.entitySprites) {
      const isVisible = options.cache.visibility.get(entityId) === true
      if (stats !== null) {
        if (isVisible) {
          stats.visibleEntities += 1
        } else {
          stats.hiddenEntities += 1
        }
      }
      if (!isVisible) {
        continue
      }

      const layout = options.cache.layouts.get(entityId)
      if (layout === undefined) {
        continue
      }
      if (simulationInvalidated && sprite.syncRuntime !== undefined) {
        sprite.syncRuntime(layout, spriteContext)
        if (stats !== null) {
          stats.syncRuntimeCalls += 1
        }
      }
      if (sprite.syncAnimation !== undefined) {
        sprite.syncAnimation(spriteContext)
        if (stats !== null) {
          stats.syncAnimationCalls += 1
        }
      }
    }

    options.cache.simulationVersion = options.versions.simulation
    return stats
  }

  const nextEntityIds = new Set<string>()
  const visibleRect = measureRenderStage(
    options.profiler,
    "entitySprites.resolveVisibleWorldRect",
    () => resolveVisibleWorldRect(options.viewportState, options.viewportBounds),
  )

  for (const entity of options.entities) {
    const definition = options.entityDefinitionMap.get(entity.definitionId)
    if (!definition) {
      if (stats !== null) {
        stats.missingDefinitions += 1
      }
      continue
    }

    let sprite: RenderSprite | null = options.entitySprites.get(entity.id) ?? null
    if (
      sprite !== null
      && options.entitySpriteDefinitionIds.get(entity.id) !== entity.definitionId
    ) {
      sprite.destroy()
      options.entitySprites.delete(entity.id)
      options.entitySpriteDefinitionIds.delete(entity.id)
      options.entitySpriteLayerKeys.delete(entity.id)
      options.cache.layouts.delete(entity.id)
      options.cache.visibility.delete(entity.id)
      sprite = null
      if (stats !== null) {
        stats.destroyedSprites += 1
        stats.recreatedSprites += 1
      }
    }

    const spriteLayerKey = resolveEntitySpriteLayerKey(
      entity,
      options.renderHost.workspace.registry.queries,
    )

    const effectiveOffset = resolveEffectiveSpriteOffset(
      definition.spriteOffset,
      options.renderHost.workspace.app,
    )
    const isVisible = isWorldEntityVisibleWithOffset(
      entity,
      definition.footprint,
      effectiveOffset,
      visibleRect,
    )
    options.cache.visibility.set(entity.id, isVisible)

    if (!isVisible) {
      if (stats !== null) {
        stats.hiddenEntities += 1
      }
      // 离屏实体的 sprite 保留但隐藏，避免反复创建/销毁
      if (sprite !== null) {
        syncEntitySpriteLayer({
          entity,
          sprite,
          spriteLayerKey,
          layers: options.layers,
          beltSubEntity: options.beltSubEntity,
          pipeSubEntity: options.pipeSubEntity,
          entitySpriteLayerKeys: options.entitySpriteLayerKeys,
        })
        sprite.setVisible(false)
      }
      nextEntityIds.add(entity.id)
      continue
    }

    if (stats !== null) {
      stats.visibleEntities += 1
    }

    if (!sprite) {
      sprite = createSpriteForDefinition(options.renderHost, entity.id, definition)
      if (sprite === null) {
        continue
      }

      syncEntitySpriteLayer({
        entity,
        sprite,
        spriteLayerKey,
        layers: options.layers,
        beltSubEntity: options.beltSubEntity,
        pipeSubEntity: options.pipeSubEntity,
        entitySpriteLayerKeys: options.entitySpriteLayerKeys,
      })
      options.entitySprites.set(entity.id, sprite)
      options.entitySpriteDefinitionIds.set(entity.id, entity.definitionId)
      if (stats !== null) {
        stats.createdSprites += 1
      }
    } else {
      syncEntitySpriteLayer({
        entity,
        sprite,
        spriteLayerKey,
        layers: options.layers,
        beltSubEntity: options.beltSubEntity,
        pipeSubEntity: options.pipeSubEntity,
        entitySpriteLayerKeys: options.entitySpriteLayerKeys,
      })
    }

    sprite.setVisible(true)
    if (stats !== null) {
      stats.syncLayoutCalls += 1
    }
    const layout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      spriteOffset: effectiveOffset,
      viewportBounds: options.viewportBounds,
      viewportCenter: {
        x: options.viewportState.centerX,
        y: options.viewportState.centerY,
      },
      gridCellPixelSize: options.viewportState.gridCellPixelSize,
      displayRotation: options.viewportState.displayRotation,
    })
    options.cache.layouts.set(entity.id, layout)
    sprite.syncLayout(layout, spriteContext)
    if (sprite.syncAnimation !== undefined) {
      sprite.syncAnimation(spriteContext)
      if (stats !== null) {
        stats.syncAnimationCalls += 1
      }
    }
    nextEntityIds.add(entity.id)
  }

  for (const [entityId, sprite] of options.entitySprites) {
    if (nextEntityIds.has(entityId)) {
      continue
    }

    sprite.destroy()
    options.entitySprites.delete(entityId)
    options.entitySpriteDefinitionIds.delete(entityId)
    options.entitySpriteLayerKeys.delete(entityId)
    options.cache.layouts.delete(entityId)
    options.cache.visibility.delete(entityId)
    if (stats !== null) {
      stats.destroyedSprites += 1
    }
  }

  options.cache.documentVersion = options.versions.document
  options.cache.viewportVersion = options.versions.viewport
  options.cache.collectionVersion = options.versions.collections
  options.cache.presentationVersion = options.versions.presentation
  options.cache.simulationVersion = options.versions.simulation

  return stats
}

function resolveEntitySpriteLayerKey(
  entity: WorldEntity,
  queries: RegistryQuery,
): EntitySpriteLayerKey {
  if ("originalEntityId" in entity) {
    return "draft"
  }
  if (ENTITY_LOW_DEFINITION_IDS.has(entity.definitionId)) {
    return "entityLow"
  }
  if (ENTITY_HIGH_DEFINITION_IDS.has(entity.definitionId)) {
    return "entityHigh"
  }
  if (queries.isBeltFamily(entity.definitionId)) {
    return LOGISTICS_KIND.belt
  }
  if (queries.isPipeFamily(entity.definitionId)) {
    return LOGISTICS_KIND.pipe
  }
  return "entity"
}

function syncEntitySpriteLayer(options: {
  entity: WorldEntity;
  sprite: RenderSprite;
  spriteLayerKey: EntitySpriteLayerKey;
  layers: RenderLayerMap;
  beltSubEntity: Container;
  pipeSubEntity: Container;
  entitySpriteLayerKeys: Map<string, EntitySpriteLayerKey>;
}): void {
  if (options.entitySpriteLayerKeys.get(options.entity.id) === options.spriteLayerKey) {
    return
  }

  let layerMap = selectRenderLayerMap(
    options.spriteLayerKey,
    options.layers,
    options.beltSubEntity,
    options.pipeSubEntity,
  )
  if (options.spriteLayerKey === "draft") {
    layerMap = { ...layerMap, entity: options.layers.draft }
  }

  options.sprite.attach(layerMap)
  options.entitySpriteLayerKeys.set(options.entity.id, options.spriteLayerKey)
}

function measureRenderStage<T>(
  profiler: DecorationProfiler | null,
  stage: string,
  callback: () => T,
): T {
  if (profiler === null) {
    return callback()
  }

  return profiler.measure(stage, callback)
}

function recordRenderFrameCounters(
  profiler: DecorationProfiler | null,
  renderHost: RenderHost,
  totalEntities: number,
  liveSpriteCount: number,
): void {
  if (profiler === null) {
    return
  }

  profiler.count("entities.total", totalEntities)
  profiler.count("sprites.liveBeforeSync", liveSpriteCount)

  const editor = renderHost.workspace.editor
  if (editor === null) {
    return
  }

  const collections = editor.state.collections
  profiler.count("collection.selection", collections[EntityCollectionType.selection]?.length ?? 0)
  profiler.count("collection.preview", collections[EntityCollectionType.preview]?.length ?? 0)
  profiler.count("collection.ghost", collections[EntityCollectionType.ghost]?.length ?? 0)
  profiler.count("collection.invalidPlacement", collections[EntityCollectionType.invalidPlacement]?.length ?? 0)
  profiler.count("collection.logisticsHead", collections[EntityCollectionType.logisticsHead]?.length ?? 0)
}

function recordEntitySpriteSyncStats(
  profiler: DecorationProfiler | null,
  stats: EntitySpriteSyncStats | null,
): void {
  if (profiler === null || stats === null) {
    return
  }

  profiler.count("entitySprites.missingDefinitions", stats.missingDefinitions)
  profiler.count("entitySprites.visibleEntities", stats.visibleEntities)
  profiler.count("entitySprites.hiddenEntities", stats.hiddenEntities)
  profiler.count("entitySprites.createdSprites", stats.createdSprites)
  profiler.count("entitySprites.destroyedSprites", stats.destroyedSprites)
  profiler.count("entitySprites.recreatedSprites", stats.recreatedSprites)
  profiler.count("entitySprites.syncLayoutCalls", stats.syncLayoutCalls)
  profiler.count("entitySprites.syncRuntimeCalls", stats.syncRuntimeCalls)
  profiler.count("entitySprites.syncAnimationCalls", stats.syncAnimationCalls)
}

function createRenderPerfDiagnostics(
  renderHost: RenderHost,
  readPixiDiagnostics: () => PixiRenderDiagnosticsSnapshot,
): {
  startFrame(options: {
    startedAtMs: number;
    tickerDeltaMs: number;
  }): RenderFrameProfiler | null;
} {
  const stageAggregates = new Map<string, PerfAggregate>()
  const countAggregates = new Map<string, PerfAggregate>()
  const activeToolFrameCounts = new Map<string, number>()
  let windowStartedAtMs = 0
  let previousFrameStartedAtMs: number | null = null
  let frameCount = 0
  let frameIntervalCount = 0
  let totalFrameIntervalMs = 0
  let maxFrameIntervalMs = 0
  let totalTickerDeltaMs = 0
  let maxTickerDeltaMs = 0
  let totalRenderSelfMs = 0
  let maxRenderSelfMs = 0
  let totalSceneToPixiRenderMs = 0
  let maxSceneToPixiRenderMs = 0
  let totalPixiRenderMs = 0
  let maxPixiRenderMs = 0
  let totalTickerWorkMs = 0
  let maxTickerWorkMs = 0
  let longFrameCount = 0

  const resetWindow = (): void => {
    stageAggregates.clear()
    countAggregates.clear()
    activeToolFrameCounts.clear()
    windowStartedAtMs = 0
    previousFrameStartedAtMs = null
    frameCount = 0
    frameIntervalCount = 0
    totalFrameIntervalMs = 0
    maxFrameIntervalMs = 0
    totalTickerDeltaMs = 0
    maxTickerDeltaMs = 0
    totalRenderSelfMs = 0
    maxRenderSelfMs = 0
    totalSceneToPixiRenderMs = 0
    maxSceneToPixiRenderMs = 0
    totalPixiRenderMs = 0
    maxPixiRenderMs = 0
    totalTickerWorkMs = 0
    maxTickerWorkMs = 0
    longFrameCount = 0
  }

  return {
    startFrame(options): RenderFrameProfiler | null {
      if (!isRenderPerfDiagnosticsEnabled(renderHost)) {
        if (frameCount > 0) {
          resetWindow()
        }
        return null
      }

      if (windowStartedAtMs === 0) {
        windowStartedAtMs = options.startedAtMs
      }

      let sceneSyncFinishedAtMs: number | null = null
      let pixiRenderStartedAtMs: number | null = null
      let pixiRenderFinishedAtMs: number | null = null
      const profiler: RenderFrameProfiler = {
        count(name, value = 1): void {
          addPerfSample(countAggregates, name, value)
        },
        measure(stage, callback) {
          const stageStartedAtMs = performance.now()
          try {
            return callback()
          } finally {
            addPerfSample(stageAggregates, stage, performance.now() - stageStartedAtMs)
          }
        },
        finishSceneSync(): void {
          sceneSyncFinishedAtMs = performance.now()
        },
        startPixiRender(): void {
          pixiRenderStartedAtMs = performance.now()
        },
        finishPixiRender(): void {
          pixiRenderFinishedAtMs = performance.now()
        },
        finishFrame({ activeTool }): void {
          const finishedAtMs = pixiRenderFinishedAtMs ?? performance.now()
          const effectiveSceneSyncFinishedAtMs = sceneSyncFinishedAtMs ?? finishedAtMs
          const effectivePixiRenderStartedAtMs = pixiRenderStartedAtMs
            ?? effectiveSceneSyncFinishedAtMs
          const renderSelfMs = effectiveSceneSyncFinishedAtMs - options.startedAtMs
          const sceneToPixiRenderMs = Math.max(
            0,
            effectivePixiRenderStartedAtMs - effectiveSceneSyncFinishedAtMs,
          )
          const pixiRenderMs = Math.max(0, finishedAtMs - effectivePixiRenderStartedAtMs)
          const tickerWorkMs = finishedAtMs - options.startedAtMs
          const frameIntervalMs = previousFrameStartedAtMs === null
            ? null
            : options.startedAtMs - previousFrameStartedAtMs

          previousFrameStartedAtMs = options.startedAtMs
          frameCount += 1
          totalTickerDeltaMs += options.tickerDeltaMs
          maxTickerDeltaMs = Math.max(maxTickerDeltaMs, options.tickerDeltaMs)
          totalRenderSelfMs += renderSelfMs
          maxRenderSelfMs = Math.max(maxRenderSelfMs, renderSelfMs)
          totalSceneToPixiRenderMs += sceneToPixiRenderMs
          maxSceneToPixiRenderMs = Math.max(maxSceneToPixiRenderMs, sceneToPixiRenderMs)
          totalPixiRenderMs += pixiRenderMs
          maxPixiRenderMs = Math.max(maxPixiRenderMs, pixiRenderMs)
          totalTickerWorkMs += tickerWorkMs
          maxTickerWorkMs = Math.max(maxTickerWorkMs, tickerWorkMs)
          addPerfSample(stageAggregates, "pixi.renderer.render", pixiRenderMs)
          activeToolFrameCounts.set(
            activeTool,
            (activeToolFrameCounts.get(activeTool) ?? 0) + 1,
          )

          if (frameIntervalMs !== null) {
            frameIntervalCount += 1
            totalFrameIntervalMs += frameIntervalMs
            maxFrameIntervalMs = Math.max(maxFrameIntervalMs, frameIntervalMs)
            if (frameIntervalMs >= RENDER_PERF_LONG_FRAME_MS) {
              longFrameCount += 1
            }
          }

          const windowMs = finishedAtMs - windowStartedAtMs
          if (windowMs < RENDER_PERF_LOG_WINDOW_MS) {
            return
          }

          console.debug("[render-perf] " + JSON.stringify({
            windowMs: roundPerfValue(windowMs),
            fps: roundPerfValue((frameCount * 1000) / windowMs),
            activeTool: resolveDominantActiveTool(activeToolFrameCounts),
            activeToolFrames: summarizeFrameCounts(activeToolFrameCounts),
            renderer: readPixiDiagnostics(),
            frame: {
              frames: frameCount,
              longFrames: longFrameCount,
              avgIntervalMs: roundPerfValue(safeAverage(totalFrameIntervalMs, frameIntervalCount)),
              maxIntervalMs: roundPerfValue(maxFrameIntervalMs),
              avgTickerDeltaMs: roundPerfValue(safeAverage(totalTickerDeltaMs, frameCount)),
              maxTickerDeltaMs: roundPerfValue(maxTickerDeltaMs),
              avgRenderSelfMs: roundPerfValue(safeAverage(totalRenderSelfMs, frameCount)),
              maxRenderSelfMs: roundPerfValue(maxRenderSelfMs),
              avgSceneSyncMs: roundPerfValue(safeAverage(totalRenderSelfMs, frameCount)),
              maxSceneSyncMs: roundPerfValue(maxRenderSelfMs),
              avgSceneToPixiRenderMs: roundPerfValue(
                safeAverage(totalSceneToPixiRenderMs, frameCount),
              ),
              maxSceneToPixiRenderMs: roundPerfValue(maxSceneToPixiRenderMs),
              avgPixiRenderMs: roundPerfValue(safeAverage(totalPixiRenderMs, frameCount)),
              maxPixiRenderMs: roundPerfValue(maxPixiRenderMs),
              avgTickerWorkMs: roundPerfValue(safeAverage(totalTickerWorkMs, frameCount)),
              maxTickerWorkMs: roundPerfValue(maxTickerWorkMs),
              avgIntervalMinusRenderSelfMs: roundPerfValue(
                Math.max(
                  0,
                  safeAverage(totalFrameIntervalMs, frameIntervalCount)
                    - safeAverage(totalRenderSelfMs, frameCount),
                ),
              ),
              avgIntervalMinusTickerWorkMs: roundPerfValue(
                Math.max(
                  0,
                  safeAverage(totalFrameIntervalMs, frameIntervalCount)
                    - safeAverage(totalTickerWorkMs, frameCount),
                ),
              ),
            },
            counts: summarizePerfAggregates(countAggregates, countAggregates.size),
            stages: summarizePerfAggregates(stageAggregates, RENDER_PERF_TOP_STAGE_COUNT),
          }))
          resetWindow()
        },
      }

      return profiler
    },
  }
}

function isRenderPerfDiagnosticsEnabled(renderHost: RenderHost): boolean {
  return renderHost.workspace.app?.state.settings.debugMode === true
}

function readRenderActiveTool(renderHost: RenderHost): string {
  return renderHost.workspace.app?.state.activeTool ?? "unknown"
}

function addPerfSample(
  aggregates: Map<string, PerfAggregate>,
  name: string,
  value: number,
): void {
  const aggregate = aggregates.get(name)
  if (aggregate === undefined) {
    aggregates.set(name, {
      total: value,
      max: value,
      count: 1,
    })
    return
  }

  aggregate.total += value
  aggregate.max = Math.max(aggregate.max, value)
  aggregate.count += 1
}

function summarizePerfAggregates(
  aggregates: Map<string, PerfAggregate>,
  limit: number,
): Array<{
  name: string;
  avg: number;
  max: number;
  total: number;
  samples: number;
}> {
  return Array.from(aggregates.entries())
    .map(([name, aggregate]) => ({
      name,
      avg: roundPerfValue(safeAverage(aggregate.total, aggregate.count)),
      max: roundPerfValue(aggregate.max),
      total: roundPerfValue(aggregate.total),
      samples: aggregate.count,
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, limit)
}

function summarizeFrameCounts(
  counts: Map<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Array.from(counts.entries()).sort((left, right) => right[1] - left[1]),
  )
}

function resolveDominantActiveTool(counts: Map<string, number>): string {
  let dominantTool = "unknown"
  let dominantCount = 0

  for (const [tool, count] of counts) {
    if (count <= dominantCount) {
      continue
    }

    dominantTool = tool
    dominantCount = count
  }

  return dominantTool
}

function safeAverage(total: number, count: number): number {
  if (count <= 0) {
    return 0
  }

  return total / count
}

function roundPerfValue(value: number): number {
  return Math.round(value * 100) / 100
}

export function resolveWorldEntitySelectionStrokeWidth(
  gridCellPixelSize: number,
): number {
  const width = gridCellPixelSize / 8

  return Math.max(
    WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
    Math.min(WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH, width),
  )
}

export function resolveWorldEntitySelectionStrokeStyle(options: {
  theme: AppTheme;
  gridCellPixelSize: number;
}): {
  width: number;
  color: number;
} {
  return {
    width: resolveWorldEntitySelectionStrokeWidth(options.gridCellPixelSize),
    color: resolveAppThemeColorNumber(
      options.theme,
      options.theme.renderer.worldEntitySelectionStrokeColorKey,
    ),
  }
}

export function resolveWorldEntitySelectionOverlayLayouts(options: {
  entities: readonly WorldEntity[];
  entityDefinitionMap: Map<string, EntityDefinition>;
  selectedEntityIds: readonly string[];
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
  displayRotation?: GridRotation;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}[] {
  const selectedIds = new Set(options.selectedEntityIds)
  const layouts: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[] = []

  for (const entity of options.entities) {
    if (!selectedIds.has(entity.id)) {
      continue
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId)
    if (!definition) {
      continue
    }

    const layout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      viewportBounds: options.viewportBounds,
      viewportCenter: options.viewportCenter,
      gridCellPixelSize: options.gridCellPixelSize,
      displayRotation: options.displayRotation,
    })

    layouts.push({
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      rotation: layout.rotation,
    })
  }

  return layouts
}

export function resolveWorldEntitySpriteLayout(options: {
  entity: WorldEntity;
  footprint: GridRectSize;
  spriteOffset?: { x: number; y: number; width: number; height: number };
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
  displayRotation?: GridRotation;
}): RenderSpriteLayout {
  const gridCellSize = options.gridCellPixelSize

  const gridRect = resolveSpriteGridRect(
    options.entity.position,
    options.footprint,
    options.spriteOffset ?? null,
    options.entity.rotation,
  )

  const viewportRect = resolveViewportRectFromWorldGridRect({
    gridRect,
    viewportBounds: options.viewportBounds,
    viewportCenter: options.viewportCenter,
    gridCellPixelSize: gridCellSize,
    displayRotation: options.displayRotation,
  })

  if (viewportRect === null) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: rotateGridRotation(options.entity.rotation, options.displayRotation ?? 0),
    }
  }

  return {
    x: viewportRect.left,
    y: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    rotation: rotateGridRotation(options.entity.rotation, options.displayRotation ?? 0),
  }
}

/**
 * 根据当前渲染模式（蓝图 / 3D-top）解析有效的 spriteOffset。
 * gameUseBlueprintStyleDeviceImages=true 时使用 blueprint 偏移，否则使用 topView 偏移。
 */
function resolveEffectiveSpriteOffset(
  spriteOffset: EntityDefinition["spriteOffset"] | undefined,
  app: RenderHost["workspace"]["app"],
): { x: number; y: number; width: number; height: number } | undefined {
  if (!spriteOffset) {
    return undefined
  }

  const isBlueprint = app?.state.settings.gameUseBlueprintStyleDeviceImages ?? false
  return isBlueprint ? spriteOffset.blueprint : spriteOffset.topView
}

/**
 * 与 isWorldEntityVisible 逻辑相同，但支持可选的 spriteOffset。
 * 当 spriteOffset 不为 null 时，可见性以偏移扩展后的精灵矩形为准；
 * 否则以 footprint 为准（保持现有行为不变）。
 */
function isWorldEntityVisibleWithOffset(
  entity: WorldEntity,
  footprint: GridRectSize,
  spriteOffset: { x: number; y: number; width: number; height: number } | undefined,
  visibleRect: VisibleWorldRect,
): boolean {
  const rect = resolveSpriteGridRect(entity.position, footprint, spriteOffset ?? null, entity.rotation)
  return rect.x + rect.width > visibleRect.left
    && rect.x < visibleRect.right
    && rect.y + rect.height > visibleRect.top
    && rect.y < visibleRect.bottom
}
