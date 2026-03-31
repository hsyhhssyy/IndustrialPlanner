import { describe, expect, it } from "vitest";
import { createWorkbenchController } from "@/app-shell/controller/workbench-controller";

describe("WorkbenchController scaffold", () => {
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
    expect(fillerSprite?.selected).toBe(true);
    expect(snapshot.renderScene.entities.length).toBeGreaterThan(0);

    controller.dispose();
  });
});
