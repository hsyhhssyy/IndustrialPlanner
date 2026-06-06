// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { WarehouseItemLinkInspector } from "@/app/shell/inspector/warehouse-item-link-inspector";
import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  INSPECTOR_TYPE,
  type WarehouseItemLinkInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
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

describe("WarehouseItemLinkInspector", () => {
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

    appHost?.encyclopediaPicker.dispose();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders the dedicated warehouse link row without falling back to slot config rows", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_unloader_1");
    const entity = createEntity("unloader-visual", "item_port_unloader_1");
    const currentAppHost = buildAppHost(workspace);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    expect(container.querySelectorAll(".warehouse-link-row").length).toBe(1);
    expect(container.querySelector(".slot-config-row")).toBeNull();
    expect(container.textContent).toContain("P1");
    expect(container.querySelector<HTMLButtonElement>(".warehouse-link-infinity-button")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("[data-slot-action='clear-item']")?.disabled).toBe(true);
  });

  it("uses the shared output port numbering for bound warehouse slots", () => {
    const workspace = createWorkspace();
    const definition = createMultiSlotWarehouseDefinition();
    const entity = createEntity("multi-link-device", definition.id);
    const currentAppHost = buildAppHost(workspace);
    appHost = currentAppHost;

    renderInspector(
      currentAppHost,
      definition,
      entity,
      root,
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["first_buffer", "second_buffer"],
      },
    );

    const labels = Array.from(container.querySelectorAll(".warehouse-link-row .port-output-locator-label"))
      .map((element) => element.textContent);

    expect(labels).toEqual(["P2", "P1"]);
    expect(container.querySelector(".warehouse-link-slot")).toBeNull();
  });

  it("expands protocol core outputs into one inspector with independent link indices", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_sp_hub_1");
    const declarations = definition.inspectors.filter(
      (inspector): inspector is WarehouseItemLinkInspectorDeclaration =>
        inspector.type === INSPECTOR_TYPE.warehouseItemLink,
    );
    const declaration = declarations[0];
    if (declaration === undefined) {
      throw new Error("Expected protocol core warehouse link declaration.");
    }

    const entity = createEntity("protocol-core-link", definition.id);
    const patchEntityConfig = vi.fn();
    const deleteEntityConfigKeys = vi.fn();
    const currentAppHost = buildAppHost(workspace, patchEntityConfig, deleteEntityConfigKeys);
    appHost = currentAppHost;
    const ore = requireItem(workspace, "item_copper_ore");

    renderInspector(currentAppHost, definition, entity, root, declaration);

    const labels = Array.from(container.querySelectorAll(".warehouse-link-row .port-output-locator-label"))
      .map((element) => element.textContent);
    expect(declarations).toHaveLength(1);
    expect(container.querySelectorAll(".warehouse-link-row").length).toBe(6);
    expect(labels).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);

    act(() => {
      container
        .querySelector<HTMLButtonElement>("[data-storage-group-id='unbuffer_e2'] [data-slot-action='pick-item']")
        ?.click();
    });
    act(() => {
      currentAppHost.encyclopediaPicker.selectItem(ore.id);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("protocol-core-link", expect.objectContaining({
      "links[3].linkType": "share-all",
      "links[3].source.entityId": "protocol-core-link",
      "links[3].source.storageSlotGroupId": "unbuffer_e2",
      "links[3].source.slotId": "slot_1",
      "links[3].target.entityId": "warehouse",
      "links[3].target.storageSlotGroupId": "warehouse",
      "links[3].target.slotId": ore.id,
    }));
  });

  it("filters selectable warehouse items by slot domain and writes the same link config", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_unloader_1");
    const entity = createEntity("unloader-select", "item_port_unloader_1");
    const patchEntityConfig = vi.fn();
    const deleteEntityConfigKeys = vi.fn();
    const currentAppHost = buildAppHost(workspace, patchEntityConfig, deleteEntityConfigKeys);
    appHost = currentAppHost;
    const ore = requireItem(workspace, "item_copper_ore");
    const liquid = requireItem(workspace, "item_liquid_water");

    renderInspector(currentAppHost, definition, entity, root);

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-slot-action='pick-item']")?.click();
    });

    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(false);

    act(() => {
      currentAppHost.encyclopediaPicker.selectItem(ore.id);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(patchEntityConfig).toHaveBeenCalledWith("unloader-select", expect.objectContaining({
      "links[0].linkType": "share-all",
      "links[0].source.entityId": "unloader-select",
      "links[0].source.storageSlotGroupId": "unloader_buffer",
      "links[0].source.slotId": "slot_1",
      "links[0].target.entityId": "warehouse",
      "links[0].target.storageSlotGroupId": "warehouse",
      "links[0].target.slotId": ore.id,
    }));
  });

  it("keeps ignore-stock and clear actions on their original config paths", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_unloader_1");
    const ore = requireItem(workspace, "item_copper_ore");
    const entity = createEntity("unloader-actions", "item_port_unloader_1", {
      "links[0].target.slotId": ore.id,
      "storageSlotGroups[0].slots[0].ignoreStock": false,
    });
    const patchEntityConfig = vi.fn();
    const deleteEntityConfigKeys = vi.fn();
    const currentAppHost = buildAppHost(workspace, patchEntityConfig, deleteEntityConfigKeys);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    const ignoreStockButton = container.querySelector<HTMLButtonElement>(".warehouse-link-infinity-button");
    expect(ignoreStockButton?.disabled).toBe(false);
    expect(ignoreStockButton?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      ignoreStockButton?.click();
    });
    expect(patchEntityConfig).toHaveBeenCalledWith("unloader-actions", {
      "storageSlotGroups[0].slots[0].ignoreStock": true,
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-slot-action='clear-item']")?.click();
    });
    expect(deleteEntityConfigKeys).toHaveBeenCalledWith("unloader-actions", [
      "links[0]",
      "storageSlotGroups[0].slots[0].ignoreStock",
    ]);
  });
});

function buildAppHost(
  workspace: WorkspaceContract,
  patchEntityConfig = vi.fn(),
  deleteEntityConfigKeys = vi.fn(),
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
        actions: {
          patchEntityConfig,
          deleteEntityConfigKeys,
        },
      },
    },
    encyclopediaPicker: picker,
    actions: {
      translate: (key: string) => key,
    },
  } as unknown as AppHost;
}

function renderInspector(
  currentAppHost: AppHost,
  definition: EntityDefinition,
  entity: WorldEntity,
  currentRoot: Root,
  declaration: WarehouseItemLinkInspectorDeclaration = {
    type: INSPECTOR_TYPE.warehouseItemLink,
    slotGroupIds: ["unloader_buffer"],
  },
) {
  act(() => {
    currentRoot.render(
      <WarehouseItemLinkInspector
        appHost={currentAppHost}
        declaration={declaration}
        definition={definition}
        entity={entity}
        translate={currentAppHost.actions.translate}
      />,
    );
  });
}

function createMultiSlotWarehouseDefinition(): EntityDefinition {
  return {
    id: "test_multi_slot_warehouse_link",
    nameKey: "test.multiSlotWarehouseLink",
    spriteId: "item_port_unloader_1",
    footprint: { width: 3, height: 1 },
    uiGroup: "warehouse",
    displayOrder: 0,
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [
      {
        type: INSPECTOR_TYPE.portOutputConfig,
        portGroupIds: ["second_output", "first_output"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["first_buffer", "second_buffer"],
      },
    ],
    placementBehaviors: [],
    portGroups: [
      {
        id: "first_output",
        kind: "item",
        direction: "output",
        ports: [createTestPort("first_port", 0, 0)],
      },
      {
        id: "second_output",
        kind: "item",
        direction: "output",
        ports: [createTestPort("second_port", 2, 0)],
      },
    ],
    storageSlotGroups: [
      {
        id: "first_buffer",
        kind: "item",
        slots: [createTestSlot("slot_1")],
      },
      {
        id: "second_buffer",
        kind: "item",
        slots: [createTestSlot("slot_1")],
      },
    ],
    recipeChannels: [],
    portStorageBindings: [
      {
        id: "bind_first_output",
        portGroupId: "first_output",
        storageSlotGroupId: "first_buffer",
      },
      {
        id: "bind_second_output",
        portGroupId: "second_output",
        storageSlotGroupId: "second_buffer",
      },
    ],
    links: [],
  };
}

function createTestPort(
  id: string,
  localCellX: number,
  localCellY: number,
): EntityDefinition["portGroups"][number]["ports"][number] {
  return {
    id,
    localCellX,
    localCellY,
    edge: "SOUTH",
    acceptRule: {
      base: { kind: "solid" },
      exclude: [],
    },
    count: 1,
    priorityGroup: 0,
    roundRobinSeed: 0,
  };
}

function createTestSlot(
  id: string,
): EntityDefinition["storageSlotGroups"][number]["slots"][number] {
  return {
    id,
    capacity: 1,
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    // AI-REMOVED 2026-06-06:
    // Reason: StorageSlotDefinition 不再包含 submitMode / submitIntervalSeconds。
    // Trigger: 用户要求 submit mode 机制彻底删除。
    // Evidence: src/domain/registry/types/entity-definition.ts 已删除槽位提交字段。
    // Replacement: None in this domain slot stub.
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // submitMode: "never",
    // submitIntervalSeconds: null,
    itemFilter: "type",
    itemFilterType: "solid",
  };
}

function requireDefinition(workspace: WorkspaceContract, id: string): EntityDefinition {
  const definition = workspace.registry.entityDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Expected definition ${id}.`);
  }
  return definition;
}

function requireItem(workspace: WorkspaceContract, id: string): ItemDefinition {
  const item = workspace.registry.itemDefinitions.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`Expected item ${id}.`);
  }
  return item;
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
