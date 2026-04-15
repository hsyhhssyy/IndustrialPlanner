import { describe, expect, it } from "vitest";
import {
  resolveCanvasPointerDownRoute,
  resolveCanvasTouchDownRoute,
  resolveSelectedEntityMoveCandidate,
} from "@/app/app-shell/components/canvas-panel/canvas-panel-interaction-router";
import {
  createMoveInteractionMode,
  createPlacementInteractionMode,
  createSelectInteractionMode,
} from "@/editor/contracts/interaction-mode";

describe("canvas panel interaction router", () => {
  it("only treats a selected entity as a pointer move candidate in edit select mode", () => {
    expect(
      resolveSelectedEntityMoveCandidate({
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        selection: ["filler-1", "reactor-1"],
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: true,
        },
      }),
    ).toBe("filler-1");

    expect(
      resolveSelectedEntityMoveCandidate({
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        selection: ["filler-1"],
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: true,
        },
      }),
    ).toBe("filler-1");

    expect(
      resolveSelectedEntityMoveCandidate({
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          displayTool: "belt",
          inputMode: "pointer",
          rotation: 0,
        }),
        selectionModifierActive: false,
        selection: ["filler-1"],
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: true,
        },
      }),
    ).toBeNull();
  });

  it("resolves pointer down routes for primary, secondary, pan, and ignore", () => {
    expect(
      resolveCanvasPointerDownRoute({
        button: 0,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        screenPoint: { x: 10, y: 10 },
        selection: ["filler-1"],
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: true,
        },
      }),
    ).toEqual({
      kind: "primary",
      moveEntityId: "filler-1",
      marqueeSelectionMode: null,
    });

    expect(
      resolveCanvasPointerDownRoute({
        button: 2,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        screenPoint: { x: 10, y: 10 },
        selection: [],
        target: { kind: "blank" },
      }),
    ).toEqual({ kind: "secondary" });

    expect(
      resolveCanvasPointerDownRoute({
        button: 1,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        screenPoint: { x: 10, y: 10 },
        selection: [],
        target: { kind: "blank" },
      }),
    ).toEqual({ kind: "pan" });

    expect(
      resolveCanvasPointerDownRoute({
        button: 4,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        screenPoint: { x: 10, y: 10 },
        selection: [],
        target: { kind: "blank" },
      }),
    ).toEqual({ kind: "ignore" });

    expect(
      resolveCanvasPointerDownRoute({
        button: 0,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: true,
        screenPoint: { x: 10, y: 10 },
        selection: ["filler-1"],
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: true,
        },
      }),
    ).toEqual({
      kind: "primary",
      moveEntityId: "filler-1",
      marqueeSelectionMode: null,
    });

    expect(
      resolveCanvasPointerDownRoute({
        button: 0,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        screenPoint: { x: 10, y: 10 },
        selection: ["filler-1"],
        target: {
          kind: "entity",
          entityId: "reactor-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "primary",
      moveEntityId: null,
      marqueeSelectionMode: "replace",
    });

    expect(
      resolveCanvasPointerDownRoute({
        button: 0,
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: true,
        screenPoint: { x: 10, y: 10 },
        selection: ["filler-1"],
        target: { kind: "blank" },
      }),
    ).toEqual({
      kind: "primary",
      moveEntityId: null,
      marqueeSelectionMode: "toggle",
    });
  });

  it("routes touch down to placement, move, or gesture based on current affordance", () => {
    expect(
      resolveCanvasTouchDownRoute({
        anchoredMoveScreenBox: null,
        anchoredPlacementActive: true,
        anchoredPlacementScreenBox: {
          left: 20,
          top: 20,
          width: 40,
          height: 20,
        },
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          displayTool: "belt",
          inputMode: "touch",
          rotation: 0,
        }),
        screenPoint: { x: 30, y: 25 },
        selection: [],
        target: { kind: "blank" },
      }),
    ).toEqual({
      kind: "placement-or-pan",
      anchoredPlacementHit: true,
    });

    expect(
      resolveCanvasTouchDownRoute({
        anchoredMoveScreenBox: {
          left: 20,
          top: 20,
          width: 40,
          height: 20,
        },
        anchoredPlacementActive: false,
        anchoredPlacementScreenBox: null,
        currentMode: createMoveInteractionMode({
          entityId: "filler-1",
          inputMode: "touch",
          previousModeKey: "select",
        }),
        screenPoint: { x: 30, y: 25 },
        selection: ["filler-1"],
        target: { kind: "blank" },
      }),
    ).toEqual({ kind: "move" });

    expect(
      resolveCanvasTouchDownRoute({
        anchoredMoveScreenBox: null,
        anchoredPlacementActive: false,
        anchoredPlacementScreenBox: null,
        currentMode: createSelectInteractionMode(),
        screenPoint: { x: 5, y: 5 },
        selection: [],
        target: { kind: "blank" },
      }),
    ).toEqual({
      kind: "gesture",
      interactionTarget: { kind: "blank" },
      longPressMarqueeSelectionMode: "replace",
    });
  });
});
