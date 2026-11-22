// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createWorldDocument } from "@/domain/document/world-document";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { lookupText } from "@/shared/i18n";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID } from "@/shared/registry/recipe-channel-eligibility";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";

const machineId = "fixture-converter";
const channelId = "fixture-mode";
const effect = { probabilityByLayer: [1], outputItemByInputId: {} };
const program: PeriodicRangeConversionProgram = {
  id: "fixture-program",
  periodSeconds: 1,
  effects: [effect, effect, effect],
};
const ming: RecipeDefinition = {
  id: "fixture-first",
  nameKey: "fixture-first",
  machineId,
  durationSeconds: 1,
  inputs: [],
  outputs: [],
  recipeType: "reserved-item",
  tags: [CONSUMPTION_RECIPE_TAG, TOOLBOX_HIDDEN_RECIPE_TAG],
  periodicRangeConversion: { side: 0, rangeIds: ["fixture-area"], program },
};
const hui: RecipeDefinition = {
  ...ming,
  id: "fixture-second",
  nameKey: "fixture-second",
  periodicRangeConversion: { side: 1, rangeIds: ["fixture-area"], program: { ...program } },
};

describe("周期范围转换配方 Inspector", () => {
  let container: HTMLDivElement;
  let root: Root;
  let app: AppHost | undefined;
  let editor: ReturnType<typeof createEditorTestHost> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    app?.dispose();
    editor?.dispose();
    app = undefined;
    editor = undefined;
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderSelection(recipes: readonly RecipeDefinition[], manualRecipeOnly = true, consumption = true, dedicated = false) {
    const channelIds = dedicated ? [channelId, CUSTOM_PERIODIC_PHASE_CHANNEL_ID] : [channelId];
    const baseRegistry = createRegistryContract();
    const definition: EntityDefinition = {
      id: machineId, nameKey: machineId, spriteId: "fixture", iconPath: "",
      footprint: { width: 1, height: 1 },
      displayOrder: 1, uiGroup: "hidden", tags: [],
      requiresPower: false, powerDemand: 0,
      placementBehaviors: [], portGroups: [], storageSlotGroups: [], portStorageBindings: [],
      inspectors: [{ type: INSPECTOR_TYPE.recipeStatus, channelIds }],
      ranges: ["fixture-area", "fixture-other-area"].map((id, x) => ({
        id, localRect: { x, y: 0, width: 1, height: 1 }, coverage: "intersects", visualId: "fixture",
      })),
      recipeChannels: channelIds.map(id => ({
        id, type: consumption ? "consumption-channel" : "normal-channel", manualRecipeOnly,
        ingredientStorageGroupIds: [], productStorageGroupIds: [],
      })),
    };
    const registry = {
      ...baseRegistry,
      entityDefinitions: [...baseRegistry.entityDefinitions, definition],
      recipeDefinitions: [...baseRegistry.recipeDefinitions, ...recipes],
    };
    registry.queries = createRegistryQuery(registry);
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry, app: null, editor: null, render: null,
      simulation: null, sync: null, audio: null, blueprintPlanner: null,
    };
    const world = createWorldDocument({ baseId: "draft_box" });
    world.entities.fixture = {
      id: "fixture",
      definitionId: machineId,
      position: { x: 0, y: 0 }, rotation: 0, tags: [],
      config: { channelRecipes: { "fixture-other": "existing" }, otherConfig: true },
    };
    world.entityOrder = ["fixture"];
    const currentEditor = createEditorTestHost(workspace, { persistence: "memory", initialDocument: world });
    editor = currentEditor;
    currentEditor.internalState.collections.selection.replace(["fixture"]);
    const currentApp = createAppTestHost(workspace);
    app = currentApp;
    act(() => {
      root.render(<SelectionInspectorSlot appHost={currentApp} translate={(key) => lookupText("zh-CN", key) ?? key} />);
      vi.advanceTimersByTime(50);
    });
    return currentEditor;
  }

  function getButtons() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="明晦模式"] button')];
  }

  it("从手选消耗通道切换两种配方，保留最新的其他通道和设备配置", () => {
    const currentEditor = renderSelection([hui, ming]);
    const buttons = getButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(["明", "晦"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(container.textContent).not.toContain(lookupText("zh-CN", "productionPlanning.addRecipe"));

    act(() => buttons[1]!.click());
    act(() => vi.advanceTimersByTime(50));
    expect(getButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);

    act(() => {
      currentEditor.actions.patchEntityConfig("fixture", {
        channelRecipes: { [channelId]: hui.id, "fixture-other": "updated" },
      });
      getButtons()[0]!.click();
    });
    act(() => vi.advanceTimersByTime(50));
    expect(getButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(currentEditor.queries.getEntityById("fixture")?.config).toEqual({
      channelRecipes: { [channelId]: ming.id, "fixture-other": "updated" },
      otherConfig: true,
    });
  });

  it("保留混合用途普通通道的通用配方入口", () => {
    const first = { ...ming, tags: [] };
    const second = { ...hui, tags: [] };
    const regular: RecipeDefinition = {
      id: "fixture-regular", nameKey: "fixture-regular", machineId, durationSeconds: 1,
      inputs: [], outputs: [], recipeType: "immediate-consume", tags: [],
    };
    renderSelection([first, second, regular], true, false);
    expect(getButtons()).toEqual([]);
    expect(container.textContent).toContain(lookupText("zh-CN", "productionPlanning.addRecipe"));
  });

  it("专用相位通道与同设备的普通手选通道各自提供候选", () => {
    const regular: RecipeDefinition = {
      id: "fixture-regular", nameKey: "fixture-regular", machineId, durationSeconds: 1,
      inputs: [], outputs: [], recipeType: "immediate-consume", tags: [],
    };
    renderSelection([{ ...ming, tags: [] }, { ...hui, tags: [] }, regular], true, false, true);

    expect(getButtons().map(button => button.textContent)).toEqual(["明", "晦"]);
    const addRecipe = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      button => button.textContent === lookupText("zh-CN", "productionPlanning.addRecipe"),
    );
    expect(addRecipe).toBeDefined();
    act(() => addRecipe!.click());
    expect(app?.recipePicker.source).toMatchObject({ kind: "recipes", recipes: [{ id: regular.id }] });
  });

  it("隐藏的非周期配方不占用普通通道的选择入口", () => {
    const hidden: RecipeDefinition = {
      id: "fixture-hidden", nameKey: "fixture-hidden", machineId, durationSeconds: 1,
      inputs: [], outputs: [], recipeType: "immediate-consume", tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
    };
    renderSelection([{ ...ming, tags: [] }, { ...hui, tags: [] }, hidden], true, false);
    expect(getButtons().map((button) => button.textContent)).toEqual(["明", "晦"]);
  });

  it.each([
    { name: "普通配方混入消耗通道", recipes: [ming, { ...hui, tags: [] }] },
    { name: "来自另一设备", recipes: [ming, { ...hui, machineId: "fixture-foreign" }] },
    { name: "两条配方同侧", recipes: [ming, { ...hui, periodicRangeConversion: ming.periodicRangeConversion }] },
    { name: "范围不一致", recipes: [ming, { ...hui, periodicRangeConversion: {
      side: 1, rangeIds: ["fixture-other-area"], program,
    } }] satisfies RecipeDefinition[] },
    { name: "程序内容不一致", recipes: [ming, { ...hui, periodicRangeConversion: {
      side: 1, rangeIds: ["fixture-area"], program: { ...program, periodSeconds: 2 },
    } }] satisfies RecipeDefinition[] },
    { name: "未开放活动", recipes: [ming, { ...hui, tags: [CONSUMPTION_RECIPE_TAG, "activity:fixture-inactive"] }] },
    { name: "自动通道", recipes: [ming, hui], manual: false },
  ])("不在 $name 时显示切换", ({ recipes, manual }) => {
    renderSelection(recipes, manual);
    expect(getButtons()).toEqual([]);
  });
});
