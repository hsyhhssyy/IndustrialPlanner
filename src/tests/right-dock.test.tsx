import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RightDock } from "@/app-shell/components/right-dock";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";

describe("RightDock inspector split", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders edit and simulation inspector bodies from different phase-specific panels", async () => {
    const controller = createWorkbenchController();

    controller.setLocale("en-US");
    await controller.selectEntity("reactor-1");
    const editMarkup = renderToStaticMarkup(
      <RightDock controller={controller} />,
    );

    controller.setPhase("simulate");
    await controller.selectSimulationEntity("dark-outlet-1");
    const simulationMarkup = renderToStaticMarkup(
      <RightDock controller={controller} />,
    );

    expect(editMarkup).toContain("Quick Actions");
    expect(editMarkup).toContain("Config Fields");
    expect(editMarkup).toContain("80x80");
    expect(editMarkup).toContain("Wuling");
    expect(simulationMarkup).toContain("Runtime Details");
    expect(simulationMarkup).toContain("Runtime Patch");
    expect(simulationMarkup).not.toContain("Quick Actions");
    expect(simulationMarkup).not.toContain("Config Fields");

    controller.dispose();
  });

  it("renders a dedicated summary instead of single-entity details for multi-selection", async () => {
    const controller = createWorkbenchController();

    controller.setLocale("en-US");
    await controller.selectEntity("reactor-1", "pointer");
    await controller.selectEntity("filler-1", "pointer", "toggle");
    const markup = renderToStaticMarkup(<RightDock controller={controller} />);

    expect(markup).toContain("2 selected");
    expect(markup).toContain("Multiple selection currently shows shared actions only");
    expect(markup).not.toContain("Config Fields");

    controller.dispose();
  });
});
