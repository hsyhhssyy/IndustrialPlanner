import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STAGE1_BASE_ID } from "@/domain/base/stage1-bases";
import { createWorkbenchController } from "@/app-shell/controller/workbench-controller";

function readWorkbenchState(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  const ui = controller.uiStore.getSnapshot();
  const editor = controller.editorStore.getSnapshot();
  const canvas = controller.canvasStore.getSnapshot();
  const topology = controller.topologyStore.getSnapshot();
  const simulation = controller.simulationStore.getSnapshot();
  const renderScene = controller.renderSceneStore.getSnapshot();

  return {
    ui,
    registry: controller.registry,
    document: editor.document,
    session: editor.session,
    history: editor.history,
    canvas: canvas.canvas,
    activeCanvas: canvas.activeCanvas,
    topology,
    runtimeSnapshot: simulation.runtimeSnapshot,
    telemetry: simulation.telemetry,
    inspectorDetails: simulation.inspectorDetails,
    simulationPatchSet: simulation.patchSet,
    renderScene,
  };
}

function toScreenPointForGrid(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const snapshot = readWorkbenchState(controller);
  const scaledGridSize =
    snapshot.document.documentSettings.gridSize * snapshot.canvas.viewport.zoom;

  return {
    x: gridPoint.x * scaledGridSize + 1,
    y: gridPoint.y * scaledGridSize + 1,
  };
}

function toScreenPointForEntity(
  controller: ReturnType<typeof createWorkbenchController>,
  entityId: string,
) {
  const snapshot = readWorkbenchState(controller);
  const entity = snapshot.renderScene.entities.find(
    (candidate) => candidate.entityId === entityId,
  );

  if (!entity) {
    throw new Error(`Missing render entity ${entityId}`);
  }

  return {
    x: (entity.x + 1) * snapshot.canvas.viewport.zoom,
    y: (entity.y + 1) * snapshot.canvas.viewport.zoom,
  };
}

describe("WorkbenchController scaffold", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("boots with a stage1 seed world and compiled topology", () => {
    localStorage.setItem(
      "industrial-planner:workbench-ui-state",
      JSON.stringify({
        locale: "en-US",
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
    expect(readWorkbenchState(controller).canvas.activeBackend).toBe("simulation");

    controller.dispose();
  });

  it("exposes dock layout state and renderer scene through the snapshot", async () => {
    const controller = createWorkbenchController();

    controller.setDockOpen("left", false);
    controller.toggleDockCollapsed("right");
    controller.setLocale("en-US");
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
    expect(snapshot.ui.diagnosticsVisible).toBe(false);
    expect(snapshot.ui.leftPanelMode).toBe("blueprint");
    expect(snapshot.ui.simulationSpeed).toBe("4x");
    expect(snapshot.canvas.viewport.zoom).toBeGreaterThan(1);
    expect(snapshot.renderScene.zoom).toBe(snapshot.canvas.viewport.zoom);
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
    await controller.handleCanvasClick(
      toScreenPointForGrid(controller, { x: 80, y: 12 }),
    );

    const after = readWorkbenchState(controller);

    expect(after.document.entityOrder).toHaveLength(before.document.entityOrder.length);

    controller.dispose();
  });

  it("places an entity through the canvas host interaction loop and recompiles topology", async () => {
    const controller = createWorkbenchController();
    const before = readWorkbenchState(controller);

    controller.armPlacement("belt_straight_1x1", "belt");
    await controller.handleCanvasClick(
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

  it("creates and removes a dark pipe link through the edit canvas backend", async () => {
    const controller = createWorkbenchController();

    controller.armPlacement("item_port_udpipe_loader_1", "place");
    await controller.handleCanvasClick(
      toScreenPointForGrid(controller, { x: 22, y: 2 }),
    );

    const placedInletId = readWorkbenchState(controller).document.entityOrder.at(-1);
    expect(placedInletId).toBeTruthy();

    controller.setActiveTool("link");
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, placedInletId ?? ""),
    );
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, "dark-outlet-1"),
    );

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
    await controller.handleCanvasClick(
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
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, "dark-outlet-1"),
    );

    const snapshot = readWorkbenchState(controller);

    expect(snapshot.canvas.activeBackend).toBe("simulation");
    expect(snapshot.activeCanvas.selectedEntityIds).toEqual(["dark-outlet-1"]);
    expect(snapshot.session.selection).toEqual(["filler-1"]);

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
});
