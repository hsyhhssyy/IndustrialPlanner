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
    act(() => {
      root.unmount();
    });

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

    const groupIds = Array.from(rows).map((el) =>
      el.getAttribute("data-port-group-id"),
    );
    expect(groupIds).toContain("item_output");
    expect(groupIds).toContain("fluid_output_a");
    expect(groupIds).toContain("fluid_output_b");
  });

  it("renders empty state when definition has no matching output port groups", () => {
    const workspace = createWorkspace();
    // 构造一个没有 output 端口组的 definition
    const definition: EntityDefinition = {
      id: "test-no-output",
      nameKey: "test.no-output",
      spriteId: "test",
      footprint: { width: 1, height: 1 },
      uiGroup: "basicProduction",
      tags: [],
      displayOrder: 1,
      portGroups: [],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
      links: [],
      placementBehaviors: [],
      inspectors: [],
      requiresPower: false,
      powerDemand: 0,
      powerRange: 0,
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

    // 点击固体输出端口的物品选择按钮
    const solidRow = container.querySelector<HTMLElement>(
      "[data-port-group-id='item_output']",
    );
    if (solidRow === null) {
      throw new Error("Expected item_output row to be rendered.");
    }
    const solidPickButton =
      solidRow.querySelector<HTMLButtonElement>("[data-slot-action='pick-item']");
    if (solidPickButton === null) {
      throw new Error("Expected item_output pick button to be rendered.");
    }

    act(() => {
      solidPickButton.click();
    });

    // solid port → 固体物品可通过但液体不可
    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(false);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });

    // 点击液体输出端口的物品选择按钮
    const fluidRow = container.querySelector<HTMLElement>(
      "[data-port-group-id='fluid_output_a']",
    );
    if (fluidRow === null) {
      throw new Error("Expected fluid_output_a row to be rendered.");
    }
    const fluidPickButton =
      fluidRow.querySelector<HTMLButtonElement>("[data-slot-action='pick-item']");
    if (fluidPickButton === null) {
      throw new Error("Expected fluid_output_a pick button to be rendered.");
    }

    act(() => {
      fluidPickButton.click();
    });

    // fluid port → 液体物品可通过但固体不可
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(false);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });
  });

  it("writes acceptRule config when user selects an item", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const initialEntity = createEmptyEntity("reactor-3", "item_port_mix_pool_1");
    let currentEntity: WorldEntity = initialEntity;

    const patchEntityConfig = vi.fn(
      (_entityId: string, patch: Record<string, unknown>) => {
        currentEntity = {
          ...currentEntity,
          config: {
            ...currentEntity.config,
            ...patch,
          },
        };
      },
    );
    const deleteEntityConfigKeys = vi.fn();

    const currentAppHost = buildAppHostWithEditor(
      workspace,
      currentEntity,
      patchEntityConfig,
      deleteEntityConfigKeys,
    );
    appHost = currentAppHost;

    const ore = requireItem(workspace, "item_copper_ore");

    renderInspector(currentAppHost, definition, currentEntity, root);

    // 点击固体输出端口选取物品
    const solidRow = container.querySelector<HTMLElement>(
      "[data-port-group-id='item_output']",
    );
    const solidPickButton =
      solidRow?.querySelector<HTMLButtonElement>("[data-slot-action='pick-item']");

    act(() => {
      solidPickButton?.click();
    });

    // 模拟选择 ore
    act(() => {
      currentAppHost.encyclopediaPicker.selectItem(ore.id);
    });

    // 等待异步 pickItem 完成 → patchEntityConfig 被调用
    await act(async () => {
      await Promise.resolve();
    });

    // 验证 config 被写入
    expect(patchEntityConfig).toHaveBeenCalledWith(
      "reactor-3",
      expect.objectContaining({
        "portGroups[0].ports[0].acceptRule": {
          base: { kind: "item", itemId: "item_copper_ore" },
          exclude: [],
        },
      }),
    );

    // 验证当前 config
    expect(currentEntity.config["portGroups[0].ports[0].acceptRule"]).toEqual({
      base: { kind: "item", itemId: "item_copper_ore" },
      exclude: [],
    });
  });

  it("clears acceptRule config when user clears selection", async () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");

    // 初始 entity 已经配置了 item_output 的 acceptRule
    const initialEntity: WorldEntity = {
      ...createEmptyEntity("reactor-4", "item_port_mix_pool_1"),
      config: {
        "portGroups[0].ports[0].acceptRule": {
          base: { kind: "item", itemId: "item_copper_ore" },
          exclude: [],
        },
      },
    };
    let currentEntity: WorldEntity = initialEntity;

    const patchEntityConfig = vi.fn(
      (_entityId: string, patch: Record<string, unknown>) => {
        currentEntity = {
          ...currentEntity,
          config: {
            ...currentEntity.config,
            ...patch,
          },
        };
      },
    );
    const deleteEntityConfigKeys = vi.fn(
      (entityId: string, keys: string[]) => {
        if (entityId !== currentEntity.id) return;

        const keysToDelete = new Set<string>();
        const configKeys = Object.keys(currentEntity.config);

        for (const deleteKey of keys) {
          for (const configKey of configKeys) {
            if (
              configKey === deleteKey ||
              configKey.startsWith(deleteKey + ".") ||
              configKey.startsWith(deleteKey + "[")
            ) {
              keysToDelete.add(configKey);
            }
          }
        }

        const nextConfig: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(currentEntity.config)) {
          if (!keysToDelete.has(key)) {
            nextConfig[key] = value;
          }
        }
        currentEntity = {
          ...currentEntity,
          config: nextConfig,
        };
      },
    );

    const currentAppHost = buildAppHostWithEditor(
      workspace,
      currentEntity,
      patchEntityConfig,
      deleteEntityConfigKeys,
    );
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, currentEntity, root);

    // 清除按钮应可见（已选中物品）
    const clearButton = container.querySelector<HTMLButtonElement>(
      "[data-port-group-id='item_output'] [data-slot-action='clear-item']",
    );
    if (clearButton === null) {
      throw new Error("Expected clear button to be rendered when item is selected.");
    }
    expect(clearButton.disabled).toBe(false);

    act(() => {
      clearButton.click();
    });

    // 验证 deleteEntityConfigKeys 被调用
    expect(deleteEntityConfigKeys).toHaveBeenCalledWith(
      "reactor-4",
      ["portGroups[0].ports[0].acceptRule"],
    );
  });

  it("disables clear button when no item is selected", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const entity = createEmptyEntity("reactor-5", "item_port_mix_pool_1");

    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    // 所有清除按钮都应禁用
    const clearButtons = container.querySelectorAll<HTMLButtonElement>(
      "[data-slot-action='clear-item']",
    );
    expect(clearButtons.length).toBe(3);
    for (const button of clearButtons) {
      expect(button.disabled).toBe(true);
    }
  });

  it("renders large reactor pool with three output port groups", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(
      workspace,
      "item_port_mix_pool_large_1",
    );
    const entity = createEmptyEntity(
      "large-reactor-1",
      "item_port_mix_pool_large_1",
    );

    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    const rows = container.querySelectorAll("[data-port-group-id]");
    expect(rows.length).toBe(3);

    const groupIds = Array.from(rows).map((el) =>
      el.getAttribute("data-port-group-id"),
    );
    expect(groupIds).toContain("item_output");
    expect(groupIds).toContain("fluid_output_a");
    expect(groupIds).toContain("fluid_output_b");
  });

  it("shows selected item label from existing config", () => {
    const workspace = createWorkspace();
    const definition = requireDefinition(workspace, "item_port_mix_pool_1");
    const ore = requireItem(workspace, "item_copper_ore");

    const entity: WorldEntity = {
      ...createEmptyEntity("reactor-6", "item_port_mix_pool_1"),
      config: {
        "portGroups[0].ports[0].acceptRule": {
          base: { kind: "item", itemId: ore.id },
          exclude: [],
        },
      },
    };

    const currentAppHost = buildAppHost(workspace, entity);
    appHost = currentAppHost;

    renderInspector(currentAppHost, definition, entity, root);

    const solidRow = container.querySelector<HTMLElement>(
      "[data-port-group-id='item_output']",
    );
    const itemButton =
      solidRow?.querySelector<HTMLButtonElement>("[data-slot-action='pick-item']");

    // 应显示已选物品的名称（从 translate 返回 itemDefinition.nameKey）
    const buttonText = itemButton?.textContent ?? "";
    expect(buttonText).toContain(ore.nameKey);
  });
});

// =========================================================================
// Helpers
// =========================================================================

function requireDefinition(
  workspace: WorkspaceContract,
  definitionId: string,
): EntityDefinition {
  const definition = workspace.registry.entityDefinitions.find(
    (candidate) => candidate.id === definitionId,
  );

  if (definition === undefined) {
    throw new Error(
      `Expected definition ${definitionId} to exist in registry.`,
    );
  }

  return definition;
}

function requireItem(
  workspace: WorkspaceContract,
  itemId: string,
): ItemDefinition {
  const item = workspace.registry.itemDefinitions.find(
    (candidate) => candidate.id === itemId,
  );

  if (item === undefined) {
    throw new Error(`Expected item ${itemId} to exist in registry.`);
  }

  return item;
}

function createEmptyEntity(
  id: string,
  definitionId: string,
): WorldEntity {
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
  entity: WorldEntity,
): AppHost {
  const picker = new WorkbenchEncyclopediaPickerController(() => ({
    desktopCategory: "all",
    mobileSelectedCategories: [],
  }));

  return {
    workspace: {
      ...workspace,
      editor: {
        actions: {
          patchEntityConfig: vi.fn(),
          deleteEntityConfigKeys: vi.fn(),
        },
      },
    },
    encyclopediaPicker: picker,
    actions: {
      translate: (key: string) => key,
    },
  } as unknown as AppHost;
}

function buildAppHostWithEditor(
  workspace: WorkspaceContract,
  entity: WorldEntity,
  patchEntityConfig: ReturnType<typeof vi.fn>,
  deleteEntityConfigKeys: ReturnType<typeof vi.fn>,
): AppHost {
  const picker = new WorkbenchEncyclopediaPickerController(() => ({
    desktopCategory: "all",
    mobileSelectedCategories: [],
  }));

  return {
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
  appHost: AppHost,
  definition: EntityDefinition,
  entity: WorldEntity,
  root: Root,
) {
  act(() => {
    root.render(
      <PortOutputConfigInspector
        appHost={appHost}
        declaration={{
          type: INSPECTOR_TYPE.portOutputConfig,
          portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"],
        }}
        definition={definition}
        entity={entity}
        translate={appHost.actions.translate}
      />,
    );
  });
}
