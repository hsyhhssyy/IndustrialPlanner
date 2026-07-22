// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { RecipePickerDialog } from "@/app/shell/dialogs/recipe-picker-dialog";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
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

function findEntity(appHost: AppHost, entityId: string): EntityDefinition {
  const entity = appHost.workspace.registry.entityDefinitions.find((candidate) => candidate.id === entityId);

  if (entity === undefined) {
    throw new Error(`Missing entity ${entityId}`);
  }

  return entity;
}

function findRecipe(appHost: AppHost, recipeId: string): RecipeDefinition {
  const recipe = appHost.workspace.registry.recipeDefinitions.find((candidate) => candidate.id === recipeId);

  if (recipe === undefined) {
    throw new Error(`Missing recipe ${recipeId}`);
  }

  return recipe;
}

function queryRecipeButtons(container: ParentNode): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("[data-recipe-id]")) as HTMLButtonElement[];
}

function queryRecipeButton(container: ParentNode, recipeId: string): HTMLButtonElement | null {
  return container.querySelector(`[data-recipe-id="${recipeId}"]`) as HTMLButtonElement | null;
}

function dispatchInputEvent(target: HTMLInputElement, value: string): Event {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value");

  descriptor?.set?.call(target, value);
  const event = new Event("input", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("RecipePickerDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = createAppHost(createWorkspace());

    act(() => {
      root.render(<RecipePickerDialog appHost={appHost} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    appHost.dispose();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("limits recipes by the provided entity list and resolves the selected recipe id", async () => {
    const furnace = findEntity(appHost, "furnance_1");
    const recipeId = "r_furnace_iron_nugget_from_iron_ore_basic";
    let selectionPromise!: Promise<string | null>;

    act(() => {
      selectionPromise = appHost.recipePicker.pickRecipe({ entities: [furnace] });
    });

    expect(container.querySelector(".recipe-picker-dialog")).not.toBeNull();
    expect(container.querySelector("#recipe-picker-dialog-title")?.textContent).toBe("选择配方");
    expect(queryRecipeButton(container, recipeId)).not.toBeNull();
    expect(queryRecipeButtons(container).every((button) => button.textContent?.includes("精炼炉"))).toBe(true);
    expect(container.textContent).not.toContain("粉碎机");

    await act(async () => {
      queryRecipeButton(container, recipeId)?.click();
      await selectionPromise;
    });

    await expect(selectionPromise).resolves.toBe(recipeId);
    expect(container.querySelector(".recipe-picker-dialog")).toBeNull();
  });

  it("searches by output item, machine name, or ingredient item inside a provided recipe list", () => {
    const furnaceRecipe = findRecipe(appHost, "r_furnace_iron_nugget_from_iron_ore_basic");
    const crusherRecipe = findRecipe(appHost, "r_crusher_originium_powder_basic");
    let selectionPromise!: Promise<string | null>;

    act(() => {
      selectionPromise = appHost.recipePicker.pickRecipe({
        recipes: [furnaceRecipe, crusherRecipe],
      });
    });

    expect(queryRecipeButtons(container)).toHaveLength(2);

    const searchInput = container.querySelector(".recipe-picker-search input") as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();

    act(() => {
      dispatchInputEvent(searchInput as HTMLInputElement, "蓝铁块");
    });

    expect(queryRecipeButtons(container).map((button) => button.dataset.recipeId)).toEqual([
      furnaceRecipe.id,
    ]);

    act(() => {
      dispatchInputEvent(searchInput as HTMLInputElement, "粉碎机");
    });

    expect(queryRecipeButtons(container).map((button) => button.dataset.recipeId)).toEqual([
      crusherRecipe.id,
    ]);

    act(() => {
      dispatchInputEvent(searchInput as HTMLInputElement, "源矿");
    });

    expect(queryRecipeButtons(container).map((button) => button.dataset.recipeId)).toEqual([
      crusherRecipe.id,
    ]);

    act(() => {
      appHost.recipePicker.cancel();
    });

    return expect(selectionPromise).resolves.toBeNull();
  });

  it("shows the amount after every ingredient and product", () => {
    const recipe = findRecipe(appHost, "r_thickener_iron_enr_powder_from_iron_and_moss_powder_basic");

    act(() => {
      void appHost.recipePicker.pickRecipe({ recipes: [recipe] });
    });

    const recipeButton = queryRecipeButton(container, recipe.id);
    const amounts = Array.from(recipeButton?.querySelectorAll(".recipe-picker-item-amount") ?? [])
      .map((element) => element.textContent);

    expect(amounts).toEqual(["x2", "x1", "x1"]);
  });

  it("hides toolbox-hidden recipes from explicit recipe sources", () => {
    const hiddenRecipe = findRecipe(appHost, "r_udpipe_loader_void_fluid_any_internal");
    const visibleRecipe = findRecipe(appHost, "r_furnace_iron_nugget_from_iron_ore_basic");
    let selectionPromise!: Promise<string | null>;

    act(() => {
      selectionPromise = appHost.recipePicker.pickRecipe({
        recipes: [hiddenRecipe, visibleRecipe],
      });
    });

    expect(queryRecipeButtons(container).map((button) => button.dataset.recipeId)).toEqual([
      visibleRecipe.id,
    ]);

    act(() => {
      appHost.recipePicker.cancel();
    });

    return expect(selectionPromise).resolves.toBeNull();
  });
});
