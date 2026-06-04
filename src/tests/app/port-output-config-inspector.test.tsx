// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { PortOutputConfigInspector } from "@/app/shell/inspector/port-output-config-inspector";
import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
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

describe("PortOutputConfigInspector", () => {
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

  it("renders three output port group rows for reactor pool", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const entity = createEmptyEntity("reactor-1", "item_port_mix_pool_1");
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);

    const rows = container.querySelectorAll("[data-port-group-id]");
    expect(rows.length).toBe(3);
  });

  it("renders empty state when definition has no matching output port groups", () => {
    const workspace = createWorkspace();
    const definition: EntityDefinition = {
      id: "test-no-output", nameKey: "test", spriteId: "test",
      footprint: { width: 1, height: 1 }, uiGroup: "basicProduction",
      tags: [], displayOrder: 1, portGroups: [], storageSlotGroups: [],
      recipeChannels: [], portStorageBindings: [], links: [],
      placementBehaviors: [], inspectors: [],
      requiresPower: false, powerDemand: 0, powerRange: 0,
    };
    const entity = createEmptyEntity("empty-1", "test-no-output");
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);
    expect(container.textContent).toContain("无可用输出端口配置");
  });

  it("filters items: solid port shows only solid items, fluid port shows only liquid items", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const entity = createEmptyEntity("reactor-2", "item_port_mix_pool_1");
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    const ore = requireItem(workspace, "item_copper_ore");
    const liquid = requireItem(workspace, "item_liquid_water");
    renderInspector(currentAppHost, definition, entity, root);

    const solidPickBtn = container.querySelector<HTMLButtonElement>("[data-port-group-id='item_output'] [data-slot-action='pick-item']");
    act(() => { solidPickBtn?.click(); });
    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(false);
    await act(async () => { currentAppHost.encyclopediaPicker.cancel(); await Promise.resolve(); });

    const fluidPickBtn = container.querySelector<HTMLButtonElement>("[data-port-group-id='fluid_output_a'] [data-slot-action='pick-item']");
    act(() => { fluidPickBtn?.click(); });
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(false);
    await act(async () => { currentAppHost.encyclopediaPicker.cancel(); await Promise.resolve(); });
  });

  it("writes acceptRule config for all ports when user selects an item", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const initialEntity = createEmptyEntity("reactor-3", "item_port_mix_pool_1");
    let currentEntity: WorldEntity = initialEntity;

    const patchEntityConfig = vi.fn((_id: string, patch: Record<string, unknown>) => {
      currentEntity = { ...currentEntity, config: { ...currentEntity.config, ...patch } };
    });
    const deleteEntityConfigKeys = vi.fn();
    const currentAppHost = buildAppHostWithEditor(workspace, currentEntity, patchEntityConfig, deleteEntityConfigKeys);
    appHost = currentAppHost;
    const ore = requireItem(workspace, "item_copper_ore");

    renderInspector(currentAppHost, definition, currentEntity, root);
    const pickBtn = container.querySelector<HTMLButtonElement>("[data-port-group-id='item_output'] [data-slot-action='pick-item']");
    act(() => { pickBtn?.click(); });
    act(() => { currentAppHost.encyclopediaPicker.selectItem(ore.id); });
    await act(async () => { await Promise.resolve(); });

    expect(patchEntityConfig).toHaveBeenCalledWith("reactor-3", expect.objectContaining({
      "portGroups[0].ports[0].acceptRule": { base: { kind: "item", itemId: "item_copper_ore" }, exclude: [] },
      "portGroups[0].ports[1].acceptRule": { base: { kind: "item", itemId: "item_copper_ore" }, exclude: [] },
    }));
  });

  it("clears acceptRule config for all ports when user clears selection", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const initialEntity: WorldEntity = {
      ...createEmptyEntity("reactor-4", "item_port_mix_pool_1"),
      config: {
        "portGroups[0].ports[0].acceptRule": { base: { kind: "item", itemId: "item_copper_ore" }, exclude: [] },
      },
    };
    let currentEntity: WorldEntity = initialEntity;

    const patchEntityConfig = vi.fn();
    const deleteEntityConfigKeys = vi.fn((entityId: string, keys: string[]) => {
      if (entityId !== currentEntity.id) return;
      const toDelete = new Set<string>();
      for (const dk of keys) {
        for (const ck of Object.keys(currentEntity.config)) {
          if (ck === dk || ck.startsWith(dk + ".") || ck.startsWith(dk + "[")) toDelete.add(ck);
        }
      }
      const nc: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(currentEntity.config)) { if (!toDelete.has(k)) nc[k] = v; }
      currentEntity = { ...currentEntity, config: nc };
    });

    const currentAppHost = buildAppHostWithEditor(workspace, currentEntity, patchEntityConfig, deleteEntityConfigKeys);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, currentEntity, root);

    const clearBtn = container.querySelector<HTMLButtonElement>("[data-port-group-id='item_output'] [data-slot-action='clear-item']");
    expect(clearBtn?.disabled).toBe(false);
    act(() => { clearBtn?.click(); });
    expect(deleteEntityConfigKeys).toHaveBeenCalledWith("reactor-4", [
      "portGroups[0].ports[0].acceptRule",
      "portGroups[0].ports[1].acceptRule",
    ]);
  });

  it("disables clear button when no item is selected", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const entity = createEmptyEntity("reactor-5", "item_port_mix_pool_1");
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);
    const clearBtns = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='clear-item']");
    expect(clearBtns.length).toBe(3);
    for (const b of clearBtns) expect(b.disabled).toBe(true);
  });

  it("renders large reactor pool with three output port groups", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_large_1");
    const entity = createEmptyEntity("large-reactor-1", "item_port_mix_pool_large_1");
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);
    expect(container.querySelectorAll("[data-port-group-id]").length).toBe(3);
  });

  it("renders row-level locator badges for expanded reactor output port groups", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_large_1");
    const entity: WorldEntity = {
      ...createEmptyEntity("large-reactor-2", "item_port_mix_pool_large_1"),
      rotation: 90,
    };
    const currentAppHost = buildAppHost(workspace, entity, { displayRotation: 90, deviceClass: "tablet" });
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);

    const locators = container.querySelectorAll("[data-port-output-locator]");
    expect(locators.length).toBe(3);
    expect(container.querySelector("[data-port-output-locator='item_output']")?.getAttribute("data-locator-rotation")).toBe("180");
    expect(container.querySelectorAll("[data-port-output-locator='item_output'] [data-selected-port-id]").length).toBe(4);
    expect(container.querySelectorAll("[data-port-output-locator='fluid_output_a'] [data-selected-port-id]").length).toBe(1);
    expect(container.querySelector("[data-port-output-locator='item_output']")?.textContent).toContain("P1");
  });

  it("renders compact output row actions without row status chips", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_large_1");
    const entity = createEmptyEntity("large-reactor-compact", "item_port_mix_pool_large_1");
    const currentAppHost = buildAppHost(workspace, entity, { deviceClass: "tablet" });
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);

    expect(container.querySelector(".port-output-status")).toBeNull();
    expect(container.textContent).toContain("更换");
    expect(container.textContent).not.toContain("点击更换");
    expect(container.textContent).not.toContain("运行中");
  });

  it("shows selected item label from existing config", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const ore = requireItem(workspace, "item_copper_ore");
    const entity: WorldEntity = {
      ...createEmptyEntity("reactor-6", "item_port_mix_pool_1"),
      config: { "portGroups[0].ports[0].acceptRule": { base: { kind: "item", itemId: ore.id }, exclude: [] } },
    };
    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;
    renderInspector(currentAppHost, definition, entity, root);
    const btnText = container.querySelector<HTMLButtonElement>("[data-port-group-id='item_output'] [data-slot-action='pick-item']")?.textContent ?? "";
    expect(btnText).toContain(ore.nameKey);
  });
});

function requireDefinition(workspace: WorkspaceContract, id: string): EntityDefinition {
  const d = workspace.registry.entityDefinitions.find((c) => c.id === id);
  if (d === undefined) throw new Error(`Expected definition ${id}.`);
  return d;
}

function requireItem(workspace: WorkspaceContract, id: string): ItemDefinition {
  const item = workspace.registry.itemDefinitions.find((c) => c.id === id);
  if (item === undefined) throw new Error(`Expected item ${id}.`);
  return item;
}

function createEmptyEntity(id: string, definitionId: string): WorldEntity {
  return { id, definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
}

function buildAppHost(
  workspace: WorkspaceContract,
  _entity: WorldEntity,
  options: {
    displayRotation?: 0 | 90 | 180 | 270;
    deviceClass?: "desktop" | "tablet" | "mobile";
  } = {},
): AppHost {
  const picker = new WorkbenchEncyclopediaPickerController(() => ({ desktopCategory: "all", mobileSelectedCategories: [] }));
  return {
    state: {
      screenProfile: {
        deviceClass: options.deviceClass ?? "desktop",
      },
    },
    workspace: {
      ...workspace,
      editor: {
        state: {
          viewport: {
            displayRotation: options.displayRotation ?? 0,
          },
        },
        actions: { patchEntityConfig: vi.fn(), deleteEntityConfigKeys: vi.fn() },
      },
    },
    encyclopediaPicker: picker,
    actions: { translate: (key: string) => key },
  } as unknown as AppHost;
}

function buildAppHostWithEditor(
  workspace: WorkspaceContract, entity: WorldEntity,
  patch: ReturnType<typeof vi.fn>, del: ReturnType<typeof vi.fn>,
): AppHost {
  const picker = new WorkbenchEncyclopediaPickerController(() => ({ desktopCategory: "all", mobileSelectedCategories: [] }));
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
        actions: { patchEntityConfig: patch, deleteEntityConfigKeys: del },
      },
    },
    encyclopediaPicker: picker,
    actions: { translate: (key: string) => key },
  } as unknown as AppHost;
}

function renderInspector(appHost: AppHost, definition: EntityDefinition, entity: WorldEntity, root: Root) {
  act(() => {
    root.render(
      <PortOutputConfigInspector
        appHost={appHost}
        declaration={{ type: INSPECTOR_TYPE.portOutputConfig, portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"] }}
        definition={definition}
        entity={entity}
        translate={appHost.actions.translate}
      />,
    );
  });
}
