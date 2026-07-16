// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { EncyclopediaPanel } from "@/app/shell/encyclopedia/encyclopedia-panel";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
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

function getRecipeGroupTitles(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll(".encyclopedia-recipe-group-title"))
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

  it("does not push the current item again when clicking it from a recipe", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "item", id: "item_copper_ore" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "item",
        id: "item_copper_ore",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    const copperOreName = currentAppHost.actions.translate("registry.item.item_copper_ore.name");
    const currentItemRecipeButton = Array.from(
      container.querySelectorAll(".encyclopedia-recipe-row"),
    ).find((element) => element.textContent?.includes(copperOreName)) as HTMLButtonElement | undefined;

    expect(currentItemRecipeButton).toBeDefined();

    act(() => {
      currentItemRecipeButton?.click();
    });

    expect(currentAppHost.internalState.workbench.toolbox.wiki.navigationStack).toEqual([
      { type: "item", id: "item_copper_ore" },
    ]);
    expect(currentAppHost.internalState.workbench.toolbox.wiki.openedPage).toEqual({
      kind: "item",
      id: "item_copper_ore",
    });
  });

  it("shows output recipes above input recipes for item pages", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "item", id: "item_iron_cmpt" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "item",
        id: "item_iron_cmpt",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.asOutput"),
      currentAppHost.actions.translate("encyclopedia.group.asInput"),
    ]);
  });

  it("moves tagged liquid bottle recipes into dedicated groups", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "item", id: "item_iron_bottle_filled_water" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "item",
        id: "item_iron_bottle_filled_water",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.liquidFilling"),
      currentAppHost.actions.translate("encyclopedia.group.liquidDismantle"),
    ]);
  });

  it("renders regular recipe groups before liquid bottle groups", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "item", id: "item_liquid_water" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "item",
        id: "item_liquid_water",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.asOutput"),
      currentAppHost.actions.translate("encyclopedia.group.asInput"),
      currentAppHost.actions.translate("encyclopedia.group.liquidFilling"),
      currentAppHost.actions.translate("encyclopedia.group.liquidDismantle"),
    ]);
  });

  it("shows liquid filling recipes below generic machine recipes", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "entity", id: "item_port_liquid_filling_pd_mc_1" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "entity",
        id: "item_port_liquid_filling_pd_mc_1",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.asMachine"),
      currentAppHost.actions.translate("encyclopedia.group.liquidFilling"),
    ]);
  });

  it("groups every filling machine recipe under bottle filling", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "entity", id: "item_port_filling_pd_mc_1" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "entity",
        id: "item_port_filling_pd_mc_1",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.liquidFilling"),
    ]);
  });

  it("shows the required gas environment beside the recipe machine", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "item", id: "item_gas_copper_enr2" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "item",
        id: "item_gas_copper_enr2",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    const environment = container.querySelector(
      ".encyclopedia-recipe-gas-environment",
    ) as HTMLButtonElement | null;

    expect(environment?.textContent).toBe("酸气环境");

    act(() => {
      environment?.click();
    });

    expect(currentAppHost.internalState.workbench.toolbox.wiki.openedPage).toEqual({
      kind: "item",
      id: "item_gas_acid",
    });
  });

  it("shows a device's single metered consumption item beside the machine", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "entity", id: "transmuter_1_gastrans" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "entity",
        id: "transmuter_1_gastrans",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    const consumption = container.querySelector(
      ".encyclopedia-recipe-device-consumption",
    );

    expect(consumption?.textContent).toBe("消耗清水");
    expect(consumption?.querySelectorAll(".encyclopedia-recipe-consumed-item")).toHaveLength(1);
  });

  it("marks multiple metered consumption items as alternatives", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "entity", id: "vaporizer_1" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "entity",
        id: "vaporizer_1",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    const consumption = container.querySelector(
      ".encyclopedia-recipe-device-consumption",
    );

    expect(consumption?.textContent).toBe("消耗（任选）酸气惰气水蒸气息壤气");
    expect(consumption?.querySelectorAll(".encyclopedia-recipe-consumed-item")).toHaveLength(4);
  });

  it("shows liquid dismantle recipes below generic machine recipes", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    runInAction(() => {
      currentAppHost.internalState.workbench.toolbox.wiki.navigationStack = [
        { type: "entity", id: "item_port_dismantler_1" },
      ];
      currentAppHost.internalState.workbench.toolbox.wiki.openedPage = {
        kind: "entity",
        id: "item_port_dismantler_1",
      };
    });

    act(() => {
      root.render(<EncyclopediaPanel appHost={currentAppHost} isTouch={false} />);
    });

    // 当前拆瓶器全部 67 条配方均带 liquid_bottle_dismantle 标签，asMachine 分组为空不渲染
    // AI-CORRECTION 2026-07-16: 新增气罐拆解配方已补同标签，拆解机仍不渲染 asMachine 分组。
    expect(getRecipeGroupTitles(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.group.liquidDismantle"),
    ]);
  });
});
