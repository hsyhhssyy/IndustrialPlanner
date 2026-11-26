// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AppHost } from "@/app/host/app-host";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";
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
    sync: null,
    audio: null,
    blueprintPlanner: null,
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
      selectedCustomFilterIndex={null}
      onDesktopCategoryChange={setDesktopCategory}
      onEntityClick={() => {}}
      onItemClick={() => {}}
      onMobileSelectedCategoriesChange={setMobileSelectedCategories}
      onQueryChange={setQuery}
      onSelectedCustomFilterChange={() => {}}
      query={query}
      t={t}
    />
  );
}

it("用同一条物料配方双向反查六条阵列转化，包括两种衡产物", () => {
  const registry = createRegistryContract();
  const index = buildEncyclopediaIndex(registry.itemDefinitions, registry.entityDefinitions, registry.recipeDefinitions);
  const recipes = registry.recipeDefinitions.filter(recipe => recipe.behavior);
  expect(recipes).toHaveLength(6);
  for (const recipe of recipes) {
    expect(index.recipesByInputItem.get(recipe.inputs[0]!.itemId)).toContain(recipe);
    expect(index.recipesByOutputItem.get(recipe.outputs[0]!.itemId)).toContain(recipe);
    expect(index.recipesByMachine.get(recipe.machineId)).toContain(recipe);
  }
});

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

  it("hides empty mobile categories after external item filtering", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppTestHost(workspace);
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

  // 2026-11-25：周期转化配方的映射在 program 中，反查索引必须展开它，
  // 息壤 / 明状息壤页面才能显示概率配方。
  it("indexes periodic range conversion mappings for item reverse lookups", () => {
    const registry = createRegistryContract();
    const index = buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    );

    expect((index.recipesByInputItem.get("item_xiranite_powder") ?? []).map((recipe) => recipe.id))
      .toEqual(expect.arrayContaining(["r_magic_spawner_range_ming_xiranite"]));
    expect((index.recipesByOutputItem.get("item_xiranite_ming") ?? []).map((recipe) => recipe.id))
      .toEqual(expect.arrayContaining(["r_magic_spawner_range_ming_xiranite"]));
    expect((index.recipesByOutputItem.get("item_xiranite_enr_heng") ?? []).map((recipe) => recipe.id))
      .toEqual(expect.arrayContaining(["r_magic_spawner_range_heng_xiranite"]));
  });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//       .toEqual(expect.arrayContaining(["r_magic_spawner_ming"]));
//
//       .toEqual(expect.arrayContaining(["r_magic_spawner_ming"]));
//
//       .toEqual(expect.arrayContaining(["r_magic_spawner_heng"]));
