import { beforeEach, describe, expect, it } from "vitest";
import { createWorkbenchController } from "@/app-shell/controller/workbench-controller";

function toScreenPointForGrid(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const snapshot = controller.getSnapshot();
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
  const snapshot = controller.getSnapshot();
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
    const controller = createWorkbenchController();
    const snapshot = controller.getSnapshot();

    expect(snapshot.document.entityOrder.length).toBeGreaterThan(0);
    expect(snapshot.registry.entityDefinitions.length).toBeGreaterThan(0);
    expect(snapshot.topology.compileVersion).toContain(":");

    controller.dispose();
  });

  it("steps simulation without requiring a worker host yet", () => {
    const controller = createWorkbenchController();

    controller.stepSimulation();

    expect(controller.getSnapshot().runtimeSnapshot.tick).toBe(1);
    expect(controller.getSnapshot().ui.mode).toBe("simulate");
    expect(controller.getSnapshot().canvas.activeBackend).toBe("simulation");

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

    const snapshot = controller.getSnapshot();
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
    expect(fillerSprite?.selected).toBe(true);
    expect(snapshot.renderScene.entities.length).toBeGreaterThan(0);

    controller.dispose();
  });

  it("places an entity through the canvas host interaction loop and recompiles topology", async () => {
    const controller = createWorkbenchController();
    const before = controller.getSnapshot();

    controller.armPlacement("belt_straight_1x1", "belt");
    await controller.handleCanvasClick(
      toScreenPointForGrid(controller, { x: 24, y: 12 }),
    );

    const after = controller.getSnapshot();
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

    const placedInletId = controller.getSnapshot().document.entityOrder.at(-1);
    expect(placedInletId).toBeTruthy();

    controller.setActiveTool("link");
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, placedInletId ?? ""),
    );
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, "dark-outlet-1"),
    );

    const linkedSnapshot = controller.getSnapshot();
    expect(linkedSnapshot.document.explicitLinks).toHaveLength(1);
    expect(linkedSnapshot.renderScene.explicitLinks).toHaveLength(1);

    await controller.removeSelectionLinks();

    const unlinkedSnapshot = controller.getSnapshot();
    expect(unlinkedSnapshot.document.explicitLinks).toHaveLength(0);
    expect(unlinkedSnapshot.renderScene.explicitLinks).toHaveLength(0);

    controller.dispose();
  });

  it("undoes and redoes document commands without losing the workbench snapshot", async () => {
    const controller = createWorkbenchController();
    const initialCount = controller.getSnapshot().document.entityOrder.length;

    controller.armPlacement("pipe_straight_1x1", "pipe");
    await controller.handleCanvasClick(
      toScreenPointForGrid(controller, { x: 26, y: 4 }),
    );

    expect(controller.getSnapshot().document.entityOrder).toHaveLength(initialCount + 1);
    expect(controller.getSnapshot().history.canUndo).toBe(true);

    await controller.undo();
    expect(controller.getSnapshot().document.entityOrder).toHaveLength(initialCount);
    expect(controller.getSnapshot().history.canRedo).toBe(true);

    await controller.redo();
    expect(controller.getSnapshot().document.entityOrder).toHaveLength(initialCount + 1);

    controller.dispose();
  });

  it("keeps simulation selection separate from edit session selection", async () => {
    const controller = createWorkbenchController();

    await controller.selectEntity("filler-1");
    controller.setMode("simulate");
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, "dark-outlet-1"),
    );

    const snapshot = controller.getSnapshot();

    expect(snapshot.canvas.activeBackend).toBe("simulation");
    expect(snapshot.activeCanvas.selectedEntityIds).toEqual(["dark-outlet-1"]);
    expect(snapshot.session.selection).toEqual(["filler-1"]);

    controller.dispose();
  });
});
