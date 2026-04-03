import { describe, expect, it } from "vitest";
import { resolveCanvasPanelTapIntent } from "@/app-shell/components/canvas-panel/canvas-panel-tap-intent";

describe("resolveCanvasPanelTapIntent", () => {
  it("selects simulation entities and clears simulation selection on blank taps", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "simulate",
        activeTool: "select",
        placementDefinitionId: null,
        placementStrategy: null,
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
        placementStrategy: null,
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
        placementStrategy: null,
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
        placementStrategy: null,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "activate-link-target",
      entityId: null,
    });
  });

  it("commits pointer-follow placement only on blank taps", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "belt",
        placementDefinitionId: "belt_straight_1x1",
        placementStrategy: "pointer-follow",
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
        placementStrategy: "pointer-follow",
        target: {
          kind: "entity",
          entityId: "filler-1",
          selected: false,
        },
      }),
    ).toEqual({
      kind: "select-edit-entity",
      entityId: "filler-1",
    });
  });

  it("keeps anchored-confirm blank taps as no-ops", () => {
    expect(
      resolveCanvasPanelTapIntent({
        mode: "edit",
        activeTool: "place",
        placementDefinitionId: "item_port_mix_pool_1",
        placementStrategy: "anchored-confirm",
        target: {
          kind: "blank",
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
        placementStrategy: null,
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
        placementStrategy: null,
        target: {
          kind: "blank",
        },
      }),
    ).toEqual({
      kind: "clear-edit-selection",
    });
  });
});
