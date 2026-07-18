// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import {
  EncyclopediaBrowser,
  buildEncyclopediaIndex,
} from "@/app/shell/encyclopedia/encyclopedia-browser";
import type {
  ToolboxWikiDesktopCategory,
  ToolboxWikiMobileFilterOption,
} from "@/app/toolbox-types";
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

function getDropdownItemLabels(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll(".encyclopedia-category-dropdown-item"))
    .map((node) => node.textContent?.replace("✓", "").trim() ?? "")
    .filter((text) => text.length > 0);
}

function BrowserHarness({ appHost }: { appHost: AppHost }) {
  const registry = appHost.workspace.registry;
  const t = appHost.actions.translate;
  const index = useMemo(
    () => buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    ),
    [registry],
  );
  const [query, setQuery] = useState("");
  const [desktopCategory, setDesktopCategory] = useState<ToolboxWikiDesktopCategory>("all");
  const [mobileSelectedCategories, setMobileSelectedCategories] = useState<ToolboxWikiMobileFilterOption[]>([]);

  return (
    <EncyclopediaBrowser
      desktopCategory={desktopCategory}
      entityFilter={() => false}
      index={index}
      isTouch
      itemFilter={(item) => item.id === "item_copper_ore"}
      locale="zh-CN"
      mobileSelectedCategories={mobileSelectedCategories}
      onDesktopCategoryChange={setDesktopCategory}
      onEntityClick={() => {}}
      onItemClick={() => {}}
      onMobileSelectedCategoriesChange={setMobileSelectedCategories}
      onQueryChange={setQuery}
      query={query}
      t={t}
    />
  );
}

describe("EncyclopediaBrowser", () => {
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

  it("filters toolbox-hidden recipes from recipe indexes", () => {
    const registry = createRegistryContract();
    const index = buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    );

    expect(index.recipesByInputItem.get("any")).toBeUndefined();
    expect(index.recipesByMachine.get("item_port_udpipe_loader_1")?.map((recipe) => recipe.id) ?? [])
      .not.toContain("r_udpipe_loader_void_fluid_any_internal");
    expect(index.recipesByMachine.get("item_port_udpipe_loader_2")?.map((recipe) => recipe.id) ?? [])
      .not.toContain("r_udpipe_loader_multi_void_fluid_any_internal");
  });

  it("hides empty mobile categories after external item filtering", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(<BrowserHarness appHost={currentAppHost} />);
    });

    expect(getCardLabels(container)).toEqual([
      currentAppHost.actions.translate("registry.item.item_copper_ore.name"),
    ]);

    const dropdownTrigger = container.querySelector(
      ".encyclopedia-category-dropdown-trigger",
    ) as HTMLButtonElement | null;

    expect(dropdownTrigger).not.toBeNull();

    act(() => {
      dropdownTrigger?.click();
    });

    expect(getDropdownItemLabels(container)).toEqual([
      currentAppHost.actions.translate("encyclopedia.category.all"),
      currentAppHost.actions.translate("encyclopedia.category.items"),
    ]);
  });
});
