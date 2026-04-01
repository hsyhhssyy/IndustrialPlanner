import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RightDock } from "@/app-shell/components/right-dock";
import { createWorkbenchController } from "@/app-shell/controller/workbench-controller";

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

describe("RightDock inspector split", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders edit and simulation inspector bodies from different mode-specific panels", async () => {
    const controller = createWorkbenchController();

    controller.setLocale("en-US");
    await controller.selectEntity("reactor-1");
    const editMarkup = renderToStaticMarkup(
      <RightDock controller={controller} snapshot={controller.getSnapshot()} />,
    );

    controller.setMode("simulate");
    await controller.handleCanvasClick(
      toScreenPointForEntity(controller, "dark-outlet-1"),
    );
    const simulationMarkup = renderToStaticMarkup(
      <RightDock controller={controller} snapshot={controller.getSnapshot()} />,
    );

    expect(editMarkup).toContain("Quick Actions");
    expect(editMarkup).toContain("Config Fields");
    expect(simulationMarkup).toContain("Runtime Details");
    expect(simulationMarkup).not.toContain("Quick Actions");
    expect(simulationMarkup).not.toContain("Config Fields");

    controller.dispose();
  });
});
