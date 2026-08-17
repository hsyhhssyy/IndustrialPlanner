// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import type { SimulationRunState } from "@/domain/simulation/types/simulation-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import type { WorldDocument } from "@/domain/document/world-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createInitialSimulationTimelineState } from "@/simulation/state-impl";

import { SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY } from "@/app/shell/inspector/simulation-recipe-status-runtime-inspector";

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

function queryInspectorKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-inspector-key]"))
    .map((element) => element.dataset.inspectorKey ?? "");
}

/** 创建一个包含有 recipeChannels 定义设备的 WorldDocument */
function createDummyWorldWithRecipeDevice(): WorldDocument {
  const doc = createDummyWorldDocument();
  return {
    ...doc,
    entities: {
      ...doc.entities,
      "dummy-recipe-device": {
        id: "dummy-recipe-device",
        definitionId: "mix_pool_1",
        position: { x: 1, y: 1 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
  };
}

/** 创建一个包含自动 recipe channel 定义设备的 WorldDocument */
function createDummyWorldWithAutoRecipeDevice(): WorldDocument {
  const doc = createDummyWorldDocument();
  return {
    ...doc,
    entities: {
      ...doc.entities,
      "dummy-auto-recipe-device": {
        id: "dummy-auto-recipe-device",
        definitionId: "grinder_1",
        position: { x: 1, y: 1 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
  };
}

function createDummyWorldWithLogisticsDevice(): WorldDocument {
  const doc = createDummyWorldDocument();
  return {
    ...doc,
    entities: {
      ...doc.entities,
      "dummy-logistics-device": {
        id: "dummy-logistics-device",
        definitionId: "belt_straight_1x1",
        position: { x: 1, y: 1 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
  };
}

function createDummyWorldWithMeteredDevice(): WorldDocument {
  const doc = createDummyWorldDocument();
  return {
    ...doc,
    entities: {
      ...doc.entities,
      "dummy-metered-device": {
        id: "dummy-metered-device",
        definitionId: "vaporizer_1",
        position: { x: 1, y: 1 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
  };
}

function attachSimulationStub(
  workspace: WorkspaceContract,
  options: {
    state: SimulationRunState;
    runtimeStatus: ReturnType<NonNullable<WorkspaceContract["simulation"]>["queries"]["getDeviceRuntimeStatus"]>;
  },
) {
  const getDeviceRuntimeStatus = vi.fn(() => options.runtimeStatus);

  workspace.simulation = {
    state: {
      runningState: options.state,
      simulationSpeed: 1,
      statistics: { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 },
      bufferSize: 0,
      timeline: createInitialSimulationTimelineState(),
    },
    topology: createSnapshotStore(null),
    queries: {
      getStatusRuntimeJson: () => JSON.stringify({
        state: {
          runningState: options.state,
          simulationSpeed: 1,
          currentPlaybackTickNumber: 0,
        },
        runtimeStatus: {
          mode: options.state === "start" ? "running" : "stopped",
          topologyId: null,
          documentHash: null,
          retainedFromTick: null,
          latestTickNumber: null,
          bufferSize: 0,
          maxBufferSize: 180,
          error: null,
        },
        currentTick: null,
      }),
      getDocumentRuntimeStatus: () => ({
        tickNumber: null,
        totalPowerDemand: null,
        currentPowerGeneration: null,
        isPowerOutage: false,
      }),
      getDeviceRuntimeStatus,
      getPipeFluidItemId: () => null,
      isPipeDeviceSlotOccupied: () => false,
      getActiveGasDiffusionRanges: () => [],
      getDeviceActiveGasItemIds: () => null,
      getWarehouseStats: () => null,
    },
    actions: {
      start: vi.fn(async () => {}),
      setRegionalMultiBaseEnabled: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      setSimulationSpeed: vi.fn(),
      advancePlaybackByDeltaMs: vi.fn(async () => {}),
      patchRuntimeSlot: vi.fn(async () => {}),
      resetAdmissionCounter: vi.fn(async () => {}),
      enableTimeline: vi.fn(async () => {}),
      disableTimeline: vi.fn(),
      seekTimelineToTick: vi.fn(async () => false),
    },
  } as NonNullable<WorkspaceContract["simulation"]>;

  return { getDeviceRuntimeStatus };
}

describe("SelectionInspectorSlot", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost | null;
  let editorHost: EditorHost | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = null;
    editorHost = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    appHost?.dispose();
    editorHost?.dispose();
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts the default slot-config inspector for a storage device selection", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    expect(container.querySelector("[data-selection-inspector-slot]")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toEqual([
      "problem-inspector",
      "slot-config",
      "submit-to-warehouse",
      "port-priority-group",
    ]);
    expect(container.querySelector("[data-slot-config-group='storage_slot_1']")).not.toBeNull();
    const firstSlotTile = container.querySelector<HTMLElement>("[data-slot-action='open-slot-editor']");
    expect(firstSlotTile?.dataset.slotNumber).toBe("1");
    expect(firstSlotTile?.textContent).not.toContain("slot_1");
  });

  it("renders the current logistics item as an icon and name without quantity or edit controls", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithLogisticsDevice());
    editorHost.internalState.collections.selection.replace(["dummy-logistics-device"]);
    attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        slotItems: [
          {
            storageGroupId: "item_buffer",
            slotId: "slot_0",
            viewRole: "input-view",
            itemType: "item_copper_ore",
            count: 1,
            reserved: 0,
            ignoreStock: false,
          },
          {
            storageGroupId: "item_buffer",
            slotId: "slot_1",
            viewRole: "output-view",
            itemType: "item_copper_ore",
            count: 1,
            reserved: 0,
            ignoreStock: false,
          },
          {
            storageGroupId: "item_buffer",
            slotId: "slot_2",
            viewRole: "output-view",
            itemType: "item_liquid_acid",
            count: 0,
            reserved: 0,
            ignoreStock: false,
          },
        ],
        channelRecipes: {},
        powerStatus: "no-power-needed",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key === "registry.item.item_copper_ore.name" ? "测试铜矿" : key}
        />,
      );
      vi.advanceTimersByTime(50);
    });

    const panel = container.querySelector<HTMLElement>("[data-inspector-key='logistics-item']");

    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("物流物品");
    expect(panel?.textContent).toContain("测试铜矿");
    expect(panel?.textContent).not.toContain("item_liquid_acid");
    expect(panel?.textContent).not.toContain("1");
    expect(panel?.querySelectorAll("[data-item-id='item_copper_ore']")).toHaveLength(1);
    expect(panel?.querySelector("[data-item-id='item_copper_ore'] img")).not.toBeNull();
    expect(panel?.querySelectorAll("button")).toHaveLength(1);
    expect(panel?.querySelector("input, select, textarea")).toBeNull();
  });

  it("renders the real consumption slot count multiplied by six on a 0-30 ruler", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithMeteredDevice());
    editorHost.internalState.collections.selection.replace(["dummy-metered-device"]);
    attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        slotItems: [{
          storageGroupId: "consume_buffer",
          slotId: "consume_slot",
          viewRole: "input-view",
          itemType: "item_gas_acid",
          count: 4,
          reserved: 4,
          ignoreStock: false,
        }],
        channelRecipes: {},
        powerStatus: "in-power-range",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
      vi.advanceTimersByTime(50);
    });

    const panel = container.querySelector<HTMLElement>("[data-inspector-key='metered-consumption']");
    const ruler = panel?.querySelector<HTMLElement>("[role='meter']");
    const cursor = panel?.querySelector<HTMLElement>("[data-metered-consumption-cursor='24']");
    const threshold = panel?.querySelector<HTMLElement>("[data-metered-consumption-threshold='6']");
    const itemIcon = panel?.querySelector<HTMLElement>(
      "[data-metered-consumption-item-id='item_gas_acid']",
    );

    expect(panel?.textContent).toContain("运行消耗");
    expect(panel?.textContent).not.toContain("当前/上一分钟最大值");
    expect(itemIcon?.querySelector("img")?.getAttribute("src")).toContain(
      "item-icons/item_gas_acid.webp",
    );
    expect(ruler?.getAttribute("aria-valuemin")).toBe("0");
    expect(ruler?.getAttribute("aria-valuemax")).toBe("30");
    expect(ruler?.getAttribute("aria-valuenow")).toBe("24");
    expect(ruler?.dataset.consumptionSlotCount).toBe("4");
    expect(cursor?.style.left).toBe("80%");
    expect(threshold?.style.left).toBe("20%");
    expect(container.querySelector("[data-inspector-key='slot-config']")).toBeNull();
    expect(container.querySelector(
      `[data-inspector-key='${SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}']`,
    )).toBeNull();

    act(() => {
      runInAction(() => {
        currentAppHost.internalState.settings.debugMode = true;
      });
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    expect(container.querySelector("[data-slot-config-group='consume_buffer']")).not.toBeNull();
    expect(container.querySelector(
      `[data-inspector-key='${SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}']`,
    )).not.toBeNull();
  });

  it("fires the consumption priming button to refill the slot to 5", async () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithMeteredDevice());
    editorHost.internalState.collections.selection.replace(["dummy-metered-device"]);
    attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        slotItems: [{
          storageGroupId: "consume_buffer",
          slotId: "consume_slot",
          viewRole: "input-view",
          itemType: "item_gas_acid",
          count: 2,
          reserved: 2,
          ignoreStock: false,
        }],
        channelRecipes: {},
        powerStatus: "in-power-range",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
      vi.advanceTimersByTime(50);
    });

    const panel = container.querySelector<HTMLElement>("[data-inspector-key='metered-consumption']");
    expect(panel).not.toBeNull();

    const fireButton = panel!.querySelector<HTMLButtonElement>("[aria-label='启动消耗']");
    expect(fireButton).not.toBeNull();
    expect(fireButton!.textContent).toContain("启动");

    act(() => {
      fireButton!.click();
    });

    expect(workspace.simulation?.actions.patchRuntimeSlot).toHaveBeenCalledWith({
      entityId: "dummy-metered-device",
      storageGroupId: "consume_buffer",
      slotId: "consume_slot",
      itemType: "item_gas_acid",
      count: 5,
      ignoreStock: false,
    });
  });

  it("hides on multi selection and remounts after narrowing back to one entity", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(container.querySelector("[data-slot-config-group='storage_slot_1']")).not.toBeNull();

    editorHost.internalState.collections.selection.replace([
      "dummy-entity-2",
      "dummy-entity-3",
    ]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.querySelector("[data-selection-inspector-slot]")).toBeNull();

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.querySelector("[data-slot-config-group='storage_slot_1']")).not.toBeNull();
  });

  it("mounts the simulation recipe status inspector per channel for a device with recipeChannels while simulation is running", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithRecipeDevice());
    editorHost.internalState.collections.selection.replace(["dummy-recipe-device"]);
    const { getDeviceRuntimeStatus } = attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        slotItems: [],
        channelRecipes: {},
        powerStatus: "in-power-range",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(getDeviceRuntimeStatus).toHaveBeenCalledWith("dummy-recipe-device");
    // item_port_mix_pool_1 有 4 个 recipeChannel: ch1-ch4
    // AI-CORRECTION 2026-05-29: 新组件不再按 channel 生成独立 article，
    // 改为单个 article 内部分区展示。
    expect(queryInspectorKeys(container)).toContain(
      SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY,
    );
    expect(container.textContent).toContain("productionPlanning.addRecipe");
    // AI-REMOVED 2026-06-01:
    // Reason: 添加配方按钮已按 UI 要求移除说明文案。
    // Trigger: 用户要求“把添加配方按钮下面的说明去掉”。
    // Evidence: SimulationRecipeStatusRuntimeInspector 不再渲染 productionPlanning.recipeStatusEmptyHint。
    // Replacement: 上一行只断言 productionPlanning.addRecipe 入口存在。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(container.textContent).toContain("productionPlanning.recipeStatusEmptyHint");
  });

  it("renders auto recipe channels as read-only in the recipe status inspector", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithAutoRecipeDevice());
    editorHost.internalState.collections.selection.replace(["dummy-auto-recipe-device"]);
    attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        slotItems: [],
        channelRecipes: {
          default: {
            channelId: "default",
            recipeId: "r_crusher_originium_powder_basic",
            progressSeconds: 1,
            desiredSeconds: 2,
            state: "running",
          },
        },
        powerStatus: "in-power-range",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toContain(
      SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY,
    );
    expect(container.querySelector("[title='productionPlanning.autoRecipeReadonly']")).not.toBeNull();
    expect(container.querySelector("button[aria-label='productionPlanning.remove']")).toBeNull();
  });

  it("mounts the simulation recipe status inspector outside stop state", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldWithRecipeDevice());
    editorHost.internalState.collections.selection.replace(["dummy-recipe-device"]);
    const { getDeviceRuntimeStatus } = attachSimulationStub(workspace, {
      state: "pause",
      runtimeStatus: {
        slotItems: [],
        channelRecipes: {},
        powerStatus: "in-power-range",
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toContain(
      SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY,
    );
    expect(getDeviceRuntimeStatus).toHaveBeenCalledWith("dummy-recipe-device");
  });
});
