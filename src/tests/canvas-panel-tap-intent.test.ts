import { describe, expect, it } from "vitest";
import { resolveCanvasPanelTapIntent } from "@/app-shell/components/canvas-panel/canvas-panel-tap-intent";
import {
  createLinkInteractionMode,
  createMoveInteractionMode,
  createPlacementInteractionMode,
  createSelectInteractionMode,
} from "@/editor/contracts/interaction-mode";

describe("resolveCanvasPanelTapIntent", () => {
  it("ignores phase input and keeps following edit tap semantics", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "simulate",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "reactor-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "select-edit-entity",
      entityId: "reactor-1",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "simulate",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "clear-edit-selection",
    });
  });

  it("routes link taps through explicit link-target activation", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createLinkInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "dark-outlet-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "activate-link-target",
      entityId: "dark-outlet-1",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createLinkInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "activate-link-target",
      entityId: null,
    });
  });

  it("treats pointer placement taps as placement attempts before selection semantics", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          displayTool: "belt",
          inputMode: "pointer",
        }),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "commit-placement",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          displayTool: "belt",
          inputMode: "pointer",
        }),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "commit-placement",
    });
  });

  it("keeps touch placement taps as no-ops on both blank space and entities", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createPlacementInteractionMode({
          definitionId: "item_port_mix_pool_1",
          displayTool: "place",
          inputMode: "touch",
        }),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "noop",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createPlacementInteractionMode({
          definitionId: "item_port_mix_pool_1",
          displayTool: "place",
          inputMode: "touch",
        }),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "reactor-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "noop",
    });
  });

  it("keeps hidden move taps as no-ops until the draft resolves", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createMoveInteractionMode({
          entityId: "reactor-1",
          inputMode: "pointer",
        }),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "noop",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createMoveInteractionMode({
          entityId: "reactor-1",
          inputMode: "touch",
        }),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "reactor-1",
          selected: true,
        },
      }),
    ).toEqual({
      kind: "noop",
    });
  });

  it("falls back to edit selection semantics outside placement and link flows", () => {
    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "entity",
          entityId: "storage-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "select-edit-entity",
      entityId: "storage-1",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: false,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "clear-edit-selection",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: true,
        target: {
          kind: "entity",
          entityId: "storage-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "toggle-edit-entity",
      entityId: "storage-1",
    });

    expect(
      resolveCanvasPanelTapIntent({
        phase: "edit",
        currentMode: createSelectInteractionMode(),
        selectionModifierActive: true,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "noop",
    });
  });
});
