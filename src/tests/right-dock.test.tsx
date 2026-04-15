import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { getStage1EntityDefinition } from "@/domain/registry/stage1-registry";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import { createWorkbenchController as createWorkbenchControllerBase } from "@/workspace/workspace-controller";
import { asLegacyWorkbenchController } from "@/tests/helpers/legacy-workbench-controller";

const createWorkbenchController = (
  ...args: Parameters<typeof createWorkbenchControllerBase>
) => asLegacyWorkbenchController(createWorkbenchControllerBase(...args));

function toScreenPointForGrid(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const document = controller.documentStore.getSnapshot();
  const canvasView = controller.canvasViewStore.getSnapshot();
  const scaledGridSize = document.documentSettings.gridSize * canvasView.zoom;

  return {
    x: gridPoint.x * scaledGridSize + 1,
    y: gridPoint.y * scaledGridSize + 1,
  };
}

function resolveEntityBounds(
  controller: ReturnType<typeof createWorkbenchController>,
  entityIds: string[],
) {
  const document = controller.documentStore.getSnapshot();
  const registry = controller.registry;

  const bounds = getGridBoundingBox(
    entityIds.map((entityId) => {
      const entity = document.entities[entityId];

      if (!entity) {
        throw new Error(`Missing entity ${entityId}`);
      }

      const definition = getStage1EntityDefinition(registry, entity.definitionId);

      if (!definition) {
        throw new Error(`Missing definition ${entity.definitionId}`);
      }

      return {
        position: entity.position,
        footprint: getRotatedGridFootprint(
          definition.footprint,
          entity.rotation,
        ),
      };
    }),
  );

  if (!bounds) {
    throw new Error("Missing entity bounds");
  }

  return bounds;
}

describe("RightDock inspector split", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the edit inspector for a single selection", async () => {
    const controller = createWorkbenchController();

    controller.setLocale("en-US");
    await controller.selectEntity("reactor-1");
    const markup = renderToStaticMarkup(<RightDock controller={controller} />);

    expect(markup).toContain("Quick Actions");
    expect(markup).toContain("Config Fields");
    expect(markup).toContain("80x80");
    expect(markup).toContain("Wuling");
    expect(markup).toContain("Runtime Details");

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

  it("uses projected selection while marquee is still active", async () => {
    const controller = createWorkbenchController();
    const marqueeBounds = resolveEntityBounds(controller, ["reactor-1", "filler-1"]);

    controller.setLocale("en-US");
    await controller.selectEntity("reactor-1", "pointer");
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

    const markup = renderToStaticMarkup(<RightDock controller={controller} />);

    expect(markup).toContain("2 selected");
    expect(markup).not.toContain("Config Fields");

    controller.dispose();
  });
});
