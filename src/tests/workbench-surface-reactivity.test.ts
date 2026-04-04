// @vitest-environment jsdom

import { BottomStatusBar } from "@/app-shell/components/bottom-status-bar";
import { LeftDock } from "@/app-shell/components/left-dock";
import { RightDock } from "@/app-shell/components/right-dock";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";
import { act, createElement, Fragment, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function toScreenPointForPlacementCenter(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const document = controller.documentStore.getSnapshot();
  const canvasView = controller.canvasViewStore.getSnapshot();
  const gridSize = document.documentSettings.gridSize * canvasView.zoom;

  return {
    x: (gridPoint.x + 0.5) * gridSize,
    y: (gridPoint.y + 0.5) * gridSize,
  };
}

describe("workbench surface observer reactivity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not re-render non-preview surfaces during placement preview updates", async () => {
    const controller = createWorkbenchController();
    controller.armPlacement("belt_straight_1x1", "belt");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderCounts = {
      leftDock: 0,
      rightDock: 0,
      bottomStatusBar: 0,
    };

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(
            Profiler,
            {
              id: "LeftDock",
              onRender: () => {
                renderCounts.leftDock += 1;
              },
            },
            createElement(LeftDock, { controller }),
          ),
          createElement(
            Profiler,
            {
              id: "RightDock",
              onRender: () => {
                renderCounts.rightDock += 1;
              },
            },
            createElement(RightDock, { controller }),
          ),
          createElement(
            Profiler,
            {
              id: "BottomStatusBar",
              onRender: () => {
                renderCounts.bottomStatusBar += 1;
              },
            },
            createElement(BottomStatusBar, { controller }),
          ),
        ),
      );
    });

    expect(renderCounts).toEqual({
      leftDock: 1,
      rightDock: 1,
      bottomStatusBar: 1,
    });

    await act(async () => {
      controller.updatePlacementPreviewFromScreenPoint(
        toScreenPointForPlacementCenter(controller, { x: 12, y: 8 }),
      );
      controller.updatePlacementPreviewFromScreenPoint(
        toScreenPointForPlacementCenter(controller, { x: 13, y: 8 }),
      );
    });

    expect(renderCounts).toEqual({
      leftDock: 1,
      rightDock: 1,
      bottomStatusBar: 1,
    });

    await act(async () => {
      root.unmount();
    });
    controller.dispose();
  });
});
