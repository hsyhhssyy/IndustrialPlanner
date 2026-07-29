// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { SimulationRecipeStatusRuntimeInspector } from "@/app/shell/inspector/simulation-recipe-status-runtime-inspector";
import { buildProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createRegistryContract } from "@/registry";
import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

describe("反应池配方 Channel 模式开关", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders an old reactor as manual and writes automatic mode from the title switch", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "mix_pool_1");
    const entity = createEntity("reactor", definition.id, {});
    const patchEntityConfig = vi.fn();

    renderInspector({ workspace, definition, entity, patchEntityConfig, root });

    const modeSwitch = container.querySelector<HTMLInputElement>(
      "[data-recipe-channel-mode-switch]",
    );
    expect(modeSwitch?.checked).toBe(false);
    expect(container.textContent).toContain("inspector.recipeChannelMode.manual");
    expect(container.textContent).toContain("productionPlanning.addRecipe");

    act(() => {
      modeSwitch?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("reactor", {
      [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
    });
  });

  it("renders automatic mode immediately from config and hides manual recipe controls", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "mix_pool_2");
    const entity = createEntity("reactor-auto", definition.id, {
      [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
    });

    renderInspector({
      workspace,
      definition,
      entity,
      patchEntityConfig: vi.fn(),
      root,
    });

    const modeSwitch = container.querySelector<HTMLInputElement>(
      "[data-recipe-channel-mode-switch]",
    );
    expect(modeSwitch?.checked).toBe(true);
    expect(container.textContent).toContain("inspector.recipeChannelMode.automatic");
    expect(container.textContent).not.toContain("productionPlanning.addRecipe");
  });

  it("moves a manually selected recipe to one channel instead of assigning it twice", async () => {
    const recipeId = "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic";
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "mix_pool_1");
    const entity = createEntity("reactor-manual", definition.id, {
      channelRecipes: { ch1: recipeId },
    });
    const patchEntityConfig = vi.fn();

    renderInspector({
      workspace,
      definition,
      entity,
      patchEntityConfig,
      pickedRecipeId: recipeId,
      root,
    });

    const addButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("productionPlanning.addRecipe"));
    await act(async () => {
      addButton?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("reactor-manual", {
      channelRecipes: { ch2: recipeId },
    });
  });
});

function renderInspector(options: {
  workspace: WorkspaceContract;
  definition: EntityDefinition;
  entity: WorldEntity;
  patchEntityConfig: ReturnType<typeof vi.fn>;
  pickedRecipeId?: string;
  root: Root;
}) {
  const appHost = {
    workspace: {
      ...options.workspace,
      editor: {
        actions: {
          patchEntityConfig: options.patchEntityConfig,
        },
      },
    },
    recipePicker: {
      pickRecipe: vi.fn().mockResolvedValue(options.pickedRecipeId ?? null),
    },
  } as unknown as AppHost;

  act(() => {
    options.root.render(
      <SimulationRecipeStatusRuntimeInspector
        appHost={appHost}
        channelIds={options.definition.recipeChannels.map((channel) => channel.id)}
        channels={options.definition.recipeChannels}
        definition={options.definition}
        entity={options.entity}
        index={buildProductionPlanningIndex(options.workspace.registry)}
        runtimeStatus={null}
        t={(key) => key}
      />,
    );
  });
}

function requireDefinition(workspace: WorkspaceContract, id: string): EntityDefinition {
  const definition = workspace.registry.entityDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Expected definition ${id}.`);
  }
  return definition;
}

function createEntity(
  id: string,
  definitionId: string,
  config: WorldEntity["config"],
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config,
    tags: [],
  };
}
