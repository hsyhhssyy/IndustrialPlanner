// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { InspectorDataScopeContext } from "@/app/shell/inspector/selection-inspector-model";
import { SlotConfigInspector } from "@/app/shell/inspector/slot-config-inspector";
import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
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

describe("SlotConfigInspector", () => {
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

  it("filters duplicate and mismatched-domain items, then clamps count changes to slot capacity", async () => {
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const initialEntity = document.entities["dummy-entity-2"];

    if (initialEntity === undefined) {
      throw new Error("Expected dummy storager entity to exist.");
    }

    let currentEntity: WorldEntity = initialEntity;

    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const patchEntityConfig = vi.fn((entityId: string, patch: Record<string, unknown>) => {
      if (entityId !== currentEntity.id) {
        return;
      }

      currentEntity = {
        ...currentEntity,
        config: {
          ...currentEntity.config,
          ...patch,
        },
      };
    });
    const deleteEntityConfigKeys = vi.fn((entityId: string, keys: string[]) => {
      if (entityId !== currentEntity.id) {
        return;
      }

      const keysToDelete = new Set<string>();
      const configKeys = Object.keys(currentEntity.config);

      for (const deleteKey of keys) {
        for (const configKey of configKeys) {
          if (configKey === deleteKey || configKey.startsWith(deleteKey + ".") || configKey.startsWith(deleteKey + "[")) {
            keysToDelete.add(configKey);
          }
        }
      }

      if (keysToDelete.size === 0) {
        return;
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
    });
    const currentAppHost = {
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
    appHost = currentAppHost;

    const definition = requireDefinition(workspace, "storager_1");
    const ore = requireItem(workspace, "item_copper_ore");
    const powder = requireItem(workspace, "item_carbon_powder");
    const liquid = requireItem(workspace, "item_liquid_xiranite");
    const gas = requireItem(workspace, "item_gas_inert");

    const renderInspector = () => {
      act(() => {
        root.render(
          <SlotConfigInspector
            appHost={currentAppHost}
            declaration={{
              type: INSPECTOR_TYPE.slotConfig,
              slotGroupIds: ["storage_slot_1", "storage_slot_2", "storage_slot_3", "storage_slot_4", "storage_slot_5", "storage_slot_6"],
            }}
            definition={definition}
            entity={currentEntity}
            translate={currentAppHost.actions.translate}
          />,
        );
      });
    };

    renderInspector();

    const firstTileButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='open-slot-editor']")[0] ?? null;

    if (firstTileButton === null) {
      throw new Error("Expected the first slot tile button to be rendered.");
    }

    act(() => {
      firstTileButton.click();
    });

    const firstPickButton = container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='pick-item']");

    if (firstPickButton === null) {
      throw new Error("Expected the first slot dialog pick button to be rendered.");
    }

    act(() => {
      firstPickButton.click();
    });

    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(false);
    expect(currentAppHost.encyclopediaPicker.matchesItem(gas)).toBe(false);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='cancel']")?.click();
    });

    patchEntityConfig("dummy-entity-2", {
      "storageSlotGroups[0].slots[0].initialItemType": ore.id,
      "storageSlotGroups[0].slots[0].initialCount": 1,
    });
    renderInspector();

    const secondTileButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='open-slot-editor']")[1] ?? null;

    if (secondTileButton === null) {
      throw new Error("Expected the second slot tile button to be rendered.");
    }

    act(() => {
      secondTileButton.click();
    });

    const secondPickButton = container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='pick-item']");

    if (secondPickButton === null) {
      throw new Error("Expected the second slot dialog pick button to be rendered.");
    }

    act(() => {
      secondPickButton.click();
    });

    // AI-CORRECTION 2026-05-18: 协议存储箱使用 6 个单槽储存组，
    //   跨组不互斥，第二组可再次选择 ore。
    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(powder)).toBe(true);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='cancel']")?.click();
    });

    const patchedFirstTileButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='open-slot-editor']")[0] ?? null;

    if (patchedFirstTileButton === null) {
      throw new Error("Expected the patched first slot tile button to be rendered.");
    }

    act(() => {
      patchedFirstTileButton.click();
    });

    const countInput = container.querySelector<HTMLInputElement>("[data-slot-dialog-input='count']");

    if (countInput === null) {
      throw new Error("Expected the slot count input to be rendered.");
    }

    act(() => {
      countInput.focus();
      setInputValue(countInput, "999");
      countInput.dispatchEvent(new Event("input", { bubbles: true }));
      countInput.blur();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='confirm']")?.click();
      await Promise.resolve();
    });

    expect(currentEntity.config).toMatchObject({
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 50,
    });
    expect(patchEntityConfig).toHaveBeenCalled();
  });

  it("allows any slot filters to select solid, liquid, and gas items", async () => {
    const workspace = createWorkspace();
    const entity: WorldEntity = {
      id: "mix-pool",
      definitionId: "mix_pool_1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    };
    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    const definition = requireDefinition(workspace, "mix_pool_1");
    act(() => {
      root.render(
        <SlotConfigInspector
          appHost={currentAppHost}
          declaration={{
            type: INSPECTOR_TYPE.slotConfig,
            slotGroupIds: ["shared_input_buffer"],
          }}
          definition={definition}
          entity={entity}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    const firstTileButton = container.querySelector<HTMLButtonElement>("[data-slot-action='open-slot-editor']");
    if (firstTileButton === null) {
      throw new Error("Expected an any-filter slot tile button to be rendered.");
    }

    act(() => {
      firstTileButton.click();
    });

    const firstPickButton = container.querySelector<HTMLButtonElement>("[data-slot-dialog-action='pick-item']");
    if (firstPickButton === null) {
      throw new Error("Expected the any-filter slot dialog pick button to be rendered.");
    }

    act(() => {
      firstPickButton.click();
    });

    expect(currentAppHost.encyclopediaPicker.matchesItem(requireItem(workspace, "item_copper_ore"))).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(requireItem(workspace, "item_liquid_water"))).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(requireItem(workspace, "item_gas_inert"))).toBe(true);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });
  });

  it("renders the data scope switch in the panel header", () => {
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-2"];

    if (entity === undefined) {
      throw new Error("Expected dummy storager entity to exist.");
    }

    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    const definition = requireDefinition(workspace, "storager_1");
    const setScope = vi.fn();
    const renderInspector = (scope: "initial-config" | "runtime-state") => {
      act(() => {
        root.render(
          <InspectorDataScopeContext.Provider
            value={{
              scope,
              simulationRunning: true,
              canUseRuntimeState: true,
              setScope,
            }}
          >
            <SlotConfigInspector
              appHost={currentAppHost}
              declaration={{
                type: INSPECTOR_TYPE.slotConfig,
                slotGroupIds: ["storage_slot_1"],
              }}
              definition={definition}
              entity={entity}
              translate={currentAppHost.actions.translate}
            />
          </InspectorDataScopeContext.Provider>,
        );
      });
    };

    renderInspector("initial-config");

    const enabledSwitch = container.querySelector<HTMLInputElement>("[data-inspector-scope-switch]");

    if (enabledSwitch === null) {
      throw new Error("Expected the inspector scope switch to be rendered.");
    }

    expect(enabledSwitch.checked).toBe(true);
    expect(enabledSwitch.disabled).toBe(false);
    expect(container.textContent).toContain("编辑模式");
    expect(container.textContent).not.toContain("开启");

    act(() => {
      enabledSwitch.click();
    });

    expect(setScope).toHaveBeenLastCalledWith("runtime-state");

    renderInspector("runtime-state");

    const runtimeStateSwitch = container.querySelector<HTMLInputElement>("[data-inspector-scope-switch]");

    if (runtimeStateSwitch === null) {
      throw new Error("Expected the inspector scope switch to be rendered after scope changes.");
    }

    expect(runtimeStateSwitch.checked).toBe(false);
    expect(container.textContent).toContain("编辑模式");
    expect(container.textContent).not.toContain("关闭");

    act(() => {
      runtimeStateSwitch.click();
    });

    expect(setScope).toHaveBeenLastCalledWith("initial-config");
  });

  it("keeps the count input on a separate row from the range slider", () => {
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-2"];

    if (entity === undefined) {
      throw new Error("Expected dummy storager entity to exist.");
    }

    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    const definition = requireDefinition(workspace, "storager_1");
    const configuredEntity: WorldEntity = {
      ...entity,
      config: {
        "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
        "storageSlotGroups[0].slots[0].initialCount": 18,
      },
    };

    act(() => {
      root.render(
        <SlotConfigInspector
          appHost={currentAppHost}
          declaration={{
            type: INSPECTOR_TYPE.slotConfig,
            slotGroupIds: ["storage_slot_1"],
          }}
          definition={definition}
          entity={configuredEntity}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    const slotButton = container.querySelector<HTMLButtonElement>("[data-slot-action='open-slot-editor']");

    if (slotButton === null) {
      throw new Error("Expected slot editor button to be rendered.");
    }

    act(() => {
      slotButton.click();
    });

    const countInput = container.querySelector<HTMLInputElement>("[data-slot-dialog-input='count']");
    const rangeInput = container.querySelector<HTMLInputElement>("input[aria-label='数量滑条']");
    const countRow = container.querySelector(".slot-config-dialog-count-row");
    const sliderRow = container.querySelector(".slot-config-dialog-slider-row");

    expect(countInput).not.toBeNull();
    expect(rangeInput).not.toBeNull();
    expect(countRow).not.toBeNull();
    expect(sliderRow).not.toBeNull();
    expect(countRow?.contains(countInput)).toBe(true);
    expect(countRow?.textContent).toContain("数量");
    expect(countRow?.contains(rangeInput)).toBe(false);
    expect(sliderRow?.contains(rangeInput)).toBe(true);
    expect(sliderRow?.contains(countInput)).toBe(false);
    expect(sliderRow?.querySelectorAll(".slot-config-step-button")).toHaveLength(2);
  });

  it("renders shared slot column for mix_pool with bidirectional port bindings", () => {
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-4"];

    if (entity === undefined) {
      throw new Error("Expected dummy mix_pool entity to exist.");
    }

    const definition = requireDefinition(workspace, entity.definitionId);
    // MixPool 的 slot-config inspector 引用 shared_input_buffer
    const slotConfigDecl = definition.inspectors.find(
      (d) => d.type === "slot-config",
    );
    // auto-generated via recipe machine: expect slotGroupIds to include shared_input_buffer
    expect(slotConfigDecl).toBeDefined();

    const slotGroupIds = slotConfigDecl !== undefined && "slotGroupIds" in slotConfigDecl
      ? (slotConfigDecl as { slotGroupIds: readonly string[] }).slotGroupIds
      : [];
    expect(slotGroupIds).toContain("shared_input_buffer");

    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SlotConfigInspector
          appHost={currentAppHost}
          declaration={{
            type: INSPECTOR_TYPE.slotConfig,
            slotGroupIds: ["shared_input_buffer"],
          }}
          definition={definition}
          entity={entity}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    // 验证共享槽位列存在，输入/输出列不存在
    const sharedColumn = container.querySelector("[data-slot-config-role='shared']");
    const inputColumn = container.querySelector("[data-slot-config-role='input']");
    const outputColumn = container.querySelector("[data-slot-config-role='output']");

    expect(sharedColumn).not.toBeNull();
    expect(inputColumn).toBeNull();
    expect(outputColumn).toBeNull();

    // 共享槽位应该显示 5 个槽位
    const sharedSlots = sharedColumn!.querySelectorAll("[data-slot-action='open-slot-editor']");
    expect(sharedSlots.length).toBe(5);
  });

  it("resolves slot flow roles from recipe channels instead of port bindings", () => {
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-3"];

    if (entity === undefined) {
      throw new Error("Expected dummy grinder entity to exist.");
    }

    const baseDefinition = requireDefinition(workspace, entity.definitionId);
    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    const renderInspector = (definition: EntityDefinition) => {
      act(() => {
        root.render(
          <SlotConfigInspector
            appHost={currentAppHost}
            declaration={{
              type: INSPECTOR_TYPE.slotConfig,
              slotGroupIds: ["item_input_buffer", "item_output_buffer"],
            }}
            definition={definition}
            entity={entity}
            translate={currentAppHost.actions.translate}
          />,
        );
      });
    };

    renderInspector({
      ...baseDefinition,
      recipeChannels: [
        {
          id: "default",
          ingredientStorageGroupIds: ["item_output_buffer"],
          productStorageGroupIds: ["item_input_buffer"],
        },
      ],
    });

    expectSlotGroupRole(container, "item_input_buffer", "output");
    expectSlotGroupRole(container, "item_output_buffer", "input");

    renderInspector({
      ...baseDefinition,
      recipeChannels: [],
    });

    expectSlotGroupRole(container, "item_input_buffer", "shared");
    expectSlotGroupRole(container, "item_output_buffer", "shared");
    expect(container.querySelector("[data-slot-config-role='input']")).toBeNull();
    expect(container.querySelector("[data-slot-config-role='output']")).toBeNull();

    renderInspector({
      ...baseDefinition,
      recipeChannels: [
        {
          id: "default",
          ingredientStorageGroupIds: ["item_input_buffer"],
          productStorageGroupIds: [],
        },
      ],
    });

    expectSlotGroupRole(container, "item_input_buffer", "input");
    expectSlotGroupRole(container, "item_output_buffer", "shared");

    renderInspector({
      ...baseDefinition,
      recipeChannels: [
        {
          id: "default",
          ingredientStorageGroupIds: ["item_input_buffer"],
          productStorageGroupIds: ["item_input_buffer"],
        },
      ],
    });

    expectSlotGroupRole(container, "item_input_buffer", "shared");
    expectSlotGroupRole(container, "item_output_buffer", "shared");
  });

  it("renders water pump and dark pipe storage groups as shared recipe-channel slots", () => {
    const workspace = createWorkspace();
    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    const cases = [
      { definitionId: "water_pump_1", slotGroupId: "fluid_output_buffer" },
      { definitionId: "udpipe_loader_1", slotGroupId: "loader_buffer" },
      { definitionId: "udpipe_unloader_1", slotGroupId: "unloader_buffer" },
      { definitionId: "udpipe_loader_2", slotGroupId: "loader_buffer" },
      { definitionId: "udpipe_unloader_2", slotGroupId: "unloader_buffer" },
    ];

    for (const testCase of cases) {
      const definition = requireDefinition(workspace, testCase.definitionId);
      const entity: WorldEntity = {
        id: `entity:${testCase.definitionId}`,
        definitionId: testCase.definitionId,
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      };

      act(() => {
        root.render(
          <SlotConfigInspector
            appHost={currentAppHost}
            declaration={{
              type: INSPECTOR_TYPE.slotConfig,
              slotGroupIds: [testCase.slotGroupId],
            }}
            definition={definition}
            entity={entity}
            translate={currentAppHost.actions.translate}
          />,
        );
      });

      expectSlotGroupRole(container, testCase.slotGroupId, "shared");
      expect(container.querySelector("[data-slot-config-role='input']")).toBeNull();
      expect(container.querySelector("[data-slot-config-role='output']")).toBeNull();
    }
  });

  it("renders input/output columns only for definition with unidirectional port bindings", () => {
    // 使用粉碎机（grinder）：item_input -> item_input_buffer, item_output -> item_output_buffer
    // 两个槽位组都是单向绑定，不应出现共享列
    const workspace = createWorkspace();
    const document = createDummyWorldDocument();
    const entity = document.entities["dummy-entity-3"];

    if (entity === undefined) {
      throw new Error("Expected dummy grinder entity to exist.");
    }

    const definition = requireDefinition(workspace, entity.definitionId);
    const picker = new WorkbenchEncyclopediaPickerController(() => ({
      desktopCategory: "all",
      mobileSelectedCategories: [],
    }));
    const currentAppHost = {
      workspace,
      encyclopediaPicker: picker,
      actions: {
        translate: (key: string) => key,
      },
    } as unknown as AppHost;
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SlotConfigInspector
          appHost={currentAppHost}
          declaration={{
            type: INSPECTOR_TYPE.slotConfig,
            slotGroupIds: ["item_input_buffer", "item_output_buffer"],
          }}
          definition={definition}
          entity={entity}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    // 共享列不应出现
    expect(container.querySelector("[data-slot-config-role='shared']")).toBeNull();
    // 输入和输出列各至少有一个
    const inputColumn = container.querySelector("[data-slot-config-role='input']");
    const outputColumn = container.querySelector("[data-slot-config-role='output']");
    expect(inputColumn).not.toBeNull();
    expect(outputColumn).not.toBeNull();
  });
});

function requireDefinition(workspace: WorkspaceContract, definitionId: string): EntityDefinition {
  const definition = workspace.registry.entityDefinitions.find(
    (candidate) => candidate.id === definitionId,
  );

  if (definition === undefined) {
    throw new Error(`Expected definition ${definitionId} to exist.`);
  }

  return definition;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter === undefined) {
    input.value = value;
    return;
  }

  setter.call(input, value);
}

function expectSlotGroupRole(
  container: HTMLElement,
  storageGroupId: string,
  role: "input" | "output" | "shared",
): void {
  const group = container.querySelector(`[data-slot-config-group='${storageGroupId}']`);
  expect(group).not.toBeNull();
  expect(group?.getAttribute("data-slot-config-group-role")).toBe(role);
  expect(group?.closest("[data-slot-config-role]")?.getAttribute("data-slot-config-role")).toBe(role);
}

function requireItem(workspace: WorkspaceContract, itemId: string): ItemDefinition {
  const item = workspace.registry.itemDefinitions.find((candidate) => candidate.id === itemId);

  if (item === undefined) {
    throw new Error(`Expected item ${itemId} to exist.`);
  }

  return item;
}
