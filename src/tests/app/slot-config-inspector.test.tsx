// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { SlotConfigInspector } from "@/app/shell/inspector/slot-config-inspector";
import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
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

    const definition = requireDefinition(workspace, "item_port_storager_1");
    const ore = requireItem(workspace, "item_copper_ore");
    const powder = requireItem(workspace, "item_carbon_powder");
    const liquid = requireItem(workspace, "item_liquid_xiranite");

    const renderInspector = () => {
      act(() => {
        root.render(
          <SlotConfigInspector
            appHost={currentAppHost}
            declaration={{
              type: INSPECTOR_TYPE.slotConfig,
              slotGroupIds: ["item_storage"],
            }}
            definition={definition}
            entity={currentEntity}
            translate={currentAppHost.actions.translate}
          />,
        );
      });
    };

    renderInspector();

    const firstPickButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='pick-item']")[0] ?? null;

    if (firstPickButton === null) {
      throw new Error("Expected the first slot pick button to be rendered.");
    }

    act(() => {
      firstPickButton.click();
    });

    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(true);
    expect(currentAppHost.encyclopediaPicker.matchesItem(liquid)).toBe(false);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });

    patchEntityConfig("dummy-entity-2", {
      "storageSlotGroups[0].slots[0].initialItemType": ore.id,
      "storageSlotGroups[0].slots[0].initialCount": 1,
    });
    renderInspector();

    const secondPickButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='pick-item']")[1] ?? null;

    if (secondPickButton === null) {
      throw new Error("Expected the second slot pick button to be rendered.");
    }

    act(() => {
      secondPickButton.click();
    });

    expect(currentAppHost.encyclopediaPicker.matchesItem(ore)).toBe(false);
    expect(currentAppHost.encyclopediaPicker.matchesItem(powder)).toBe(true);

    await act(async () => {
      currentAppHost.encyclopediaPicker.cancel();
      await Promise.resolve();
    });

    for (let index = 0; index < 60; index += 1) {
      const incrementButton = container.querySelectorAll<HTMLButtonElement>("[data-slot-action='increment-count']")[0] ?? null;

      if (incrementButton === null) {
        throw new Error("Expected the first slot increment button to be rendered.");
      }

      act(() => {
        incrementButton.click();
      });
      renderInspector();
    }

    expect(currentEntity.config).toMatchObject({
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 50,
    });
    expect(patchEntityConfig).toHaveBeenCalled();
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

function requireItem(workspace: WorkspaceContract, itemId: string): ItemDefinition {
  const item = workspace.registry.itemDefinitions.find((candidate) => candidate.id === itemId);

  if (item === undefined) {
    throw new Error(`Expected item ${itemId} to exist.`);
  }

  return item;
}
