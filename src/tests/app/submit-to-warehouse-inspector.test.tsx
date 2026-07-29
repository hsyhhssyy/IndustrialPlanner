// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { SubmitToWarehouseInspector } from "@/app/shell/inspector/submit-to-warehouse-inspector";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
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
  };
}

describe("SubmitToWarehouseInspector", () => {
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
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders as one switch and writes the fixed hidden submit recipe", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "storager_1");
    const entity = createEntity("storage-submit", definition.id);
    const patchEntityConfig = vi.fn();
    const appHost = buildAppHost(workspace, patchEntityConfig);

    renderInspector(appHost, definition, entity, null, root);

    expect(container.querySelector("[data-channel-id='warehouse_submit']")).not.toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("registry.recipe.r_warehouse_submit.name");
    expect(container.textContent).not.toContain("r_warehouse_submit");

    const toggle = container.querySelector<HTMLButtonElement>("[data-recipe-select='warehouse_submit']");
    expect(toggle?.getAttribute("role")).toBe("switch");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      toggle?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("storage-submit", {
      channelRecipes: {
        warehouse_submit: "r_warehouse_submit",
      },
    });
  });

  it("shows countdown while enabled and removes only the fixed submit channel when toggled off", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "storager_1");
    const entity = createEntity("storage-submit-enabled", definition.id, {
      channelRecipes: {
        warehouse_submit: "r_warehouse_submit",
        unrelated_channel: "keep-this",
      },
    });
    const patchEntityConfig = vi.fn();
    const appHost = buildAppHost(workspace, patchEntityConfig);

    renderInspector(appHost, definition, entity, createRuntimeStatus(), root);

    const toggle = container.querySelector<HTMLButtonElement>("[data-recipe-select='warehouse_submit']");
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("[data-countdown='warehouse_submit']")?.textContent).toBe("8s");

    act(() => {
      toggle?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("storage-submit-enabled", {
      channelRecipes: {
        unrelated_channel: "keep-this",
      },
    });
  });
});

function buildAppHost(
  workspace: WorkspaceContract,
  patchEntityConfig: ReturnType<typeof vi.fn>,
): AppHost {
  return {
    workspace: {
      ...workspace,
      editor: {
        actions: {
          patchEntityConfig,
        },
      },
    },
  } as unknown as AppHost;
}

function renderInspector(
  appHost: AppHost,
  definition: EntityDefinition,
  entity: WorldEntity,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
  currentRoot: Root,
) {
  act(() => {
    currentRoot.render(
      <SubmitToWarehouseInspector
        appHost={appHost}
        definition={definition}
        entity={entity}
        runtimeStatus={runtimeStatus}
        translate={(key) => key}
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
  config: WorldEntity["config"] = {},
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

function createRuntimeStatus(): SimulationDeviceRuntimeStatusReadModel {
  return {
    slotItems: [],
    powerStatus: "in-power-range",
    channelRecipes: {
      warehouse_submit: {
        channelId: "warehouse_submit",
        recipeId: "r_warehouse_submit",
        progressSeconds: 2.4,
        desiredSeconds: 10,
        state: "running",
      },
    },
  };
}
