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
});
