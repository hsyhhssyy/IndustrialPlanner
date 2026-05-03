// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { EncyclopediaPanel } from "@/app/shell/components/encyclopedia-panel";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

function getCardLabels(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll(".encyclopedia-card-label"))
    .map((node) => node.textContent ?? "")
    .filter((text) => text.length > 0);
}

describe("EncyclopediaPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost | null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    appHost?.dispose();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("excludes bottled liquids by default on touch and restores them when filters are cleared", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    const translate = currentAppHost.actions.translate;
    const bottledLiquidName = translate("registry.item.item_copper_bottle_filled_water.name");
    const regularItemName = translate("registry.item.item_copper_ore.name");
    const excludeFilterLabel = translate("encyclopedia.filter.excludeBottledLiquid");
    const allLabel = translate("encyclopedia.category.all");

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch />);
    });

    expect(currentAppHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual([
      "excludeBottledLiquid",
    ]);
    expect(container.querySelector(".encyclopedia-category-dropdown-label")?.textContent).toBe(
      excludeFilterLabel,
    );
    expect(getCardLabels(container)).toContain(regularItemName);
    expect(getCardLabels(container)).not.toContain(bottledLiquidName);

    const dropdownTrigger = container.querySelector(
      ".encyclopedia-category-dropdown-trigger",
    ) as HTMLButtonElement | null;

    expect(dropdownTrigger).not.toBeNull();

    act(() => {
      dropdownTrigger?.click();
    });

    const clearFiltersButton = Array.from(
      container.querySelectorAll(".encyclopedia-category-dropdown-item"),
    ).find((element) => element.textContent?.includes(allLabel)) as HTMLButtonElement | undefined;

    expect(clearFiltersButton).toBeDefined();

    act(() => {
      clearFiltersButton?.click();
    });

    expect(currentAppHost.internalState.workbench.toolbox.wiki.mobileSelectedCategories).toEqual([]);
    expect(getCardLabels(container)).toContain(bottledLiquidName);
  });
});