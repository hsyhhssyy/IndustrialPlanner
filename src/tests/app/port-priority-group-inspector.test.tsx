// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { PortPriorityGroupInspector } from "@/app/shell/inspector/port-priority-group-inspector";
import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
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

describe("PortPriorityGroupInspector", () => {
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
    act(() => { root.unmount(); });
    appHost?.encyclopediaPicker.dispose();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders one disabled priority number per splitter port when custom is off", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "log_splitter");
    const entity = createEmptyEntity("splitter-1", "log_splitter");
    const currentAppHost = buildAppHost(workspace);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    expect(container.textContent).toContain("端口优先级组");
    // 自定义关闭时默认折叠，需先展开面板
    const expandToggle = container.querySelector<HTMLButtonElement>("[aria-label='展开端口优先级组']");
    act(() => { expandToggle?.click(); });

    expect(container.textContent).toContain("P1.1");
    expect(container.textContent).toContain("P1.2");
    expect(container.textContent).toContain("P1.3");
    expect(container.textContent).toContain("P2.1");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-port-priority-number]")];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.textContent)).toEqual(["5", "5", "5", "5"]);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("writes the custom switch state to entity config", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "log_splitter");
    const entity = createEmptyEntity("splitter-2", "log_splitter");
    const patchEntityConfig = vi.fn();
    const currentAppHost = buildAppHost(workspace, patchEntityConfig);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);
    const customSwitch = container.querySelector<HTMLInputElement>("[data-port-priority-custom-switch]");

    act(() => {
      customSwitch?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("splitter-2", {
      customPortPriorityGroups: true,
    });
  });

  it("opens the 1-9 picker and writes selected custom priority group", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "log_splitter");
    const entity: WorldEntity = {
      ...createEmptyEntity("splitter-3", "log_splitter"),
      config: {
        customPortPriorityGroups: true,
        portPriorityGroups: {
          "item_output:out_w": 7,
        },
      },
    };
    const patchEntityConfig = vi.fn();
    const currentAppHost = buildAppHost(workspace, patchEntityConfig);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);
    const outputWestRow = container.querySelector("[data-port-key='item_output:out_w']");
    const numberButton = outputWestRow?.querySelector<HTMLButtonElement>("[data-port-priority-number]");
    expect(numberButton?.disabled).toBe(false);
    expect(numberButton?.textContent).toBe("7");

    act(() => {
      numberButton?.click();
    });
    const priorityOneButton = outputWestRow?.querySelector<HTMLButtonElement>("[data-port-priority-choice='1']");
    act(() => {
      priorityOneButton?.click();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("splitter-3", {
      portPriorityGroups: {
        "item_output:out_w": 1,
      },
    });
  });
});

function requireDefinition(workspace: WorkspaceContract, id: string): EntityDefinition {
  const definition = workspace.registry.entityDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Expected definition ${id}.`);
  }

  return definition;
}

function createEmptyEntity(id: string, definitionId: string): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function buildAppHost(
  workspace: WorkspaceContract,
  patchEntityConfig = vi.fn(),
): AppHost {
  const picker = new WorkbenchEncyclopediaPickerController(() => ({
    desktopCategory: "all",
    mobileSelectedCategories: [],
  }));

  return {
    state: {
      screenProfile: {
        deviceClass: "desktop",
      },
    },
    workspace: {
      ...workspace,
      editor: {
        state: {
          viewport: {
            displayRotation: 0,
          },
        },
        actions: {
          patchEntityConfig,
          deleteEntityConfigKeys: vi.fn(),
        },
      },
    },
    encyclopediaPicker: picker,
    actions: { translate: (key: string) => key },
  } as unknown as AppHost;
}

function renderInspector(
  currentAppHost: AppHost,
  definition: EntityDefinition,
  entity: WorldEntity,
  currentRoot: Root,
) {
  act(() => {
    currentRoot.render(
      <PortPriorityGroupInspector
        appHost={currentAppHost}
        definition={definition}
        entity={entity}
      />,
    );
  });
}
