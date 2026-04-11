import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STAGE1_BASE_ID } from "@/domain/base/stage1-bases";
import { getStage1EntityDefinition } from "@/domain/registry/stage1-registry";
import {
  getPendingLinkSourceEntityId,
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  resolveCenteredGridPoint,
  resolveCenteredRotatedGridPoint,
  rotateGridCenterCellsClockwise,
  type GridRotation,
} from "@/shared/geometry/grid";
import { createPlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";

function getPlacementMode(
  session: ReturnType<typeof createWorkbenchController>["editorStore"]["session"],
) {
  return isPlacementInteractionMode(session.currentMode)
    ? session.currentMode
    : null;
}

function getMoveMode(
  session: ReturnType<typeof createWorkbenchController>["editorStore"]["session"],
) {
  return isMoveInteractionMode(session.currentMode)
    ? session.currentMode
    : null;
}

function readWorkbenchState(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  const ui = controller.uiStore.getSnapshot();
  const document = controller.documentStore.getSnapshot();
  const editor = controller.editorStore.getSnapshot();
  const canvasView = controller.canvasViewStore.getSnapshot();
  const topology = controller.topologyStore.getSnapshot();
  const simulation = controller.simulationStore.getSnapshot();
  const renderScene = buildRenderScene({
    locale: ui.locale,
    document,
    topology,
    registry: controller.registry,
    canvasView,
    interaction:
      ui.phase === "simulate"
        ? {
            selectedEntityIds: simulation.selection,
            placementPreview: null,
            moveDraft: null,
            pendingLinkSourceEntityId: null,
          }
        : {
            selectedEntityIds: editor.session.selection,
            placementPreview: editor.session.placementPreview,
            moveDraft: editor.session.moveDraft,
            pendingLinkSourceEntityId: getPendingLinkSourceEntityId(
              editor.session.currentMode,
            ),
          },
    runtimeSnapshot: simulation.runtimeSnapshot,
  });

  return {
    ui,
    registry: controller.registry,
    document,
    session: editor.session,
    history: editor.history,
    canvasView,
    activeSelection:
      ui.phase === "simulate" ? simulation.selection : editor.session.selection,
    activePlacementPreview:
      ui.phase === "edit" ? editor.session.placementPreview : null,
    activePendingLinkSourceEntityId:
      ui.phase === "edit"
        ? getPendingLinkSourceEntityId(editor.session.currentMode)
        : null,
    topology,
    runtimeSnapshot: simulation.runtimeSnapshot,
    telemetry: simulation.telemetry,
    inspectorDetails: simulation.inspectorDetails,
    simulationPatchSet: simulation.patchSet,
    simulationSelection: simulation.selection,
    renderScene,
  };
}

function toScreenPointForGrid(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const snapshot = readWorkbenchState(controller);
  const scaledGridSize =
    snapshot.document.documentSettings.gridSize * snapshot.canvasView.zoom;

  return {
    x: gridPoint.x * scaledGridSize + 1,
    y: gridPoint.y * scaledGridSize + 1,
  };
}

function toScreenPointForPlacementCenter(
  controller: ReturnType<typeof createWorkbenchController>,
  definitionId: string,
  gridPoint: { x: number; y: number },
  rotation: GridRotation = 0,
) {
  const snapshot = readWorkbenchState(controller);
  const definition = snapshot.registry.entityDefinitions.find(
    (entityDefinition) => entityDefinition.id === definitionId,
  );

  if (!definition) {
    throw new Error(`Missing definition ${definitionId}`);
  }

  const footprint = getRotatedGridFootprint(definition.footprint, rotation);
  const scaledGridSize =
    snapshot.document.documentSettings.gridSize * snapshot.canvasView.zoom;

  return {
    x: (gridPoint.x + footprint.width / 2) * scaledGridSize,
    y: (gridPoint.y + footprint.height / 2) * scaledGridSize,
  };
}

function toScreenPointForEntity(
  controller: ReturnType<typeof createWorkbenchController>,
  entityId: string,
) {
  const snapshot = readWorkbenchState(controller);
  const entity = snapshot.document.entities[entityId];

  if (!entity) {
    throw new Error(`Missing entity ${entityId}`);
  }

  const definition = getStage1EntityDefinition(
    snapshot.registry,
    entity.definitionId,
  );

  if (!definition) {
    throw new Error(`Missing definition ${entity.definitionId}`);
  }

  const gridSize = snapshot.document.documentSettings.gridSize;

  return {
    x:
      (entity.position.x * gridSize - snapshot.canvasView.offset.x + 1) *
      snapshot.canvasView.zoom,
    y:
      (entity.position.y * gridSize - snapshot.canvasView.offset.y + 1) *
      snapshot.canvasView.zoom,
  };
}

function toScreenPointInsideEntity(
  controller: ReturnType<typeof createWorkbenchController>,
  entityId: string,
) {
  const snapshot = readWorkbenchState(controller);
  const entity = snapshot.document.entities[entityId];

  if (!entity) {
    throw new Error(`Missing entity ${entityId}`);
  }

  const definition = getStage1EntityDefinition(
    snapshot.registry,
    entity.definitionId,
  );

  if (!definition) {
    throw new Error(`Missing definition ${entity.definitionId}`);
  }

  const gridSize = snapshot.document.documentSettings.gridSize;
  const footprint = getRotatedGridFootprint(definition.footprint, entity.rotation);
  const localOffsetX = Math.max(1, Math.floor((footprint.width * gridSize) / 3));
  const localOffsetY = Math.max(1, Math.floor((footprint.height * gridSize) / 2));

  return {
    x:
      (entity.position.x * gridSize + localOffsetX - snapshot.canvasView.offset.x) *
      snapshot.canvasView.zoom,
    y:
      (entity.position.y * gridSize + localOffsetY - snapshot.canvasView.offset.y) *
      snapshot.canvasView.zoom,
  };
}

function resolveEntityBounds(
  controller: ReturnType<typeof createWorkbenchController>,
  entityIds: string[],
) {
  const snapshot = readWorkbenchState(controller);
  const areas = entityIds.map((entityId) => {
    const entity = snapshot.document.entities[entityId];

    if (!entity) {
      throw new Error(`Missing entity ${entityId}`);
    }

    const definition = getStage1EntityDefinition(
      snapshot.registry,
      entity.definitionId,
    );

    if (!definition) {
      throw new Error(`Missing definition ${entity.definitionId}`);
    }

    return {
      position: entity.position,
      footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
    };
  });
  const bounds = getGridBoundingBox(areas);

  if (!bounds) {
    throw new Error("Missing marquee bounds");
  }

  return bounds;
}

function resolveClockwiseRotatedSelectionState(
  controller: ReturnType<typeof createWorkbenchController>,
  entityIds: string[],
) {
  const snapshot = readWorkbenchState(controller);
  const resolvedEntities = entityIds.map((entityId) => {
    const entity = snapshot.document.entities[entityId];

    if (!entity) {
      throw new Error(`Missing entity ${entityId}`);
    }

    const definition = getStage1EntityDefinition(
      snapshot.registry,
      entity.definitionId,
    );

    if (!definition) {
      throw new Error(`Missing definition ${entity.definitionId}`);
    }

    return {
      entityId,
      position: entity.position,
      rotation: entity.rotation,
      footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
      baseFootprint: definition.footprint,
    };
  });
  const bounds = getGridBoundingBox(
    resolvedEntities.map((entity) => ({
      position: entity.position,
      footprint: entity.footprint,
    })),
  );

  if (!bounds) {
    throw new Error("Missing selection bounds");
  }

  const rotationCenterCells = getGridBoundsCenterCells(bounds);

  return resolvedEntities.map((entity) => {
    const nextRotation = ((entity.rotation + 90) % 360) as GridRotation;
    const nextFootprint = getRotatedGridFootprint(
      entity.baseFootprint,
      nextRotation,
    );
    const rotatedCenter = rotateGridCenterCellsClockwise({
      centerCells: getGridFootprintCenterCells(entity.position, entity.footprint),
      rotationCenterCells,
    });

    return {
      entityId: entity.entityId,
      position: resolveCenteredGridPoint(rotatedCenter, nextFootprint),
      rotation: nextRotation,
    };
  });
}

describe("WorkbenchController scaffold", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("boots with a stage1 seed world and compiled topology", () => {
    localStorage.setItem(
      "industrial-planner:workbench-ui-state",
      JSON.stringify({
        locale: "en-US",
        logLevel: "debug",
        rightDock: {
          collapsed: true,
        },
      }),
    );
    const controller = createWorkbenchController();
    const snapshot = readWorkbenchState(controller);

    expect(snapshot.document.entityOrder.length).toBeGreaterThan(0);
    expect(snapshot.document.baseId).toBe(DEFAULT_STAGE1_BASE_ID);
    expect(snapshot.registry.entityDefinitions.length).toBeGreaterThan(0);
    expect(snapshot.topology.compileVersion).toContain(":");
    expect(snapshot.ui.locale).toBe("en-US");
    expect(snapshot.ui.logLevel).toBe("debug");
    expect(snapshot.ui.rightDock.collapsed).toBe(true);

    controller.dispose();
  });

  it("overwrites incompatible persisted UI data with the current snapshot on boot", () => {
    localStorage.setItem(
      "industrial-planner:workbench-ui-state",
      JSON.stringify({
        leftDockOpen: false,
        statusMessage: "legacy",
      }),
    );

    const controller = createWorkbenchController();
    const persisted = JSON.parse(
      localStorage.getItem("industrial-planner:workbench-ui-state") ?? "null",
    );

    expect(persisted).toMatchObject({
      phase: "edit",
      locale: "zh-CN",
      logLevel: "warn",
      leftDock: {
        open: true,
        collapsed: false,
      },
      rightDock: {
        open: true,
        collapsed: false,
      },
      statusMessageKey: "status.ready",
    });
    expect("leftDockOpen" in persisted).toBe(false);
    expect("statusMessage" in persisted).toBe(false);

    controller.dispose();
  });

  it("steps simulation without requiring a worker host yet", () => {
    const controller = createWorkbenchController();

    controller.stepSimulation();

    expect(readWorkbenchState(controller).runtimeSnapshot.tick).toBe(1);
    expect(readWorkbenchState(controller).ui.phase).toBe("simulate");

    controller.dispose();
  });

  it("stops simulation by returning to edit mode", () => {
    const controller = createWorkbenchController();

    controller.startSimulation();
    expect(readWorkbenchState(controller).ui.phase).toBe("simulate");

    controller.stopSimulation();

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.ui.phase).toBe("edit");
    expect(snapshot.runtimeSnapshot.status).toBe("paused");

    controller.dispose();
  });

  it("exposes dock layout state and enough render inputs to rebuild the scene", async () => {
    const controller = createWorkbenchController();

    controller.setDockOpen("left", false);
    controller.toggleDockCollapsed("right");
    controller.setLocale("en-US");
    controller.setLogLevel("info");
    controller.setDiagnosticsVisible(false);
    controller.setLeftPanelMode("blueprint");
    controller.setSimulationSpeedPreset("4x");
    controller.zoomIn();
    await controller.selectEntity("filler-1");

    const snapshot = readWorkbenchState(controller);
    const fillerSprite = snapshot.renderScene.entities.find(
      (entity) => entity.entityId === "filler-1",
    );

    expect(snapshot.ui.leftDock.open).toBe(true);
    expect(snapshot.ui.rightDock.collapsed).toBe(true);
    expect(snapshot.ui.locale).toBe("en-US");
    expect(snapshot.ui.logLevel).toBe("info");
    expect(snapshot.ui.diagnosticsVisible).toBe(false);
    expect(snapshot.ui.leftPanelMode).toBe("blueprint");
    expect(snapshot.ui.simulationSpeed).toBe("4x");
    expect(snapshot.canvasView.zoom).toBeGreaterThan(1);
    expect(snapshot.renderScene.zoom).toBe(snapshot.canvasView.zoom);
    expect(snapshot.renderScene.worldWidth).toBe(
      snapshot.document.documentSettings.gridSize * 80,
    );
    expect(fillerSprite?.selected).toBe(true);
    expect(snapshot.renderScene.entities.length).toBeGreaterThan(0);

    controller.dispose();
  });

  it("blocks placement outside the active base bounds", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.armPlacement("belt_straight_1x1", "belt");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForGrid(controller, { x: 80, y: 12 }),
    );

    const after = readWorkbenchState(controller);

    expect(after.document.entityOrder).toHaveLength(before.document.entityOrder.length);

    controller.dispose();
  });

  it("hydrates and persists the canvas viewport from local storage", () => {
    localStorage.setItem(
      "industrial-planner:workbench-ui-state",
      JSON.stringify({
        locale: "en-US",
        logLevel: "debug",
        canvasViewport: {
          offset: { x: 48, y: 64 },
          zoom: 1.4,
        },
      }),
    );

    const controller = createWorkbenchController();

    expect(controller.canvasViewStore.getSnapshot().offset).toEqual({
      x: 48,
      y: 64,
    });
    expect(controller.canvasViewStore.getSnapshot().zoom).toBe(1.4);
    expect(controller.getLogLevel()).toBe("debug");

    controller.panCanvasBy({ x: -20, y: -10 });

    expect(
      JSON.parse(localStorage.getItem("industrial-planner:workbench-ui-state") ?? "null"),
    ).toMatchObject({
      canvasViewport: {
        zoom: 1.4,
      },
    });

    controller.dispose();
  });

  it("persists log level changes through the workspace snapshot", () => {
    const controller = createWorkbenchController();

    controller.setLogLevel("debug");

    expect(controller.getLogLevel()).toBe("debug");
    expect(
      JSON.parse(localStorage.getItem("industrial-planner:workbench-ui-state") ?? "null"),
    ).toMatchObject({
      logLevel: "debug",
    });

    controller.dispose();
  });

  it("applies anchored non-linear zoom and persists the updated viewport", () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });

    const before = controller.canvasViewStore.getSnapshot();
    controller.zoomCanvasAt({ x: 160, y: 120 }, 1.25);

    const after = controller.canvasViewStore.getSnapshot();
    const persisted = JSON.parse(
      localStorage.getItem("industrial-planner:workbench-ui-state") ?? "null",
    );

    expect(after.zoom).toBeCloseTo(before.zoom * 1.25, 6);
    expect(after.offset.x).toBeCloseTo(32, 6);
    expect(after.offset.y).toBeCloseTo(24, 6);
    expect(readWorkbenchState(controller).renderScene.zoom).toBe(after.zoom);
    expect(persisted).toMatchObject({
      canvasViewport: {
        offset: {
          x: after.offset.x,
          y: after.offset.y,
        },
        zoom: after.zoom,
      },
    });

    controller.dispose();
  });

  it("resolves canvas interaction targets for blank space and entities", async () => {
    const controller = createWorkbenchController();

    expect(
      controller.getCanvasInteractionTarget(toScreenPointForGrid(controller, { x: 79, y: 79 })),
    ).toEqual({ kind: "blank" });

    await controller.selectEntity("filler-1");

    expect(
      controller.getCanvasInteractionTarget(toScreenPointForEntity(controller, "filler-1")),
    ).toEqual({
      kind: "entity",
      entityId: "filler-1",
      selected: true,
    });

    controller.dispose();
  });

  it("ignores placement arming while simulate mode is active", () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.setPhase("simulate");
    controller.armPlacement("belt_straight_1x1", "belt");

    const after = readWorkbenchState(controller);

    expect(after.ui.phase).toBe("simulate");
    expect(after.session.displayTool).toBe(before.session.displayTool);
    expect(after.session.currentMode).toEqual(before.session.currentMode);
    expect(after.ui.leftPanelMode).toBe(before.ui.leftPanelMode);

    controller.dispose();
  });

  it("updates placement preview from screen coordinates through the shared canvas normalization path", () => {
    const controller = createWorkbenchController();

    controller.armPlacement("belt_straight_1x1", "belt");
    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForGrid(controller, { x: 24, y: 12 }),
    );

    expect(readWorkbenchState(controller).activePlacementPreview).toEqual({
      definitionId: "belt_straight_1x1",
      interactionMode: "pointer",
      gridPoint: { x: 24, y: 12 },
      rotation: 0,
      valid: true,
    });
    expect(readWorkbenchState(controller).renderScene.placementPreview).toMatchObject({
      definitionId: "belt_straight_1x1",
      interactionMode: "pointer",
      x: 24 * readWorkbenchState(controller).document.documentSettings.gridSize,
      y: 12 * readWorkbenchState(controller).document.documentSettings.gridSize,
      valid: true,
    });

    controller.dispose();
  });

  it("rotates armed placement around its center and commits the rotated entity footprint", async () => {
    const controller = createWorkbenchController();

    controller.armPlacement("item_port_unloader_1", "place");
    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForPlacementCenter(
        controller,
        "item_port_unloader_1",
        { x: 24, y: 12 },
      ),
    );
    controller.rotatePlacementClockwise();

    expect(readWorkbenchState(controller).activePlacementPreview).toEqual({
      definitionId: "item_port_unloader_1",
      interactionMode: "pointer",
      gridPoint: { x: 25, y: 11 },
      rotation: 90,
      valid: true,
    });

    await controller.commitPlacementAtScreenPoint(
      toScreenPointForPlacementCenter(
        controller,
        "item_port_unloader_1",
        { x: 25, y: 11 },
        90,
      ),
    );

    const after = readWorkbenchState(controller);
    const placedEntityId = after.document.entityOrder.at(-1);
    const placedEntity = placedEntityId
      ? after.document.entities[placedEntityId]
      : null;

    expect(placedEntity?.definitionId).toBe("item_port_unloader_1");
    expect(placedEntity?.position).toEqual({ x: 25, y: 11 });
    expect(placedEntity?.rotation).toBe(90);
    expect(after.topology.occupancyIndex["25,13"]).toContain(placedEntityId);
    expect(after.topology.occupancyIndex["27,11"] ?? []).not.toContain(
      placedEntityId,
    );
    expect(
      after.renderScene.entities.find((entity) => entity.entityId === placedEntityId),
    ).toMatchObject({
      width: after.document.documentSettings.gridSize,
      height: after.document.documentSettings.gridSize * 3,
      rotation: 90,
    });

    controller.dispose();
  });

  it("cancels armed placement by returning to the select tool", () => {
    const controller = createWorkbenchController();
    const previousSelection = readWorkbenchState(controller).session.selection;

    controller.armPlacement("belt_straight_1x1", "belt");
    controller.rotatePlacementClockwise();
    controller.cancelPlacement();

    const after = readWorkbenchState(controller);
    const placementMode = getPlacementMode(after.session);

    expect(after.session.displayTool).toBe("select");
    expect(after.session.currentMode).toMatchObject({ key: "select" });
    expect(after.session.selection).toEqual(previousSelection);
    expect(placementMode).toBeNull();
    expect(after.activePlacementPreview).toBeNull();

    controller.dispose();
  });

  it("collects placement preview profiling stats for changed and unchanged preview updates", () => {
    const placementPreviewProfiler = createPlacementPreviewProfiler();
    placementPreviewProfiler.setEnabled(true);
    const controller = createWorkbenchController({
      placementPreviewProfiler,
    });

    controller.armPlacement("belt_straight_1x1", "belt");
    placementPreviewProfiler.reset();

    const placementPoint = toScreenPointForPlacementCenter(
      controller,
      "belt_straight_1x1",
      {
        x: 8,
        y: 3,
      },
    );

    controller.updatePlacementPreviewFromScreenPoint(placementPoint);
    controller.updatePlacementPreviewFromScreenPoint(placementPoint);

    const snapshot = placementPreviewProfiler.getSnapshot();

    expect(snapshot.counts.updateCalls).toBe(2);
    expect(snapshot.counts.previewChangedCalls).toBe(1);
    expect(snapshot.counts.previewUnchangedCalls).toBe(1);
    expect(snapshot.stages["controller.total"].count).toBe(2);
    expect(snapshot.stages["editor.hitTest"].count).toBe(2);
    expect(snapshot.stages["controller.sync.total"].count).toBe(2);
    expect(snapshot.latest).toMatchObject({
      changed: false,
      nextPreview: {
        definitionId: "belt_straight_1x1",
      },
    });

    controller.dispose();
  });

  it("does not notify editor snapshot subscribers for semantic no-op placement preview updates", () => {
    const controller = createWorkbenchController();

    controller.armPlacement("belt_straight_1x1", "belt");

    const listener = vi.fn();
    const unsubscribe = controller.editorStore.subscribe(listener);
    const placementPoint = toScreenPointForPlacementCenter(
      controller,
      "belt_straight_1x1",
      {
        x: 10,
        y: 6,
      },
    );

    controller.updatePlacementPreviewFromScreenPoint(placementPoint);
    controller.updatePlacementPreviewFromScreenPoint(placementPoint);

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    controller.dispose();
  });

  it("does not persist workspace state for preview-only placement updates", () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });

    controller.armPlacement("belt_straight_1x1", "belt");

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForGrid(controller, { x: 24, y: 12 }),
    );
    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForGrid(controller, { x: 30, y: 18 }),
    );

    expect(setItemSpy).not.toHaveBeenCalled();

    controller.panCanvasBy({ x: -16, y: 0 });

    expect(setItemSpy).toHaveBeenCalled();

    controller.dispose();
  });

  it("anchors large device placement preview to the device center instead of the top-left corner", () => {
    const controller = createWorkbenchController();

    controller.armPlacement("item_port_mix_pool_1", "place");
    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForPlacementCenter(controller, "item_port_mix_pool_1", {
        x: 24,
        y: 12,
      }),
    );

    expect(readWorkbenchState(controller).activePlacementPreview).toEqual({
      definitionId: "item_port_mix_pool_1",
      interactionMode: "pointer",
      gridPoint: { x: 24, y: 12 },
      rotation: 0,
      valid: true,
    });

    controller.dispose();
  });

  it("seeds touch placement at the viewport center and confirms placement from the preview", async () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });

    controller.armPlacement("belt_straight_1x1", "belt", "touch");

    const previewBeforeConfirm = readWorkbenchState(controller).activePlacementPreview;
    const entityCountBeforeConfirm = readWorkbenchState(controller).document.entityOrder.length;

    expect(previewBeforeConfirm).toMatchObject({
      definitionId: "belt_straight_1x1",
      interactionMode: "touch",
      rotation: 0,
      valid: true,
    });

    await controller.confirmPlacementPreview();

    const afterConfirm = readWorkbenchState(controller);
    const placedEntityId = afterConfirm.document.entityOrder.at(-1);
    const placedEntity = placedEntityId
      ? afterConfirm.document.entities[placedEntityId]
      : null;

    expect(afterConfirm.document.entityOrder).toHaveLength(entityCountBeforeConfirm + 1);
    expect(placedEntity?.definitionId).toBe("belt_straight_1x1");
    expect(placedEntity?.position).toEqual(previewBeforeConfirm?.gridPoint);
    expect(afterConfirm.activePlacementPreview).toMatchObject({
      definitionId: "belt_straight_1x1",
      interactionMode: "touch",
    });

    controller.dispose();
  });

  it("keeps placement preview valid when the pointer is over an existing entity", () => {
    const controller = createWorkbenchController();

    controller.armPlacement("belt_straight_1x1", "belt");
    controller.updatePlacementPreviewFromScreenPoint(
      toScreenPointForEntity(controller, "reactor-1"),
    );

    expect(readWorkbenchState(controller).activePlacementPreview).toMatchObject({
      definitionId: "belt_straight_1x1",
      gridPoint: { x: 12, y: 6 },
      valid: true,
    });

    controller.dispose();
  });

  it("commits pointer placement even when the tap lands on an existing entity", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.armPlacement("belt_straight_1x1", "belt");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForEntity(controller, "reactor-1"),
    );

    const after = readWorkbenchState(controller);
    const placedEntityId = after.document.entityOrder.at(-1);
    const placedEntity = placedEntityId
      ? after.document.entities[placedEntityId]
      : null;

    expect(after.document.entityOrder).toHaveLength(
      before.document.entityOrder.length + 1,
    );
    expect(placedEntity?.definitionId).toBe("belt_straight_1x1");
    expect(placedEntity?.position).toEqual({ x: 12, y: 6 });
    expect(
      after.topology.diagnostics.some(
        (diagnostic) =>
          diagnostic.id === "overlap:12,6" &&
          diagnostic.entityIds.includes("reactor-1") &&
          diagnostic.entityIds.includes(placedEntityId ?? ""),
      ),
    ).toBe(true);

    controller.dispose();
  });

  it("commits pointer placement from screen coordinates and recompiles topology", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.armPlacement("belt_straight_1x1", "belt");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForGrid(controller, { x: 24, y: 12 }),
    );

    const after = readWorkbenchState(controller);
    const placedEntityId = after.document.entityOrder.at(-1);
    const placedEntity = placedEntityId
      ? after.document.entities[placedEntityId]
      : null;

    expect(after.document.entityOrder).toHaveLength(
      before.document.entityOrder.length + 1,
    );
    expect(placedEntity?.definitionId).toBe("belt_straight_1x1");
    expect(placedEntity?.position).toEqual({ x: 24, y: 12 });
    expect(after.topology.compileVersion).not.toBe(before.topology.compileVersion);
    expect(
      after.renderScene.entities.some((entity) => entity.entityId === placedEntityId),
    ).toBe(true);

    controller.dispose();
  });

  it("places large devices from a center-anchored pointer position", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.armPlacement("item_port_mix_pool_1", "place");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForPlacementCenter(controller, "item_port_mix_pool_1", {
        x: 24,
        y: 12,
      }),
    );

    const after = readWorkbenchState(controller);
    const placedEntityId = after.document.entityOrder.at(-1);
    const placedEntity = placedEntityId
      ? after.document.entities[placedEntityId]
      : null;

    expect(after.document.entityOrder).toHaveLength(
      before.document.entityOrder.length + 1,
    );
    expect(placedEntity?.definitionId).toBe("item_port_mix_pool_1");
    expect(placedEntity?.position).toEqual({ x: 24, y: 12 });

    controller.dispose();
  });

  it("creates and removes a dark pipe link through the editor interaction host", async () => {
    const controller = createWorkbenchController();

    controller.armPlacement("item_port_udpipe_loader_1", "place");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForGrid(controller, { x: 22, y: 2 }),
    );

    const placedInletId = readWorkbenchState(controller).document.entityOrder.at(-1);
    expect(placedInletId).toBeTruthy();

    controller.setInteractionMode("link");
    await controller.activateLinkTarget(placedInletId ?? null);
    await controller.activateLinkTarget("dark-outlet-1");

    const linkedSnapshot = readWorkbenchState(controller);
    expect(linkedSnapshot.document.explicitLinks).toHaveLength(1);
    expect(linkedSnapshot.renderScene.explicitLinks).toHaveLength(1);

    await controller.removeSelectionLinks();

    const unlinkedSnapshot = readWorkbenchState(controller);
    expect(unlinkedSnapshot.document.explicitLinks).toHaveLength(0);
    expect(unlinkedSnapshot.renderScene.explicitLinks).toHaveLength(0);

    controller.dispose();
  });

  it("undoes and redoes document commands without losing the workbench snapshot", async () => {
    const controller = createWorkbenchController();
    const initialCount = readWorkbenchState(controller).document.entityOrder.length;

    controller.armPlacement("pipe_straight_1x1", "pipe");
    await controller.commitPlacementAtScreenPoint(
      toScreenPointForGrid(controller, { x: 26, y: 4 }),
    );

    expect(readWorkbenchState(controller).document.entityOrder).toHaveLength(initialCount + 1);
    expect(readWorkbenchState(controller).history.canUndo).toBe(true);

    await controller.undo();
    expect(readWorkbenchState(controller).document.entityOrder).toHaveLength(initialCount);
    expect(readWorkbenchState(controller).history.canRedo).toBe(true);

    await controller.redo();
    expect(readWorkbenchState(controller).document.entityOrder).toHaveLength(initialCount + 1);

    controller.dispose();
  });

  it("keeps simulation selection separate from edit session selection", async () => {
    const controller = createWorkbenchController();

    await controller.selectEntity("filler-1");
    controller.setPhase("simulate");
    await controller.selectSimulationEntity("dark-outlet-1");

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.ui.phase).toBe("simulate");
    expect(snapshot.simulationSelection).toEqual(["dark-outlet-1"]);
    expect(snapshot.session.selection).toEqual(["filler-1"]);

    controller.dispose();
  });

  it("toggles desktop edit selection through the shared selection action chain", async () => {
    const controller = createWorkbenchController();

    await controller.selectEntity("filler-1", "pointer");
    await controller.selectEntity("reactor-1", "pointer", "toggle");
    await controller.selectEntity("filler-1", "pointer", "toggle");

    expect(readWorkbenchState(controller).session.selection).toEqual(["reactor-1"]);

    await controller.selectEntity("dark-outlet-1", "pointer", "toggle");

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.session.selection).toEqual(["reactor-1", "dark-outlet-1"]);
    expect(snapshot.session.selectionInputMode).toBe("pointer");

    controller.dispose();
  });

  it("rotates the pointer selection through the shared selection action chain", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller).document.entities["filler-1"];

    expect(before).toBeTruthy();

    await controller.selectEntity("filler-1", "pointer");
    await controller.rotateSelectionClockwise();

    const after = readWorkbenchState(controller);
    const rotatedEntity = after.document.entities["filler-1"];

    expect(after.session.selection).toEqual(["filler-1"]);
    expect(after.session.selectionInputMode).toBe("pointer");
    expect(rotatedEntity).toMatchObject({
      position: { x: 17, y: 7 },
      rotation: 180,
    });
    expect(
      after.renderScene.entities.find((entity) => entity.entityId === "filler-1"),
    ).toMatchObject({
      x: 17 * after.document.documentSettings.gridSize,
      y: 7 * after.document.documentSettings.gridSize,
      width: 6 * after.document.documentSettings.gridSize,
      height: 4 * after.document.documentSettings.gridSize,
      rotation: 180,
    });

    let current = rotatedEntity;

    for (let step = 0; step < 3; step += 1) {
      await controller.rotateSelectionClockwise();
      current = readWorkbenchState(controller).document.entities["filler-1"];
    }

    expect(current).toEqual(before);

    controller.dispose();
  });

  it("rotates multiple selected entities around their overall bounding box", async () => {
    const controller = createWorkbenchController();
    const entityIds = ["reactor-1", "filler-1"];
    const before = entityIds.map(
      (entityId) => readWorkbenchState(controller).document.entities[entityId],
    );
    const expectedAfterOneTurn = resolveClockwiseRotatedSelectionState(
      controller,
      entityIds,
    );

    await controller.selectEntity("reactor-1", "pointer");
    await controller.selectEntity("filler-1", "pointer", "toggle");
    await controller.rotateSelectionClockwise();

    const afterRotate = readWorkbenchState(controller);

    expect(afterRotate.session.selection).toEqual(entityIds);

    for (const expectedEntity of expectedAfterOneTurn) {
      expect(afterRotate.document.entities[expectedEntity.entityId]).toMatchObject({
        position: expectedEntity.position,
        rotation: expectedEntity.rotation,
      });
    }

    await controller.undo();

    for (let index = 0; index < entityIds.length; index += 1) {
      expect(readWorkbenchState(controller).document.entities[entityIds[index]!]).toEqual(
        before[index],
      );
    }

    await controller.rotateSelectionClockwise();
    await controller.rotateSelectionClockwise();
    await controller.rotateSelectionClockwise();
    await controller.rotateSelectionClockwise();

    for (let index = 0; index < entityIds.length; index += 1) {
      expect(readWorkbenchState(controller).document.entities[entityIds[index]!]).toEqual(
        before[index],
      );
    }

    controller.dispose();
  });

  it("moves the selected entity through the hidden move mode and confirms a single entity.move command", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller).document.entities["reactor-1"];

    expect(before).toBeTruthy();

    await controller.selectEntity("reactor-1", "pointer");
    controller.beginMoveFromScreenPoint(
      "reactor-1",
      toScreenPointForEntity(controller, "reactor-1"),
      "pointer",
    );
    controller.updateMoveDraftFromScreenPoint(
      toScreenPointForGrid(controller, { x: 20, y: 10 }),
    );

    const duringMove = readWorkbenchState(controller);

    expect(getMoveMode(duringMove.session)).toMatchObject({
      entityId: "reactor-1",
      inputMode: "pointer",
    });
    expect(duringMove.session.moveDraft).toMatchObject({
      entityId: "reactor-1",
      interactionMode: "pointer",
      originGridPoint: before?.position,
      gridPoint: { x: 20, y: 10 },
      rotation: before?.rotation,
      valid: true,
    });

    await controller.confirmMovePreview();

    const after = readWorkbenchState(controller);

    expect(after.document.entities["reactor-1"]).toMatchObject({
      position: { x: 20, y: 10 },
      rotation: before?.rotation,
    });
    expect(after.session.currentMode).toMatchObject({ key: "select" });
    expect(after.session.displayTool).toBe("select");
    expect(after.session.selection).toEqual(["reactor-1"]);
    expect(after.session.selectionInputMode).toBe("pointer");
    expect(after.session.moveDraft).toBeNull();
    expect(
      after.renderScene.entities.find((entity) => entity.entityId === "reactor-1"),
    ).toMatchObject({
      x: 20 * after.document.documentSettings.gridSize,
      y: 10 * after.document.documentSettings.gridSize,
      selected: true,
    });

    controller.dispose();
  });

  it("moves multiple selected entities together and confirms them as one undo unit", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller).document.entities;
    const anchorBefore = before["reactor-1"];
    const followerBefore = before["filler-1"];

    expect(anchorBefore).toBeTruthy();
    expect(followerBefore).toBeTruthy();

    await controller.selectEntity("reactor-1", "pointer");
    await controller.selectEntity("filler-1", "pointer", "toggle");
    controller.beginMoveFromScreenPoint(
      "reactor-1",
      toScreenPointForEntity(controller, "reactor-1"),
      "pointer",
    );
    controller.updateMoveDraftFromScreenPoint(
      toScreenPointForGrid(controller, { x: 20, y: 10 }),
    );

    const duringMove = readWorkbenchState(controller);
    const deltaX = 20 - anchorBefore!.position.x;
    const deltaY = 10 - anchorBefore!.position.y;

    expect(duringMove.session.moveDraft?.entities).toMatchObject([
      {
        entityId: "reactor-1",
        gridPoint: { x: 20, y: 10 },
      },
      {
        entityId: "filler-1",
        gridPoint: {
          x: followerBefore!.position.x + deltaX,
          y: followerBefore!.position.y + deltaY,
        },
      },
    ]);

    await controller.confirmMovePreview();

    const after = readWorkbenchState(controller);

    expect(after.document.entities["reactor-1"]).toMatchObject({
      position: { x: 20, y: 10 },
      rotation: anchorBefore!.rotation,
    });
    expect(after.document.entities["filler-1"]).toMatchObject({
      position: {
        x: followerBefore!.position.x + deltaX,
        y: followerBefore!.position.y + deltaY,
      },
      rotation: followerBefore!.rotation,
    });

    await controller.undo();

    expect(readWorkbenchState(controller).document.entities["reactor-1"]).toEqual(
      anchorBefore,
    );
    expect(readWorkbenchState(controller).document.entities["filler-1"]).toEqual(
      followerBefore,
    );

    controller.dispose();
  });

  it("rotates move drafts and confirms a single atomic entity.rotate command", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller).document.entities["filler-1"];

    expect(before).toBeTruthy();

    const definition = getStage1EntityDefinition(
      controller.registry,
      before!.definitionId,
    );

    expect(definition).toBeTruthy();

    await controller.selectEntity("filler-1", "pointer");
    controller.beginMoveFromScreenPoint(
      "filler-1",
      toScreenPointForEntity(controller, "filler-1"),
      "pointer",
    );
    controller.updateMoveDraftFromScreenPoint(
      toScreenPointForGrid(controller, { x: 20, y: 10 }),
    );
    controller.rotateMoveClockwise();

    const currentFootprint = getRotatedGridFootprint(
      definition!.footprint,
      before!.rotation,
    );
    const nextFootprint = getRotatedGridFootprint(definition!.footprint, 180);
    const expectedGridPoint = resolveCenteredRotatedGridPoint({
      gridPoint: { x: 20, y: 10 },
      currentFootprint,
      nextFootprint,
    });
    const duringMove = readWorkbenchState(controller);

    expect(duringMove.session.moveDraft).toMatchObject({
      entityId: "filler-1",
      gridPoint: expectedGridPoint,
      rotation: 180,
      valid: true,
    });

    await controller.confirmMovePreview();

    const after = readWorkbenchState(controller);

    expect(after.document.entities["filler-1"]).toMatchObject({
      position: expectedGridPoint,
      rotation: 180,
    });

    await controller.undo();

    expect(readWorkbenchState(controller).document.entities["filler-1"]).toEqual(before);

    controller.dispose();
  });

  it("rotates multi-entity move drafts around the overall selection bounds", async () => {
    const controller = createWorkbenchController();
    const entityIds = ["reactor-1", "filler-1"];
    const before = entityIds.map(
      (entityId) => readWorkbenchState(controller).document.entities[entityId],
    );
    const expectedDraftState = resolveClockwiseRotatedSelectionState(
      controller,
      entityIds,
    );

    await controller.selectEntity("reactor-1", "pointer");
    await controller.selectEntity("filler-1", "pointer", "toggle");
    controller.beginMoveFromScreenPoint(
      "reactor-1",
      toScreenPointForEntity(controller, "reactor-1"),
      "pointer",
    );
    controller.rotateMoveClockwise();

    const duringMove = readWorkbenchState(controller);

    expect(duringMove.session.moveDraft?.entities).toMatchObject(
      expectedDraftState.map((entity) => ({
        entityId: entity.entityId,
        gridPoint: entity.position,
        rotation: entity.rotation,
      })),
    );

    await controller.confirmMovePreview();

    const after = readWorkbenchState(controller);

    for (const expectedEntity of expectedDraftState) {
      expect(after.document.entities[expectedEntity.entityId]).toMatchObject({
        position: expectedEntity.position,
        rotation: expectedEntity.rotation,
      });
    }

    await controller.undo();

    const restored = readWorkbenchState(controller);

    for (let index = 0; index < entityIds.length; index += 1) {
      expect(restored.document.entities[entityIds[index]!]).toEqual(before[index]);
    }

    controller.dispose();
  });

  it("keeps multi-entity move drafts anchored to the pointer across rotate and returns after four turns", async () => {
    const controller = createWorkbenchController();
    const entityIds = ["reactor-1", "filler-1"];

    await controller.selectEntity("reactor-1", "pointer");
    await controller.selectEntity("filler-1", "pointer", "toggle");

    const pointerScreenPoint = toScreenPointInsideEntity(controller, "reactor-1");

    controller.beginMoveFromScreenPoint(
      "reactor-1",
      pointerScreenPoint,
      "pointer",
    );

    const initialDraft = readWorkbenchState(controller).session.moveDraft;

    expect(initialDraft).toBeTruthy();

    const expectedAfterOneTurn = resolveClockwiseRotatedSelectionState(
      controller,
      entityIds,
    ).map((entity) => ({
      entityId: entity.entityId,
      gridPoint: entity.position,
      rotation: entity.rotation,
    }));

    controller.rotateMoveClockwise();
    controller.updateMoveDraftFromScreenPoint(pointerScreenPoint);

    const afterOneTurn = readWorkbenchState(controller).session.moveDraft;

    expect(afterOneTurn?.entities).toMatchObject(expectedAfterOneTurn);

    controller.rotateMoveClockwise();
    controller.updateMoveDraftFromScreenPoint(pointerScreenPoint);
    controller.rotateMoveClockwise();
    controller.updateMoveDraftFromScreenPoint(pointerScreenPoint);
    controller.rotateMoveClockwise();
    controller.updateMoveDraftFromScreenPoint(pointerScreenPoint);

    const afterFourTurns = readWorkbenchState(controller).session.moveDraft;

    expect(afterFourTurns?.entities).toMatchObject(
      initialDraft!.entities.map((entity) => ({
        entityId: entity.entityId,
        gridPoint: entity.gridPoint,
        rotation: entity.rotation,
      })),
    );
    expect(afterFourTurns?.anchorWorldOffset).toEqual(initialDraft!.anchorWorldOffset);

    controller.dispose();
  });

  it("cancels touch move drafts without mutating the world document", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller).document.entities["reactor-1"];

    expect(before).toBeTruthy();

    await controller.selectEntity("reactor-1", "touch");
    controller.beginMoveFromScreenPoint(
      "reactor-1",
      toScreenPointForEntity(controller, "reactor-1"),
      "touch",
    );
    controller.updateMoveDraftFromScreenPoint(
      toScreenPointForGrid(controller, { x: 22, y: 11 }),
    );

    expect(getMoveMode(readWorkbenchState(controller).session)).toMatchObject({
      entityId: "reactor-1",
      inputMode: "touch",
    });

    controller.cancelMove();

    const after = readWorkbenchState(controller);

    expect(after.document.entities["reactor-1"]).toEqual(before);
    expect(after.session.currentMode).toMatchObject({ key: "select" });
    expect(after.session.selection).toEqual(["reactor-1"]);
    expect(after.session.selectionInputMode).toBe("touch");
    expect(after.session.moveDraft).toBeNull();

    controller.dispose();
  });

  it("builds a grid-aligned marquee draft and replaces selection on confirm", async () => {
    const controller = createWorkbenchController();
    const marqueeBounds = resolveEntityBounds(controller, ["reactor-1", "filler-1"]);

    controller.beginMarqueeFromScreenPoint(
      toScreenPointForGrid(controller, {
        x: marqueeBounds.left,
        y: marqueeBounds.top,
      }),
      "pointer",
      "replace",
    );
    controller.updateMarqueeDraftFromScreenPoint(
      toScreenPointForGrid(controller, {
        x: marqueeBounds.left + marqueeBounds.width - 1,
        y: marqueeBounds.top + marqueeBounds.height - 1,
      }),
    );

    const duringMarquee = readWorkbenchState(controller);

    expect(duringMarquee.session.marqueeDraft).toMatchObject({
      interactionMode: "pointer",
      selectionMode: "replace",
      bounds: marqueeBounds,
      entityIds: ["reactor-1", "filler-1"],
    });

    await controller.confirmMarqueeSelection();

    const after = readWorkbenchState(controller);

    expect(after.session.selection).toEqual(["reactor-1", "filler-1"]);
    expect(after.session.selectionInputMode).toBe("pointer");
    expect(after.session.marqueeDraft).toBeNull();

    controller.dispose();
  });

  it("toggles marquee hits against the base selection on confirm", async () => {
    const controller = createWorkbenchController();
    const marqueeBounds = resolveEntityBounds(controller, ["reactor-1", "filler-1"]);

    await controller.selectEntity("reactor-1", "pointer");
    controller.beginMarqueeFromScreenPoint(
      toScreenPointForGrid(controller, {
        x: marqueeBounds.left,
        y: marqueeBounds.top,
      }),
      "pointer",
      "toggle",
    );
    controller.updateMarqueeDraftFromScreenPoint(
      toScreenPointForGrid(controller, {
        x: marqueeBounds.left + marqueeBounds.width - 1,
        y: marqueeBounds.top + marqueeBounds.height - 1,
      }),
    );

    await controller.confirmMarqueeSelection();

    const after = readWorkbenchState(controller);

    expect(after.session.selection).toEqual(["filler-1"]);
    expect(after.session.selectionInputMode).toBe("pointer");
    expect(after.session.marqueeDraft).toBeNull();

    controller.dispose();
  });

  it("writes editable config back to the world document in edit mode", async () => {
    const controller = createWorkbenchController();

    await controller.patchEntityConfig("storage-1", {
      submitToWarehouse: false,
    });

    expect(
      readWorkbenchState(controller).document.entities["storage-1"]?.config
        .submitToWarehouse,
    ).toBe(false);

    controller.dispose();
  });

  it("keeps simulation patches temporary and clears them when leaving simulate mode", async () => {
    const controller = createWorkbenchController();
    const baselineValue =
      readWorkbenchState(controller).document.entities["dark-outlet-1"]?.config
        .selectedLiquidItemId;

    controller.setPhase("simulate");
    await controller.patchSimulationEntityConfig("dark-outlet-1", {
      selectedLiquidItemId: "item_liquid_plant_grass_2",
    });

    const patchedSnapshot = readWorkbenchState(controller);

    expect(
      patchedSnapshot.simulationPatchSet.entityConfigByEntityId["dark-outlet-1"]
        ?.selectedLiquidItemId,
    ).toBe("item_liquid_plant_grass_2");
    expect(
      patchedSnapshot.document.entities["dark-outlet-1"]?.config
        .selectedLiquidItemId,
    ).toBe(baselineValue);

    controller.setPhase("edit");

    const clearedSnapshot = readWorkbenchState(controller);

    expect(
      clearedSnapshot.simulationPatchSet.entityConfigByEntityId["dark-outlet-1"],
    ).toBeUndefined();
    expect(
      clearedSnapshot.document.entities["dark-outlet-1"]?.config
        .selectedLiquidItemId,
    ).toBe(baselineValue);

    controller.dispose();
  });

  it("clears runtime patches when stopping simulation through the top-level control semantics", async () => {
    const controller = createWorkbenchController();

    controller.startSimulation();
    await controller.patchSimulationEntityConfig("dark-outlet-1", {
      selectedLiquidItemId: "item_liquid_plant_grass_2",
    });

    expect(
      readWorkbenchState(controller).simulationPatchSet.entityConfigByEntityId["dark-outlet-1"]
        ?.selectedLiquidItemId,
    ).toBe("item_liquid_plant_grass_2");

    controller.stopSimulation();

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.ui.phase).toBe("edit");
    expect(
      snapshot.simulationPatchSet.entityConfigByEntityId["dark-outlet-1"],
    ).toBeUndefined();

    controller.dispose();
  });
});
