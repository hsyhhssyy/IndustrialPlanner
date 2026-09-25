import type { BlueprintDocument } from "@/domain/document/blueprint-document"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document"
import type { AppContract } from "@/domain/app/app-contract"
import type { EditorContract } from "@/domain/editor/editor-contract"
import type { EditorState } from "@/domain/editor/editor-state"
import {
  EntityCollectionType,
  type EditorViewportState,
  type EntityCollection,
  type EntityCollections,
} from "@/domain/editor/types/editor-types"
import type { GridBounds } from "@/domain/shared/grid"

import type { RenderSurfaceContext } from "../render-surface-context"

interface MutableEditorViewportState {
  center: { x: number; y: number }
  clientRect: { left: number; top: number; width: number; height: number }
  gridSize: number
  gridCellPixelSize: number
  displayRotation: 0
}

export interface BlueprintPreviewSurfaceProjection {
  readonly renderContext: RenderSurfaceContext
  readonly workspace: WorkspaceContract
  readonly entities: readonly WorldEntity[]
  readonly viewport: MutableEditorViewportState
  setUserZoom(userZoom: number): void
}

export function createBlueprintPreviewSurfaceProjection(options: {
  readonly workspace: WorkspaceContract
  readonly blueprint: BlueprintDocument
  readonly bounds: GridBounds | null
  readonly highlightedEntityId: string | null
  readonly adaptiveDeviceLabels: boolean
  readonly initialUserZoom: number
  readonly renderContext: Omit<RenderSurfaceContext, "workspace">
}): BlueprintPreviewSurfaceProjection {
  const sourceApp = options.workspace.app
  if (sourceApp === null) {
    throw new Error("App host must be initialized before mounting a blueprint preview.")
  }

  const entities = options.blueprint.entityOrder
    .map((entityId) => options.blueprint.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined)
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const collections = createPreviewCollections(options.highlightedEntityId)
  const viewport: MutableEditorViewportState = {
    center: { x: 0, y: 0 },
    clientRect: { left: 0, top: 0, width: 1, height: 1 },
    gridSize: 1,
    gridCellPixelSize: 1,
    displayRotation: 0,
  }
  const worldDocument = createPreviewWorldDocument(options.blueprint)
  const documentStore = {
    getSnapshot: () => worldDocument,
    subscribe: () => () => undefined,
  }
  const editorState: EditorState = {
    viewport: viewport as EditorViewportState,
    marqueeGridRect: null,
    history: {} as EditorState["history"],
    regionAnnotations: {
      selectedId: null,
      hoveredId: null,
      hiddenIds: [],
      draft: null,
      draftOperation: "add",
      draftMarqueeGridRect: null,
      placementPreview: [],
      moveFeedback: null,
    },
    collections,
    hoverTarget: null,
    suppressBelts: false,
    suppressPipes: false,
  }
  const editor = {
    document: documentStore,
    state: editorState,
    queries: {
      getEntityById: (entityId: string) => entityById.get(entityId) ?? null,
      listEntities: () => entities,
      listPowerRangeProvidersCoveringGridRect: () => [],
      findEntityAtClientPixelPoint: () => null,
      findEntityCollectionGridRect: () => options.bounds === null ? null : ({
        x: options.bounds.left,
        y: options.bounds.top,
        width: options.bounds.width,
        height: options.bounds.height,
      }),
      findEntityCollectionGeometry: () => null,
      getEntityPlacementValidation: () => ({ canPlace: true, reasons: [] }),
      findGridCellForClientPixelPoint: () => null,
      findClientRectForGridCell: () => null,
      resolveLogisticsDraftState: () => null,
      findLogisticsDraftEndpointAtGridPoint: () => null,
      canCreateLogisticsDraftStartHere: () => false,
      listBaseDocumentSummaries: async () => [],
      readLatestBaseDocuments: async () => [],
      // 蓝图不携带跨基地关系，预览没有区域文档集合或后台订阅。
      getRegionalDarkPipeLinks: () => [],
      subscribeBaseDocuments: () => () => undefined,
      findRegionEntityIds: () => [],
    },
    actions: {
      selectRegion: () => undefined,
    },
  } as unknown as EditorContract

  const previewPresentation = {
    userZoom: options.initialUserZoom,
  }
  const previewApp = createPreviewAppProjection(
    sourceApp,
    options.adaptiveDeviceLabels,
    () => previewPresentation.userZoom,
  )
  const surfaceWorkspace = new Proxy(options.workspace, {
    get: (target, property, receiver) => {
      if (property === "app") {
        return previewApp
      }
      if (property === "editor") {
        return editor
      }
      if (property === "simulation") {
        return null
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const renderContext: RenderSurfaceContext = {
    ...options.renderContext,
    workspace: surfaceWorkspace,
  }

  return {
    renderContext,
    workspace: surfaceWorkspace,
    entities,
    viewport,
    setUserZoom: (userZoom) => {
      previewPresentation.userZoom = userZoom
    },
  }
}

function createPreviewAppProjection(
  sourceApp: AppContract,
  adaptiveDeviceLabels: boolean,
  readUserZoom: () => number,
): AppContract {
  const settings = new Proxy(sourceApp.state.settings, {
    get: (target, property, receiver) => {
      switch (property) {
        case "gameAlwaysShowGridLines":
          return true
        case "gamePlayDeviceAnimations":
          return false
        case "gameShowDeviceIcons":
          return adaptiveDeviceLabels
        case "gameShowDeviceNames":
          return adaptiveDeviceLabels && readUserZoom() > 1
        case "gameUseBlueprintStyleDeviceImages":
          return true
        case "showGrassBackground":
          return false
        default:
          return Reflect.get(target, property, receiver)
      }
    },
  })
  const state = new Proxy(sourceApp.state, {
    get: (target, property, receiver) => {
      if (property === "activeTool") {
        return "select"
      }
      if (property === "moveKind") {
        return null
      }
      if (property === "settings") {
        return settings
      }
      return Reflect.get(target, property, receiver)
    },
  })

  return new Proxy(sourceApp, {
    get: (target, property, receiver) => property === "state"
      ? state
      : Reflect.get(target, property, receiver),
  })
}

function createPreviewCollections(
  highlightedEntityId: string | null,
): EntityCollections {
  return {
    [EntityCollectionType.selection]: createEntityCollection(
      highlightedEntityId === null ? [] : [highlightedEntityId],
    ),
    [EntityCollectionType.marquee]: createEntityCollection([]),
    [EntityCollectionType.reverseMarquee]: createEntityCollection([]),
    [EntityCollectionType.preview]: createEntityCollection([]),
    [EntityCollectionType.ghost]: createEntityCollection([]),
    [EntityCollectionType.logisticsHead]: createEntityCollection([]),
    [EntityCollectionType.powered]: createEntityCollection([]),
    [EntityCollectionType.invalidPlacement]: createEntityCollection([]),
  }
}

function createEntityCollection(entityIds: readonly string[]): EntityCollection {
  const collection = [...entityIds] as string[] & EntityCollection
  collection.contains = (entityId: string) => collection.includes(entityId)
  return collection
}

function createPreviewWorldDocument(blueprint: BlueprintDocument): WorldDocument {
  return {
    schemaVersion: blueprint.schemaVersion,
    documentKey: `blueprint-preview:${blueprint.blueprintId}`,
    baseId: blueprint.baseId,
    meta: {
      id: blueprint.blueprintId,
      name: blueprint.name,
      createdAt: blueprint.createdAt,
      updatedAt: blueprint.updatedAt,
    },
    entities: blueprint.entities,
    entityOrder: blueprint.entityOrder,
    slotLinks: blueprint.slotLinks,
    regions: blueprint.regions,
    documentSettings: {
      viewport: {
        center: { x: 0, y: 0 },
        gridSize: 1,
        displayRotation: 0,
      },
      powerMode: "infinite",
    },
  }
}
