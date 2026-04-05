import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STAGE1_BASE_ID } from "@/domain/base/stage1-bases";
import { getStage1EntityDefinition } from "@/domain/registry/stage1-registry";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import {
  getRotatedGridFootprint,
  rotateGridRotationClockwise,
  type GridRotation,
} from "@/shared/geometry/grid";
import { createPlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";

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
      ui.mode === "simulate"
        ? {
            selectedEntityIds: simulation.selection,
            placementPreview: null,
            pendingLinkSourceEntityId: null,
          }
        : {
            selectedEntityIds: editor.session.selection,
            placementPreview: editor.session.placementPreview,
            pendingLinkSourceEntityId:
              editor.session.pendingLinkSourceEntityId,
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
      ui.mode === "simulate" ? simulation.selection : editor.session.selection,
    activePlacementPreview:
      ui.mode === "edit" ? editor.session.placementPreview : null,
    activePendingLinkSourceEntityId:
      ui.mode === "edit" ? editor.session.pendingLinkSourceEntityId : null,
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
      mode: "edit",
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
    expect(readWorkbenchState(controller).ui.mode).toBe("simulate");

    controller.dispose();
  });

  it("stops simulation by returning to edit mode", () => {
    const controller = createWorkbenchController();

    controller.startSimulation();
    expect(readWorkbenchState(controller).ui.mode).toBe("simulate");

    controller.stopSimulation();

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.ui.mode).toBe("edit");
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

    controller.setMode("simulate");
    controller.armPlacement("belt_straight_1x1", "belt");

    const after = readWorkbenchState(controller);

    expect(after.ui.mode).toBe("simulate");
    expect(after.session.activeTool).toBe(before.session.activeTool);
    expect(after.session.placementDefinitionId).toBe(before.session.placementDefinitionId);
    expect(after.session.placementInteractionMode).toBe(
      before.session.placementInteractionMode,
    );
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

    expect(after.session.activeTool).toBe("select");
    expect(after.session.selection).toEqual(previousSelection);
    expect(after.session.placementDefinitionId).toBeNull();
    expect(after.session.placementInteractionMode).toBeNull();
    expect(after.session.placementRotation).toBeNull();
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

    controller.setActiveTool("link");
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
    controller.setMode("simulate");
    await controller.selectSimulationEntity("dark-outlet-1");

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.ui.mode).toBe("simulate");
    expect(snapshot.simulationSelection).toEqual(["dark-outlet-1"]);
    expect(snapshot.session.selection).toEqual(["filler-1"]);

    controller.dispose();
  });

  it("rotates the pointer selection through the shared selection action chain", async () => {
    const controller = createWorkbenchController();
    const beforeRotation =
      readWorkbenchState(controller).document.entities["reactor-1"]?.rotation ?? 0;

    await controller.selectEntity("reactor-1", "pointer");
    await controller.rotateSelectionClockwise();

    const after = readWorkbenchState(controller);

    expect(after.session.selection).toEqual(["reactor-1"]);
    expect(after.session.selectionInteractionMode).toBe("pointer");
    expect(after.document.entities["reactor-1"]?.rotation).toBe(
      rotateGridRotationClockwise(beforeRotation),
    );
    expect(
      after.renderScene.entities.find((entity) => entity.entityId === "reactor-1")
        ?.rotation,
    ).toBe(rotateGridRotationClockwise(beforeRotation));

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

    controller.setMode("simulate");
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

    controller.setMode("edit");

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

    expect(snapshot.ui.mode).toBe("edit");
    expect(
      snapshot.simulationPatchSet.entityConfigByEntityId["dark-outlet-1"],
    ).toBeUndefined();

    controller.dispose();
  });
});
