import { describe, expect, it } from "vitest";
import { resolveCanvasPanelTapIntent } from "@/app-shell/components/canvas-panel/canvas-panel-tap-intent";

describe("resolveCanvasPanelTapIntent", () => {
  it("selects simulation entities and clears simulation selection on blank taps", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "simulate",
        activeTool: "select",
        placementDefinitionId: null,
        placementInteractionMode: null,
        target: {
          kind: "entity",
          entityId: "reactor-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "select-simulation-entity",
      entityId: "reactor-1",
    });

    expect(
      resolveCanvasPanelTapIntent({
        mode: "simulate",
        activeTool: "select",
        placementDefinitionId: null,
        placementInteractionMode: null,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "select-simulation-entity",
      entityId: null,
    });
  });

  it("routes link taps through explicit link-target activation", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "link",
        placementDefinitionId: null,
        placementInteractionMode: null,
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
        mode: "edit",
        activeTool: "link",
        placementDefinitionId: null,
        placementInteractionMode: null,
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
        mode: "edit",
        activeTool: "belt",
        placementDefinitionId: "belt_straight_1x1",
        placementInteractionMode: "pointer",
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "commit-placement",
    });

    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "belt",
        placementDefinitionId: "belt_straight_1x1",
        placementInteractionMode: "pointer",
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
        mode: "edit",
        activeTool: "place",
        placementDefinitionId: "item_port_mix_pool_1",
        placementInteractionMode: "touch",
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "noop",
    });

    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "place",
        placementDefinitionId: "item_port_mix_pool_1",
        placementInteractionMode: "touch",
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

  it("falls back to edit selection semantics outside placement and link flows", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "select",
        placementDefinitionId: null,
        placementInteractionMode: null,
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
        mode: "edit",
        activeTool: "select",
        placementDefinitionId: null,
        placementInteractionMode: null,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "clear-edit-selection",
    });
  });
});
