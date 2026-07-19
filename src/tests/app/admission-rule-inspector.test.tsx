// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { AdmissionRuleInspector } from "@/app/shell/inspector/admission-rule-inspector";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { AdmissionRuleInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
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
  };
}

describe("AdmissionRuleInspector", () => {
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

  it("selects one item and writes acceptRule plus admissionRule", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "log_admission");
    const declaration = requireAdmissionDeclaration(definition);
    const entity = createEntity("admission", definition.id);
    const patchEntityConfig = vi.fn();
    const pickItem = vi.fn<() => Promise<string | null>>().mockResolvedValue("item_iron_ore");
    const appHost = buildAppHost(workspace, { patchEntityConfig, pickItem });

    renderInspector(appHost, definition, declaration, entity, null, root);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-admission-action='pick-item']")?.click();
    });

    expect(pickItem).toHaveBeenCalledTimes(1);
    expect(patchEntityConfig).toHaveBeenCalledWith("admission", {
      "portGroups[0].ports[0].acceptRule": {
        base: { kind: "item", itemId: "item_iron_ore" },
        exclude: [],
      },
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: null,
      },
    });
  });

  it("edits total and per-minute limits, resets both counts, and clears both config paths", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "log_admission");
    const declaration = requireAdmissionDeclaration(definition);
    const entity = createEntity("admission", definition.id, {
      "portGroups[0].ports[0].acceptRule": {
        base: { kind: "item", itemId: "item_iron_ore" },
        exclude: [],
      },
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: 2,
        perMinuteLimit: 4,
      },
    });
    const patchEntityConfig = vi.fn();
    const deleteEntityConfigKeys = vi.fn();
    const resetAdmissionCounter = vi.fn();
    const appHost = buildAppHost(workspace, {
      patchEntityConfig,
      deleteEntityConfigKeys,
      resetAdmissionCounter,
    });

    renderInspector(appHost, definition, declaration, entity, createRuntimeStatus(), root);

    expect(container.querySelector("[data-admission-current-count]")?.textContent).toContain("2");
    expect(container.querySelector("[data-admission-current-minute-count]")?.textContent).toContain("1");
    expect(container.querySelector("[data-admission-action='change-item']")).toBeNull();

    const input = container.querySelector<HTMLInputElement>("[data-admission-limit-input]");
    if (input === null) {
      throw new Error("Expected admission limit input.");
    }
    const perMinuteInput = container.querySelector<HTMLInputElement>("[data-admission-per-minute-limit-input]");
    if (perMinuteInput === null) {
      throw new Error("Expected admission per-minute limit input.");
    }

    act(() => {
      setInputValue(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("admission", {
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: 5,
        perMinuteLimit: 4,
      },
    });

    act(() => {
      setInputValue(perMinuteInput, "7");
      perMinuteInput.dispatchEvent(new Event("input", { bubbles: true }));
      perMinuteInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("admission", {
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: 2,
        perMinuteLimit: 7,
      },
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-admission-action='reset-total-count']")?.click();
    });

    expect(resetAdmissionCounter).toHaveBeenCalledWith({
      entityId: "admission",
      portGroupId: "item_input",
      portId: "in_w",
      scope: "total",
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-admission-action='reset-minute-count']")?.click();
    });

    expect(resetAdmissionCounter).toHaveBeenCalledWith({
      entityId: "admission",
      portGroupId: "item_input",
      portId: "in_w",
      scope: "per-minute",
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-admission-action='clear-item']")?.click();
    });

    expect(deleteEntityConfigKeys).toHaveBeenCalledWith("admission", [
      "portGroups[0].ports[0].acceptRule",
      "portGroups[0].ports[0].admissionRule",
    ]);
  });
});

function buildAppHost(
  workspace: WorkspaceContract,
  options: {
    patchEntityConfig?: ReturnType<typeof vi.fn>;
    deleteEntityConfigKeys?: ReturnType<typeof vi.fn>;
    pickItem?: ReturnType<typeof vi.fn>;
    resetAdmissionCounter?: ReturnType<typeof vi.fn>;
  },
): AppHost {
  return {
    state: {
      screenProfile: {
        deviceClass: "desktop",
      },
    },
    workspace: {
      ...workspace,
      editor: {
        actions: {
          patchEntityConfig: options.patchEntityConfig ?? vi.fn(),
          deleteEntityConfigKeys: options.deleteEntityConfigKeys ?? vi.fn(),
        },
      },
      simulation: {
        actions: {
          resetAdmissionCounter: options.resetAdmissionCounter ?? vi.fn(),
        },
      },
    },
    encyclopediaPicker: {
      pickItem: options.pickItem ?? vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    },
  } as unknown as AppHost;
}

function renderInspector(
  appHost: AppHost,
  definition: EntityDefinition,
  declaration: AdmissionRuleInspectorDeclaration,
  entity: WorldEntity,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
  currentRoot: Root,
) {
  act(() => {
    currentRoot.render(
      <AdmissionRuleInspector
        appHost={appHost}
        declaration={declaration}
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

function requireAdmissionDeclaration(definition: EntityDefinition): AdmissionRuleInspectorDeclaration {
  const declaration = definition.inspectors.find((candidate) => candidate.type === "admission-rule");
  if (declaration === undefined || declaration.type !== "admission-rule") {
    throw new Error("Expected admission-rule inspector declaration.");
  }
  return declaration;
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
    channelRecipes: {},
    admissionCounters: {
      "item_input:in_w": {
        portGroupId: "item_input",
        portId: "in_w",
        itemType: "item_iron_ore",
        limit: 2,
        count: 2,
        perMinuteLimit: 4,
        perMinuteCount: 1,
      },
    },
    powerStatus: "in-power-range",
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter === undefined) {
    input.value = value;
    return;
  }

  setter.call(input, value);
}
