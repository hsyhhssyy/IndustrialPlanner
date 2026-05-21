// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import { BlueprintFolderDialog } from "@/app/shell/dialogs/blueprint-folder-dialog";
import { BlueprintPreviewDialog } from "@/app/shell/dialogs/blueprint-preview-dialog";
import { SaveBlueprintDialog } from "@/app/shell/dialogs/save-blueprint-dialog";
import { LeftDock } from "@/app/shell/layout/left-dock";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import {
  createBlueprintFolder,
  deleteBlueprintFolder,
  listBlueprintDirectory,
  readBlueprintFolder,
  readBlueprintRecord,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

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

function createBlueprintPreviewRenderStub() {
  const previewCanvas = document.createElement("canvas");
  const mountBlueprintPreview = vi.fn(async () => "preview-handle");
  const updateBlueprintPreviewViewport = vi.fn();
  const resizeBlueprintPreview = vi.fn();
  const disposeBlueprintPreview = vi.fn();

  return {
    previewCanvas,
    mountBlueprintPreview,
    updateBlueprintPreviewViewport,
    resizeBlueprintPreview,
    disposeBlueprintPreview,
    render: {
      container: document.createElement("div"),
      queries: {
        getBlueprintPreviewCanvas: vi.fn(() => previewCanvas),
      },
      actions: {
        mountBlueprintPreview,
        updateBlueprintPreviewViewport,
        resizeBlueprintPreview,
        disposeBlueprintPreview,
      },
      destroy: vi.fn(),
    } satisfies NonNullable<WorkspaceContract["render"]>,
  };
}

function queryVisibleLeftDockPanel(container: HTMLDivElement): HTMLDivElement | null {
  return container.querySelector(".left-dock-panel:not([hidden])") as HTMLDivElement | null;
}

function queryBlueprintFolderButtonByText(
  container: ParentNode | null,
  text: string,
): HTMLButtonElement | null {
  const buttons = Array.from(container?.querySelectorAll("[data-blueprint-folder-id]") ?? []);

  return buttons.find((button) => button.textContent?.includes(text)) as HTMLButtonElement | null;
}

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchInputEvent(
  target: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Event {
  const prototype = Object.getPrototypeOf(target) as HTMLInputElement | HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(target, value);
  const event = new Event("input", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function dispatchWheelEvent(
  target: Element,
  deltaY: number,
): Event {
  const event = new Event("wheel", { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    deltaY: { value: deltaY },
  });

  target.dispatchEvent(event);
  return event;
}

function stubNavigatorClipboard(options: {
  readText?: () => Promise<string>;
  writeText?: (value: string) => Promise<void>;
} = {}) {
  const clipboard = {
    readText: vi.fn(options.readText ?? (async () => "")),
    writeText: vi.fn(options.writeText ?? (async () => undefined)),
  };

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
}

describe("Left dock panel switching", () => {
  let container: HTMLDivElement;
  let root: Root;
  let coarsePointer: boolean;
  let hoverNone: boolean;

  const setViewport = (options: {
    width: number;
    height: number;
    userAgent: string;
    maxTouchPoints: number;
  }) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: options.width,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: options.height,
    });

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: options.userAgent,
    });

    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: options.maxTouchPoints,
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    coarsePointer = false;
    hoverNone = false;

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });

    setViewport({
      width: 1280,
      height: 800,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    });

    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches:
          (query === "(pointer: coarse)" && coarsePointer) ||
          (query === "(hover: none)" && hoverNone),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders five primary tabs and defaults to the placement panel", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameShowHotkeys = true;
    });

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const toolbarGroups = container.querySelectorAll(".toolbar-rail-group");
    const primaryButtons = toolbarGroups[0]?.querySelectorAll(".rail-button");
    const utilityButtons = toolbarGroups[1]?.querySelectorAll(".rail-button");
    const visiblePanel = queryVisibleLeftDockPanel(container);

    expect(primaryButtons).toHaveLength(5);
    expect(utilityButtons).toHaveLength(3);
    expect(container.textContent).toContain("放置模式");
    expect(visiblePanel).not.toBeNull();

    if (!visiblePanel) {
      throw new Error("Expected the placement panel to be visible by default.");
    }

    expect(visiblePanel?.getAttribute("data-panel-id")).toBe("placement");
    expect(visiblePanel?.textContent).toContain("批量选择");
    expect(visiblePanel.textContent).toContain("暗管出口");
    expect(visiblePanel.textContent).not.toContain("设备");
    expect(visiblePanel.textContent).not.toContain("拖动虚影后点击确认完成放置。");
    expect(visiblePanel.querySelectorAll(".placement-panel-group")).toHaveLength(7);
    expect(visiblePanel.querySelectorAll(".placement-panel-divider")).toHaveLength(6);
    expect(visiblePanel.querySelectorAll(".placement-action-button .button-icon-image")).toHaveLength(
      visiblePanel.querySelectorAll(".placement-action-button").length,
    );
    expect(visiblePanel.querySelectorAll(".placement-device-button .button-icon-image")).toHaveLength(
      visiblePanel.querySelectorAll(".placement-device-button").length,
    );
    expect(visiblePanel.querySelectorAll(".placement-action-button .placement-button-hotkey")).toHaveLength(
      visiblePanel.querySelectorAll(".placement-action-button").length,
    );
    expect(visiblePanel.querySelectorAll(".placement-device-button .placement-button-hotkey")).toHaveLength(0);
    expect(visiblePanel.querySelectorAll(".placement-panel-group-shortcut")).toHaveLength(6);
    expect(visiblePanel.querySelector('[data-ui-button-id="placement-tool-select"]')?.classList.contains("is-active")).toBe(true);
    expect(visiblePanel.querySelector('[data-ui-button-id="placement-tool-marquee"]')?.classList.contains("is-active")).toBe(false);
    expect(visiblePanel.textContent).toContain("Esc");
    expect(visiblePanel.textContent).toContain("X");
    expect(visiblePanel.textContent).toContain("G");
    expect(appHost.internalState.runtime.activePanel).toBeNull();
    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("shows the debug log button above toolbox only when debug mode is enabled", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<LeftToolbar appHost={appHost} />);
    });

    const utilityGroup = container.querySelectorAll(".toolbar-rail-group")[1] as HTMLElement | undefined;
    const utilityTitlesBefore = Array.from(
      utilityGroup?.querySelectorAll(".rail-button") ?? [],
    ).map((button) => button.getAttribute("title"));

    expect(utilityTitlesBefore).toEqual(["工具箱", "帮助", "设置"]);

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugMode = true;
      });
    });

    const utilityTitlesAfter = Array.from(
      utilityGroup?.querySelectorAll(".rail-button") ?? [],
    ).map((button) => button.getAttribute("title"));

    expect(utilityTitlesAfter).toEqual(["调试日志", "工具箱", "帮助", "设置"]);
  });

  it("frames the selected placement group and shows number shortcuts only inside it", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameShowHotkeys = false;
      appHost.internalState.runtime.selectingPlacementGroup = "warehouse";
    });

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const groups = Array.from(
      visiblePanel?.querySelectorAll(".placement-panel-group") ?? [],
    );
    const warehouseGroup = groups.find((group) => group.textContent?.includes("仓库存取"));
    const productionGroup = groups.find((group) => group.textContent?.includes("基础生产"));
    const warehouseDeviceButtons = warehouseGroup?.querySelectorAll(".placement-device-button") ?? [];

    expect(warehouseGroup).not.toBeUndefined();
    expect(productionGroup).not.toBeUndefined();
    expect(warehouseGroup?.classList.contains("is-placement-group-active")).toBe(true);
    expect(productionGroup?.classList.contains("is-placement-group-active")).toBe(false);
    expect(warehouseDeviceButtons.length).toBeGreaterThan(0);
    expect(warehouseGroup?.querySelectorAll(".placement-device-button .placement-button-hotkey")).toHaveLength(
      warehouseDeviceButtons.length,
    );
    expect(productionGroup?.querySelectorAll(".placement-device-button .placement-button-hotkey")).toHaveLength(0);
    expect(visiblePanel?.querySelectorAll(".placement-panel-group-shortcut")).toHaveLength(0);
  });

  it("hides the batch select button when hypergryph operation mode is off", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.gameShowHotkeys = true;
    });

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);

    expect(visiblePanel?.querySelector('[data-ui-button-id="placement-tool-select"]')).not.toBeNull();
    expect(visiblePanel?.querySelector('[data-ui-button-id="placement-tool-marquee"]')).toBeNull();
  });

  it("marks the active single-placement device button", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.activeTool = "single-placement";
      appHost.internalState.runtime.singlePlacementDeviceId = "item_port_storager_1";
    });

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const activeDeviceButton = visiblePanel?.querySelector(
      '[data-ui-button-id="placement-item_port_storager_1"]',
    ) as HTMLButtonElement | null;
    const inactiveDeviceButton = visiblePanel?.querySelector(
      '[data-ui-button-id="placement-item_port_grinder_1"]',
    ) as HTMLButtonElement | null;

    expect(activeDeviceButton).not.toBeNull();
    expect(inactiveDeviceButton).not.toBeNull();
    expect(activeDeviceButton?.classList.contains("is-active")).toBe(true);
    expect(activeDeviceButton?.getAttribute("aria-pressed")).toBe("true");
    expect(inactiveDeviceButton?.classList.contains("is-active")).toBe(false);
    expect(inactiveDeviceButton?.hasAttribute("aria-pressed")).toBe(false);
    expect(visiblePanel?.querySelector('[data-ui-button-id="placement-tool-select"]')?.classList.contains("is-active")).toBe(false);
  });

  it("emits semantic ui-button events and toggles the active placement tool", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const events: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => events.push(event));

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const selectButton = visiblePanel?.querySelector(
      '[data-ui-button-id="placement-tool-select"]',
    ) as HTMLButtonElement | null;
    const marqueeButton = visiblePanel?.querySelector(
      '[data-ui-button-id="placement-tool-marquee"]',
    ) as HTMLButtonElement | null;

    expect(selectButton).not.toBeNull();
    expect(marqueeButton).not.toBeNull();
    expect(selectButton?.classList.contains("is-active")).toBe(true);
    expect(marqueeButton?.classList.contains("is-active")).toBe(false);

    act(() => {
      if (!marqueeButton) {
        throw new Error("Expected the marquee button to be rendered.");
      }

      dispatchPointerEvent(marqueeButton, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 16,
        clientY: 16,
        button: 0,
        buttons: 0,
      });
    });

    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(selectButton?.classList.contains("is-active")).toBe(false);
    expect(marqueeButton?.classList.contains("is-active")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "ui-button-mouse-tap",
      uiButtonId: "placement-tool-marquee",
      button: 0,
    });

    act(() => {
      if (!marqueeButton) {
        throw new Error("Expected the marquee button to be rendered.");
      }

      dispatchPointerEvent(marqueeButton, "pointerup", {
        pointerId: 9,
        pointerType: "mouse",
        clientX: 16,
        clientY: 16,
        button: 0,
        buttons: 0,
      });
    });

    expect(appHost.internalState.activeTool).toBe("marquee");
    expect(selectButton?.classList.contains("is-active")).toBe(false);
    expect(marqueeButton?.classList.contains("is-active")).toBe(true);

    act(() => {
      if (!selectButton) {
        throw new Error("Expected the select button to be rendered.");
      }

      dispatchPointerEvent(selectButton, "pointerup", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 20,
        clientY: 20,
        buttons: 0,
      });
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(selectButton?.classList.contains("is-active")).toBe(true);
    expect(marqueeButton?.classList.contains("is-active")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "ui-button-touch-tap",
      uiButtonId: "placement-tool-select",
    });
  });

  it("switches runtime activePanel and left dock content without remounting panel containers", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const placementPanelBeforeSwitch = container.querySelector(
      '.left-dock-panel[data-panel-id="placement"]',
    ) as HTMLDivElement | null;

    expect(placementPanelBeforeSwitch).not.toBeNull();
    expect(placementPanelBeforeSwitch?.hidden).toBe(false);

    const clickTab = (label: string) => {
      const button = container.querySelector(
        `button[title="${label}"]`,
      ) as HTMLButtonElement | null;

      expect(button).not.toBeNull();

      if (!button) {
        throw new Error(`Left toolbar tab ${label} was not rendered.`);
      }

      act(() => {
        button.click();
      });

      return button;
    };

    const historyButton = clickTab("操作历史");
    const historyPanel = queryVisibleLeftDockPanel(container);

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(historyButton.getAttribute("aria-pressed")).toBe("true");
    expect(placementPanelBeforeSwitch?.hidden).toBe(true);
    expect(historyPanel?.getAttribute("data-panel-id")).toBe("history");
    // AI-REMOVED 2026-05-10:
    // Reason: 历史面板已不再提供“清空历史”按钮，旧断言与当前实现不符。
    // Trigger: 针对左侧 dock 的窄测试暴露出陈旧断言。
    // Evidence: HistoryPanel 当前只渲染撤销与重做两个操作按钮。
    // Replacement: 当前的撤销/重做文案断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(historyPanel?.textContent).toContain("清空历史");
    expect(historyPanel?.textContent).toContain("撤销");
    expect(historyPanel?.textContent).toContain("重做");
    expect(historyPanel?.textContent).toContain("历史记录");
    expect(historyPanel?.textContent).toContain("暂无历史记录");

    const blueprintButton = clickTab("蓝图模式");
    const blueprintPanel = queryVisibleLeftDockPanel(container);

    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");
    expect(blueprintButton.getAttribute("aria-pressed")).toBe("true");
    expect(blueprintPanel?.getAttribute("data-panel-id")).toBe("blueprint");
    expect(blueprintPanel?.querySelector('[data-ui-button-id="blueprint-action-import-file"]')).not.toBeNull();
    expect(blueprintPanel?.querySelector('[data-ui-button-id="blueprint-tab-user"]')).not.toBeNull();
    expect(blueprintPanel?.querySelector('[data-ui-button-id="blueprint-tab-user"]')?.classList.contains("dialog-shell-tab")).toBe(true);
    expect(blueprintPanel?.querySelector('[data-ui-button-id="blueprint-folder-create-toggle"]')).not.toBeNull();
    expect(blueprintPanel?.querySelector('[data-ui-button-id="blueprint-folder-create-toggle"]')?.textContent?.trim()).toBe("新建");

    // AI-REMOVED 2026-05-10:
    // Reason: 左侧删除模式和删除面板已废弃，测试不再验证其可见性和切换行为。
    // Trigger: 产品要求移除左侧“删除模式”和整个删除面板。
    // Evidence: LeftToolbar 与 LeftDock 的 delete 注册已移除，ActivePanel 也不再接受 delete。
    // Replacement: 当前的不存在断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const deleteButton = clickTab("删除模式");
    // const deletePanel = queryVisibleLeftDockPanel(container);
    //
    // expect(appHost.internalState.runtime.activePanel).toBe("delete");
    // expect(deleteButton.getAttribute("aria-pressed")).toBe("true");
    // expect(deletePanel?.getAttribute("data-panel-id")).toBe("delete");
    // expect(deletePanel?.textContent).toContain("单点删除");
    // expect(deletePanel?.textContent).toContain("恢复最近");
    const deleteButton = container.querySelector('button[title="删除模式"]');
    const deletePanel = container.querySelector('.left-dock-panel[data-panel-id="delete"]');

    expect(deleteButton).toBeNull();
    expect(deletePanel).toBeNull();
    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");

    const baseButton = clickTab("基地");
    const basePanel = queryVisibleLeftDockPanel(container);

    expect(appHost.internalState.runtime.activePanel).toBe("base");
    expect(baseButton.getAttribute("aria-pressed")).toBe("true");
    expect(basePanel?.getAttribute("data-panel-id")).toBe("base");
    expect(basePanel?.querySelector('[data-ui-button-id="base-current-select"]')).not.toBeNull();
    expect(basePanel?.querySelector(".inspector-option-grid")).toBeNull();
    expect(basePanel?.textContent).toContain("协议核心区");
    expect(basePanel?.textContent).toContain("总耗电");

    const simulationButton = clickTab("仿真");
    const simulationPanel = queryVisibleLeftDockPanel(container);
    const simulationTextarea = simulationPanel?.querySelector(
      "[data-simulation-runtime-json]",
    ) as HTMLTextAreaElement | null;

    expect(appHost.internalState.runtime.activePanel).toBe("simulation");
    expect(simulationButton.getAttribute("aria-pressed")).toBe("true");
    expect(simulationPanel?.getAttribute("data-panel-id")).toBe("simulation");
    expect(simulationTextarea).not.toBeNull();
    expect(simulationTextarea?.value).toBe("null");

    act(() => {
      clickTab("放置模式");
    });

    const placementPanelAfterSwitch = container.querySelector(
      '.left-dock-panel[data-panel-id="placement"]',
    ) as HTMLDivElement | null;

    expect(placementPanelAfterSwitch).toBe(placementPanelBeforeSwitch);
    expect(placementPanelAfterSwitch?.hidden).toBe(false);
  });

  it("opens a grouped base selection dialog from the current base button", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    await flushAsyncEffects();

    editorHost.internalDocument.setSnapshot({
      ...createDummyWorldDocument(),
      baseId: "valley4_protocol_core",
      entityOrder: ["dummy-entity-2"],
    });

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const baseToolbarButton = container.querySelector(
      'button[title="基地"]',
    ) as HTMLButtonElement | null;

    expect(baseToolbarButton).not.toBeNull();

    act(() => {
      baseToolbarButton?.click();
    });

    const basePanel = queryVisibleLeftDockPanel(container);
    const currentBaseButton = basePanel?.querySelector(
      '[data-ui-button-id="base-current-select"]',
    ) as HTMLButtonElement | null;

    expect(currentBaseButton).not.toBeNull();
    expect(currentBaseButton?.textContent).toContain("协议核心区");
    expect(currentBaseButton?.querySelector('[data-workbench-icon="edit"]')).not.toBeNull();

    await act(async () => {
      currentBaseButton?.click();
      await flushAsyncEffects();
    });

    const dialog = container.querySelector(".base-select-dialog") as HTMLElement | null;

    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("四号谷地");
    expect(dialog?.textContent).toContain("武陵");
    expect(dialog?.textContent).toContain("1 台设备");
    expect(dialog?.querySelector('[data-base-id="valley4_protocol_core"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(dialog?.querySelector('[data-base-id="wuling_protocol_core"]')).not.toBeNull();
  });

  it("reopens the left dock and switches to the clicked panel when the dock is closed", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<LeftToolbar appHost={appHost} />);
    });

    act(() => {
      appHost.internalActions.toggleLeftDock();
    });

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.runtime.activePanel).toBeNull();

    const historyButton = container.querySelector(
      'button[title="操作历史"]',
    ) as HTMLButtonElement | null;

    expect(historyButton).not.toBeNull();
    expect(historyButton?.classList.contains("is-active")).toBe(false);
    expect(historyButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      historyButton?.click();
    });

    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(historyButton?.classList.contains("is-active")).toBe(true);
    expect(historyButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const historyPanel = queryVisibleLeftDockPanel(container);

    expect(historyPanel?.getAttribute("data-panel-id")).toBe("history");
    // AI-REMOVED 2026-05-10:
    // Reason: 历史面板已不再提供“清空历史”按钮，旧断言与当前实现不符。
    // Trigger: 针对左侧 dock 的窄测试暴露出陈旧断言。
    // Evidence: HistoryPanel 当前只渲染撤销与重做两个操作按钮。
    // Replacement: 当前的撤销/重做文案断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(historyPanel?.textContent).toContain("清空历史");
    expect(historyPanel?.textContent).toContain("撤销");
    expect(historyPanel?.textContent).toContain("重做");
  });

  it("collapses the left dock when clicking the currently visible panel button", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const placementButton = container.querySelector(
      'button[title="放置模式"]',
    ) as HTMLButtonElement | null;

    expect(placementButton).not.toBeNull();
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(container.querySelector(".dock-left")).not.toBeNull();

    act(() => {
      placementButton?.click();
    });

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(container.querySelector(".dock-left")).toBeNull();

    act(() => {
      placementButton?.click();
    });

    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(queryVisibleLeftDockPanel(container)?.getAttribute("data-panel-id")).toBe("placement");
  });

  it("hides placement shortcut hints in mobile mode", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const operationGroup = visiblePanel?.querySelector(".placement-panel-group-operation") as HTMLElement | null;
    const operationButtonList = operationGroup?.querySelector(".placement-operation-button-list") as HTMLElement | null;

    expect(visiblePanel?.getAttribute("data-panel-id")).toBe("placement");
    expect(operationGroup).not.toBeNull();
    expect(operationGroup?.querySelector(".placement-panel-group-header")).toBeNull();
    expect(operationButtonList?.classList.contains("is-mobile-icon-grid")).toBe(true);
    expect(operationGroup?.querySelectorAll(".placement-action-button")).toHaveLength(4);
    expect(operationGroup?.querySelectorAll(".placement-button-label")).toHaveLength(0);
    expect(operationGroup?.querySelectorAll(".placement-button-hotkey")).toHaveLength(0);
    expect(operationGroup?.querySelectorAll(".placement-action-button .button-icon-image")).toHaveLength(4);
    expect(operationGroup?.querySelector('[data-ui-button-id="placement-tool-select"]')?.getAttribute("aria-label")).toBe("选择");
    expect(operationGroup?.textContent).not.toContain("操作");
    expect(operationGroup?.textContent).not.toContain("选择");
    expect(operationGroup?.textContent).not.toContain("Esc");
    expect(visiblePanel?.querySelector(".placement-button-list")?.classList.contains("is-single-column")).toBe(true);
    expect(visiblePanel?.querySelectorAll(".placement-button-hotkey")).toHaveLength(0);
    expect(visiblePanel?.querySelectorAll(".placement-panel-group-shortcut")).toHaveLength(0);
  });

  it("uses the same touch placement layout on tablets", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 1024,
      height: 768,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(
        <>
          <LeftToolbar appHost={appHost} />
          <LeftDock appHost={appHost} />
        </>,
      );
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const operationGroup = visiblePanel?.querySelector(".placement-panel-group-operation") as HTMLElement | null;
    const operationButtonList = operationGroup?.querySelector(".placement-operation-button-list") as HTMLElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.state.screenProfile.hasTouch).toBe(true);
    expect(visiblePanel?.querySelector(".section-header")).toBeNull();
    expect(operationGroup?.querySelector(".placement-panel-group-header")).toBeNull();
    expect(operationButtonList?.classList.contains("is-mobile-icon-grid")).toBe(true);
    expect(operationGroup?.querySelectorAll(".placement-action-button")).toHaveLength(4);
    expect(visiblePanel?.querySelector(".placement-button-list")?.classList.contains("is-single-column")).toBe(true);
    expect(visiblePanel?.querySelectorAll(".placement-button-hotkey")).toHaveLength(0);
    expect(visiblePanel?.querySelectorAll(".placement-panel-group-shortcut")).toHaveLength(0);
  });

  it("shows only compact import actions in narrow touch layout", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(<LeftDock appHost={appHost} />);
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const operationGroup = visiblePanel?.querySelector(".placement-panel-group-operation") as HTMLElement | null;
    const operationButtonList = operationGroup?.querySelector(".placement-operation-button-list") as HTMLElement | null;
    const tabShell = visiblePanel?.querySelector(".blueprint-tab-shell") as HTMLDivElement | null;

    expect(visiblePanel?.getAttribute("data-panel-id")).toBe("blueprint");
    expect(operationGroup?.querySelector(".placement-panel-group-header")).toBeNull();
    expect(operationButtonList).not.toBeNull();
    expect(operationButtonList?.classList.contains("is-compact-import-actions")).toBe(true);
    expect(tabShell?.classList.contains("is-touch-compact")).toBe(true);
    expect(operationGroup?.querySelectorAll(".blueprint-action-button")).toHaveLength(2);
    expect(operationGroup?.querySelectorAll(".placement-button-label")).toHaveLength(2);
    expect(operationGroup?.querySelector('[data-ui-button-id="blueprint-action-import-file"]')).not.toBeNull();
    expect(operationGroup?.querySelector('[data-ui-button-id="blueprint-action-import-clipboard"]')).not.toBeNull();
    expect(operationGroup?.querySelector('[data-ui-button-id="blueprint-action-export-file"]')).toBeNull();
    expect(operationGroup?.querySelector('[data-ui-button-id="blueprint-action-copy-clipboard"]')).toBeNull();
    expect(operationGroup?.textContent).toContain("文件导入");
    expect(operationGroup?.textContent).toContain("剪贴板导入");
    expect(operationGroup?.textContent).not.toContain("从文件导入");
    expect(operationGroup?.textContent).not.toContain("从剪贴板导入");
    expect(visiblePanel?.querySelector('[data-ui-button-id="blueprint-folder-create-toggle"]')?.getAttribute("aria-label")).toBe("新建文件夹");
    expect(visiblePanel?.querySelector('[data-ui-button-id="blueprint-folder-create-toggle"]')?.textContent?.trim()).toBe("");
  });

  it("keeps the blueprint breadcrumb visible in touch layout while browsing folders", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const rootFolder = await createBlueprintFolder({
      name: "总线蓝图",
    });

    const nestedFolder = await createBlueprintFolder({
      name: "炼油分支",
      parentFolderId: rootFolder?.folderId,
    });

    await saveBlueprintDocument(createTestBlueprint({
      name: "炼油总线样例",
    }), {
      parentFolderId: nestedFolder?.folderId,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(<LeftDock appHost={appHost} />);
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const toolbar = visiblePanel?.querySelector(".blueprint-browser-toolbar") as HTMLDivElement | null;
    const breadcrumb = visiblePanel?.querySelector(".blueprint-breadcrumb") as HTMLDivElement | null;
    const breadcrumbLabel = visiblePanel?.querySelector(".blueprint-path-label") as HTMLSpanElement | null;
    const createFolderToggle = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-folder-create-toggle"]',
    ) as HTMLButtonElement | null;
    const rootFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${rootFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(toolbar?.style.display).toBe("flex");
    expect(toolbar?.style.flexWrap).toBe("nowrap");
    expect(breadcrumb?.style.width).toBe("auto");
    expect(createFolderToggle?.textContent?.trim()).toBe("");
    expect(rootFolderButton).not.toBeNull();
    expect(rootFolderButton?.querySelector(".blueprint-entry-title")?.textContent).toBe("总线蓝图");
    expect(rootFolderButton?.querySelector(".blueprint-entry-meta")).toBeNull();
    expect(rootFolderButton?.querySelector(".pill")).toBeNull();

    await act(async () => {
      rootFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("../总线蓝图");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 总线蓝图");
    expect(breadcrumbLabel?.style.overflowX).toBe("auto");

    const nestedFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${nestedFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(nestedFolderButton).not.toBeNull();

    await act(async () => {
      nestedFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("../炼油分支");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 总线蓝图 / 炼油分支");
  });

  it("browses user blueprints and creates nested folders inside the blueprint panel", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const rootFolder = await createBlueprintFolder({
      name: "总线蓝图",
    });

    await saveBlueprintDocument(createTestBlueprint({
      name: "根目录蓝图",
    }));

    await saveBlueprintDocument(createTestBlueprint({
      name: "仓储总线样例",
      description: "四路汇流",
    }), {
      parentFolderId: rootFolder?.folderId,
    });

    const nestedFolder = await createBlueprintFolder({
      name: "炼油分支",
      parentFolderId: rootFolder?.folderId,
    });

    await saveBlueprintDocument(createTestBlueprint({
      name: "炼油总线样例",
      description: "双线回流",
    }), {
      parentFolderId: nestedFolder?.folderId,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const rootFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${rootFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;
    const rootBlueprintButton = visiblePanel?.querySelector("[data-blueprint-id]") as HTMLButtonElement | null;
    const breadcrumbLabel = visiblePanel?.querySelector(".blueprint-path-label") as HTMLSpanElement | null;
    const toolbar = visiblePanel?.querySelector(".blueprint-browser-toolbar") as HTMLDivElement | null;

    expect(visiblePanel?.getAttribute("data-panel-id")).toBe("blueprint");
    expect(visiblePanel?.querySelector('[data-ui-button-id="blueprint-tab-user"]')?.getAttribute("aria-selected")).toBe("true");
    expect(visiblePanel?.querySelector(".blueprint-library-status")).toBeNull();
    expect(visiblePanel?.textContent).toContain("根目录");
    expect(visiblePanel?.textContent).toContain("总线蓝图");
    expect(visiblePanel?.textContent).toContain("根目录蓝图");
    expect(rootFolderButton).not.toBeNull();
    expect(rootBlueprintButton?.querySelector(".blueprint-entry-description")).toBeNull();
    expect(rootBlueprintButton?.querySelector(".blueprint-entry-meta")).toBeNull();
    expect(rootBlueprintButton?.querySelector(".pill")).toBeNull();
    expect(toolbar?.style.flexWrap).toBe("nowrap");

    await act(async () => {
      rootFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / 总线蓝图");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 总线蓝图");
    const backButton = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-folder-back"]',
    ) as HTMLButtonElement | null;

    expect(backButton).not.toBeNull();
    expect(backButton?.style.borderWidth).toBe("0px");
    expect(visiblePanel?.textContent).toContain("炼油分支");
    expect(visiblePanel?.textContent).toContain("仓储总线样例");

    const describedBlueprintButton = visiblePanel?.querySelector("[data-blueprint-id]") as HTMLButtonElement | null;

    expect(describedBlueprintButton?.querySelector(".blueprint-entry-description")?.textContent).toBe("四路汇流");
    expect(describedBlueprintButton?.querySelector(".blueprint-entry-meta")).toBeNull();
    expect(describedBlueprintButton?.querySelector(".pill")).toBeNull();

    const nestedFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${nestedFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    await act(async () => {
      nestedFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / … / 炼油分支");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 总线蓝图 / 炼油分支");

    const createFolderToggle = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-folder-create-toggle"]',
    ) as HTMLButtonElement | null;

    expect(createFolderToggle?.textContent?.trim()).toBe("新建");
    expect(createFolderToggle?.style.borderWidth).toBe("0px");

    await act(async () => {
      createFolderToggle?.click();
      await flushAsyncEffects();
    });

    const createFolderDialog = container.querySelector(
      '[data-dialog-key="blueprint-folder-create"]',
    ) as HTMLDivElement | null;
    const createFolderInput = createFolderDialog?.querySelector(
      "[data-blueprint-folder-input]",
    ) as HTMLInputElement | null;

    expect(createFolderDialog).not.toBeNull();
    expect(createFolderInput).not.toBeNull();

    await act(async () => {
      if (!createFolderInput) {
        throw new Error("Expected the create folder input to render.");
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;

      valueSetter?.call(createFolderInput, "新建目录");
      createFolderInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const createFolderSubmit = createFolderDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-create-submit"]',
    ) as HTMLButtonElement | null;

    expect(createFolderSubmit).not.toBeNull();

    await act(async () => {
      createFolderSubmit?.click();
      await flushAsyncEffects();
    });

    expect(visiblePanel?.textContent).toContain("新建目录");
  });

  it("renames a folder from the folder edit dialog", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "旧目录",
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const editButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-edit-id="${folder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.click();
      await flushAsyncEffects();
    });

    const editDialog = container.querySelector(
      '[data-dialog-key="blueprint-folder-edit"]',
    ) as HTMLDivElement | null;
    const folderInput = editDialog?.querySelector(
      "[data-blueprint-folder-input]",
    ) as HTMLInputElement | null;

    expect(editDialog).not.toBeNull();
    expect(folderInput?.value).toBe("旧目录");

    await act(async () => {
      if (!folderInput) {
        throw new Error("Expected the edit folder input to render.");
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;

      valueSetter?.call(folderInput, "新目录");
      folderInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const renameButton = editDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-edit-submit"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      renameButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(container.querySelector('[data-dialog-key="blueprint-folder-edit"]')).toBeNull();
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toMatchObject({
      folderId: folder?.folderId,
      name: "新目录",
    });
    expect(visiblePanel?.textContent).toContain("新目录");
    expect(visiblePanel?.textContent).not.toContain("旧目录");
  });

  it("blocks deleting a non-empty folder from the folder edit dialog before confirmation", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "待删除目录",
    });
    const nestedFolder = await createBlueprintFolder({
      name: "待删除子目录",
      parentFolderId: folder?.folderId,
    });
    const blueprint = createTestBlueprint({
      blueprintId: "folder-delete-blueprint",
      name: "目录删除蓝图",
    });

    await saveBlueprintDocument(blueprint, {
      parentFolderId: nestedFolder?.folderId,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const editButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-edit-id="${folder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.click();
      await flushAsyncEffects();
    });

    const editDialog = container.querySelector(
      '[data-dialog-key="blueprint-folder-edit"]',
    ) as HTMLDivElement | null;
    const deleteTrigger = editDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-delete-trigger"]',
    ) as HTMLButtonElement | null;

    expect(deleteTrigger).not.toBeNull();

    await act(async () => {
      deleteTrigger?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const confirmDeleteButton = editDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-delete-confirm"]',
    ) as HTMLButtonElement | null;

    expect(confirmDeleteButton).toBeNull();
    expect(editDialog?.textContent).toContain("文件夹内仍有子文件夹或蓝图，请先清空后再删除。");
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toMatchObject({
      folderId: folder?.folderId,
    });
    await expect(readBlueprintFolder(nestedFolder?.folderId ?? "")).resolves.toMatchObject({
      folderId: nestedFolder?.folderId,
    });
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toMatchObject({
      blueprintId: blueprint.blueprintId,
    });
    expect(visiblePanel?.querySelector(`[data-blueprint-folder-id="${folder?.folderId ?? ""}"]`)).not.toBeNull();
  });

  it("deletes an empty folder from the folder edit dialog after confirmation", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const folder = await createBlueprintFolder({
      name: "待删除空目录",
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const editButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-edit-id="${folder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.click();
      await flushAsyncEffects();
    });

    const editDialog = container.querySelector(
      '[data-dialog-key="blueprint-folder-edit"]',
    ) as HTMLDivElement | null;
    const deleteTrigger = editDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-delete-trigger"]',
    ) as HTMLButtonElement | null;

    expect(deleteTrigger).not.toBeNull();

    await act(async () => {
      deleteTrigger?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const confirmDeleteButton = editDialog?.querySelector(
      '[data-ui-button-id="blueprint-folder-delete-confirm"]',
    ) as HTMLButtonElement | null;

    expect(confirmDeleteButton).not.toBeNull();

    await act(async () => {
      confirmDeleteButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(container.querySelector('[data-dialog-key="blueprint-folder-edit"]')).toBeNull();
    await expect(readBlueprintFolder(folder?.folderId ?? "")).resolves.toBeNull();
    expect(visiblePanel?.querySelector(`[data-blueprint-folder-id="${folder?.folderId ?? ""}"]`)).toBeNull();
  });

  it("shows an empty read-only system blueprint library", async () => {
    vi.stubGlobal("fetch", createFetchStub({
      "/blueprints/index.json": {
        version: "v1.3.0",
        folders: [],
      },
    }));

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(<LeftDock appHost={appHost} />);
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const systemTabButton = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-tab-system"]',
    ) as HTMLButtonElement | null;

    expect(systemTabButton).not.toBeNull();

    await act(async () => {
      systemTabButton?.click();
      await flushAsyncEffects();
    });

    expect(systemTabButton?.getAttribute("aria-selected")).toBe("true");
    expect(visiblePanel?.textContent).toContain("系统蓝图库为空");
    expect(visiblePanel?.textContent).toContain("当前还没有可用的系统蓝图");
    expect(visiblePanel?.querySelector('[data-ui-button-id="blueprint-folder-create-toggle"]')).toBeNull();
  });

  it("remembers separate system and user folder paths and falls back to root when the remembered path is gone", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    vi.stubGlobal("fetch", createFetchStub({
      "/blueprints/index.json": {
        version: "v1.3.0",
        folders: [
          {
            name: "系统总线",
            blueprints: [],
            subfolders: [
              {
                name: "系统炼油",
                blueprints: ["system-oil"],
              },
            ],
          },
        ],
      },
      "/blueprints/system-oil.json": createTestBlueprint({
        name: "系统炼油蓝图",
      }),
    }));

    const userRootFolder = await createBlueprintFolder({
      name: "用户总线",
    });
    const userNestedFolder = await createBlueprintFolder({
      name: "用户炼油",
      parentFolderId: userRootFolder?.folderId,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(<LeftDock appHost={appHost} />);
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const breadcrumbLabel = visiblePanel?.querySelector(".blueprint-path-label") as HTMLSpanElement | null;
    const systemTabButton = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-tab-system"]',
    ) as HTMLButtonElement | null;
    const userTabButton = visiblePanel?.querySelector(
      '[data-ui-button-id="blueprint-tab-user"]',
    ) as HTMLButtonElement | null;

    expect(userTabButton?.getAttribute("aria-selected")).toBe("true");

    const userRootFolderButton = queryBlueprintFolderButtonByText(visiblePanel, "用户总线");

    expect(userRootFolderButton).not.toBeNull();

    await act(async () => {
      userRootFolderButton?.click();
      await flushAsyncEffects();
    });

    const userNestedFolderButton = queryBlueprintFolderButtonByText(visiblePanel, "用户炼油");

    expect(userNestedFolderButton).not.toBeNull();

    await act(async () => {
      userNestedFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / … / 用户炼油");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 用户总线 / 用户炼油");

    await act(async () => {
      systemTabButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(systemTabButton?.getAttribute("aria-selected")).toBe("true");

    const systemRootFolderButton = queryBlueprintFolderButtonByText(visiblePanel, "系统总线");

    expect(systemRootFolderButton).not.toBeNull();

    await act(async () => {
      systemRootFolderButton?.click();
      await flushAsyncEffects();
    });

    const systemNestedFolderButton = queryBlueprintFolderButtonByText(visiblePanel, "系统炼油");

    expect(systemNestedFolderButton).not.toBeNull();

    await act(async () => {
      systemNestedFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / … / 系统炼油");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 系统总线 / 系统炼油");

    await act(async () => {
      userTabButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(userTabButton?.getAttribute("aria-selected")).toBe("true");
    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / … / 用户炼油");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录 / 用户总线 / 用户炼油");

    await expect(deleteBlueprintFolder(userNestedFolder?.folderId ?? "")).resolves.not.toBeNull();
    await expect(deleteBlueprintFolder(userRootFolder?.folderId ?? "")).resolves.not.toBeNull();

    await act(async () => {
      systemTabButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录 / … / 系统炼油");

    await act(async () => {
      userTabButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(breadcrumbLabel?.textContent?.trim()).toBe("根目录");
    expect(breadcrumbLabel?.getAttribute("title")).toBe("根目录");
    expect(visiblePanel?.querySelector('[data-ui-button-id="blueprint-folder-back"]')).toBeNull();
    expect(visiblePanel?.querySelector(`[data-blueprint-folder-id="${userRootFolder?.folderId ?? ""}"]`)).toBeNull();
    expect(visiblePanel?.querySelector(`[data-blueprint-folder-id="${userNestedFolder?.folderId ?? ""}"]`)).toBeNull();
  });

  it("opens the blueprint preview dialog when clicking a blueprint entry", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await saveBlueprintDocument(createTestBlueprint({
      name: "根目录蓝图",
      description: "四路汇流测试",
    }));

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
          <SaveBlueprintDialog appHost={appHost} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const blueprintButton = visiblePanel?.querySelector("[data-blueprint-id]") as HTMLButtonElement | null;

    expect(blueprintButton).not.toBeNull();

    await act(async () => {
      blueprintButton?.click();
    });

    const previewDialog = container.querySelector('[data-dialog-key="blueprint-preview"]');

    expect(appHost.blueprintPreview.dialogState.visible).toBe(true);
    expect(previewDialog).not.toBeNull();
    expect(previewDialog?.textContent).toContain("根目录蓝图");
    expect(previewDialog?.textContent).toContain("蓝图预览");
    expect(previewDialog?.querySelector('[data-ui-button-id="blueprint-preview-place-button"]')).not.toBeNull();
    expect(previewDialog?.querySelector('[data-ui-button-id="blueprint-preview-export-file-button"]')).not.toBeNull();
    expect(previewDialog?.querySelector('[data-ui-button-id="blueprint-preview-copy-clipboard-button"]')).not.toBeNull();
    expect(renderStub.mountBlueprintPreview).toHaveBeenCalledTimes(1);
    expect(renderStub.updateBlueprintPreviewViewport).toHaveBeenCalled();
    expect(previewDialog?.querySelector('[data-blueprint-preview-canvas="true"]')).toBe(renderStub.previewCanvas);
  });

  it("imports a legacy blueprint from the clipboard into the user library", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const clipboard = stubNavigatorClipboard({
      readText: async () => JSON.stringify({
        schema: "industrial-planner-blueprint",
        name: "剪贴板旧版蓝图",
        createdAt: "2026-05-11T00:00:00.000Z",
        baseId: "wuling_protocol_core",
        devices: [{
          typeId: "belt_straight_1x1",
          rotation: 0,
          origin: { x: 5, y: 7 },
        }],
      }),
    });
    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
          <SaveBlueprintDialog appHost={appHost} />
        </>,
      );
      await flushAsyncEffects();
    });

    const importButton = container.querySelector(
      '[data-ui-button-id="blueprint-action-import-clipboard"]',
    ) as HTMLButtonElement | null;

    expect(importButton).not.toBeNull();

    await act(async () => {
      importButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const importedDirectoryBeforeSave = await listBlueprintDirectory();
    const saveDialog = container.querySelector('[data-dialog-key="save-blueprint"]');
    const nameInput = saveDialog?.querySelector(".save-blueprint-input") as HTMLInputElement | null;
    const submitButton = saveDialog?.querySelector(".save-blueprint-primary-button") as HTMLButtonElement | null;

    expect(clipboard.readText).toHaveBeenCalledTimes(1);
    expect(importedDirectoryBeforeSave.blueprints).toHaveLength(0);
    expect(saveDialog).not.toBeNull();
    expect(nameInput?.value).toBe("剪贴板旧版蓝图");
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const importedDirectory = await listBlueprintDirectory();

    expect(importedDirectory.blueprints).toHaveLength(1);
    expect(importedDirectory.blueprints[0]).toMatchObject({
      name: "剪贴板旧版蓝图",
      parentFolderId: null,
    });
    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
  });

  it("imports a blueprint file into the current user folder", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const parentFolder = await createBlueprintFolder({
      name: "导入目录",
    });

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
          <SaveBlueprintDialog appHost={appHost} />
        </>,
      );
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const targetFolderButton = container.querySelector(
      `[data-blueprint-folder-id="${parentFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(targetFolderButton).not.toBeNull();

    await act(async () => {
      targetFolderButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const fileImportInput = container.querySelector(
      '[data-blueprint-import-file-input]',
    ) as HTMLInputElement | null;
    const blueprintFile = new File([
      JSON.stringify(createTestBlueprint({
        name: "文件导入蓝图",
        description: "导入文件内容",
      })),
    ], "import-blueprint.json", {
      type: "application/json",
    });

    expect(fileImportInput).not.toBeNull();

    Object.defineProperty(fileImportInput, "files", {
      configurable: true,
      value: [blueprintFile],
    });

    await act(async () => {
      fileImportInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const importedDirectoryBeforeSave = await listBlueprintDirectory(parentFolder?.folderId ?? null);
    const saveDialog = container.querySelector('[data-dialog-key="save-blueprint"]');
    const nameInput = saveDialog?.querySelector(".save-blueprint-input") as HTMLInputElement | null;
    const breadcrumb = saveDialog?.querySelector("[data-save-blueprint-folder-breadcrumb]") as HTMLSpanElement | null;
    const submitButton = saveDialog?.querySelector(".save-blueprint-primary-button") as HTMLButtonElement | null;

    expect(importedDirectoryBeforeSave.blueprints).toHaveLength(0);
    expect(saveDialog).not.toBeNull();
    expect(nameInput?.value).toBe("文件导入蓝图");
    expect(breadcrumb?.textContent?.trim()).toBe("根目录 / 导入目录");
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const importedDirectory = await listBlueprintDirectory(parentFolder?.folderId ?? null);

    expect(importedDirectory.blueprints).toHaveLength(1);
    expect(importedDirectory.blueprints[0]).toMatchObject({
      name: "文件导入蓝图",
      parentFolderId: parentFolder?.folderId ?? null,
    });
    expect(container.querySelector('[data-dialog-key="save-blueprint"]')).toBeNull();
  });

  it("copies the previewed blueprint to the clipboard as a portable document", async () => {
    const clipboard = stubNavigatorClipboard();
    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    appHost.blueprintPreview.open({
      ...createTestBlueprint({
        name: "导出剪贴板蓝图",
      }),
      parentFolderId: "folder-1",
    });

    await act(async () => {
      root.render(<BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />);
      await flushAsyncEffects();
    });

    const copyButton = container.querySelector(
      '[data-ui-button-id="blueprint-preview-copy-clipboard-button"]',
    ) as HTMLButtonElement | null;

    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.click();
      await flushAsyncEffects();
    });

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);

    const exportedBlueprint = JSON.parse(clipboard.writeText.mock.calls[0]?.[0] ?? "null") as Record<string, unknown>;

    expect(exportedBlueprint.name).toBe("导出剪贴板蓝图");
    expect(exportedBlueprint.parentFolderId).toBeUndefined();
    expect(exportedBlueprint.kind).toBeUndefined();
  });

  it("exports the previewed blueprint to a downloadable file", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:blueprint");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    appHost.blueprintPreview.open({
      ...createTestBlueprint({
        name: "导出文件蓝图",
      }),
      parentFolderId: null,
    });

    await act(async () => {
      root.render(<BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />);
      await flushAsyncEffects();
    });

    const exportButton = container.querySelector(
      '[data-ui-button-id="blueprint-preview-export-file-button"]',
    ) as HTMLButtonElement | null;

    expect(exportButton).not.toBeNull();

    await act(async () => {
      exportButton?.click();
      await flushAsyncEffects();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:blueprint");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const exportedBlob = createObjectURL.mock.calls[0]?.[0] as Blob | undefined;

    expect(exportedBlob).toBeInstanceOf(Blob);
    await expect(exportedBlob?.text() ?? Promise.resolve("")).resolves.toContain("导出文件蓝图");

    clickSpy.mockRestore();
  });

  it("forwards preview zoom gestures to render actions", async () => {
    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    appHost.blueprintPreview.open({
      ...createTestBlueprint({
        name: "缩放预览蓝图",
      }),
      parentFolderId: null,
    });

    await act(async () => {
      root.render(<BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />);
      await flushAsyncEffects();
    });

    renderStub.updateBlueprintPreviewViewport.mockClear();
    const previewSurface = container.querySelector(".blueprint-preview-canvas") as HTMLDivElement | null;

    expect(previewSurface).not.toBeNull();

    await act(async () => {
      if (previewSurface !== null) {
        dispatchWheelEvent(previewSurface, -120);
      }
      await flushAsyncEffects();
    });

    expect(renderStub.updateBlueprintPreviewViewport).toHaveBeenLastCalledWith(
      "preview-handle",
      expect.objectContaining({
        zoom: 1.12,
        offsetX: 0,
        offsetY: 0,
      }),
    );
  });

  it("forwards preview pinch zoom gestures to render actions on touch", async () => {
    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    appHost.blueprintPreview.open({
      ...createTestBlueprint({
        name: "触控缩放预览蓝图",
      }),
      parentFolderId: null,
    });

    await act(async () => {
      root.render(<BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />);
      await flushAsyncEffects();
    });

    renderStub.updateBlueprintPreviewViewport.mockClear();
    const previewSurface = container.querySelector(".blueprint-preview-canvas") as HTMLDivElement | null;

    expect(previewSurface).not.toBeNull();

    await act(async () => {
      if (previewSurface !== null) {
        dispatchPointerEvent(previewSurface, "pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 100,
          clientY: 120,
          button: 0,
          buttons: 1,
        });
        dispatchPointerEvent(previewSurface, "pointerdown", {
          pointerId: 2,
          pointerType: "touch",
          clientX: 160,
          clientY: 120,
          button: 0,
          buttons: 1,
        });
        dispatchPointerEvent(previewSurface, "pointermove", {
          pointerId: 2,
          pointerType: "touch",
          clientX: 220,
          clientY: 120,
          button: 0,
          buttons: 1,
        });
        dispatchPointerEvent(previewSurface, "pointerup", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 100,
          clientY: 120,
          button: 0,
          buttons: 0,
        });
        dispatchPointerEvent(previewSurface, "pointerup", {
          pointerId: 2,
          pointerType: "touch",
          clientX: 220,
          clientY: 120,
          button: 0,
          buttons: 0,
        });
      }
      await flushAsyncEffects();
    });

    const lastCall = renderStub.updateBlueprintPreviewViewport.mock.calls.at(-1);

    expect(lastCall).toBeDefined();
    expect(lastCall?.[0]).toBe("preview-handle");
    expect(lastCall?.[1].offsetX).toBe(0);
    expect(lastCall?.[1].offsetY).toBe(0);
    expect(lastCall?.[1].zoom).toBeCloseTo(2, 5);
  });

  it("forwards preview pan gestures to render actions", async () => {
    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    appHost.blueprintPreview.open({
      ...createTestBlueprint({
        name: "平移预览蓝图",
      }),
      parentFolderId: null,
    });

    await act(async () => {
      root.render(<BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />);
      await flushAsyncEffects();
    });

    renderStub.updateBlueprintPreviewViewport.mockClear();
    const previewSurface = container.querySelector(".blueprint-preview-canvas") as HTMLDivElement | null;

    expect(previewSurface).not.toBeNull();

    await act(async () => {
      if (previewSurface !== null) {
        dispatchPointerEvent(previewSurface, "pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 100,
          clientY: 100,
          button: 0,
          buttons: 1,
        });
        dispatchPointerEvent(previewSurface, "pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 132,
          clientY: 118,
          button: 0,
          buttons: 1,
        });
        dispatchPointerEvent(previewSurface, "pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 132,
          clientY: 118,
          button: 0,
          buttons: 0,
        });
      }
      await flushAsyncEffects();
    });

    expect(renderStub.updateBlueprintPreviewViewport).toHaveBeenCalledWith(
      "preview-handle",
      expect.objectContaining({
        zoom: 1,
        offsetX: 32,
        offsetY: 18,
      }),
    );
  });

  it("uses the preview dialog place action instead of rendering a dock detail inspector", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    await saveBlueprintDocument(createPlacementBlueprint({
      name: "详情卡放置蓝图",
      description: "从预览窗口进入放置",
    }));

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const blueprintButton = visiblePanel?.querySelector("[data-blueprint-id]") as HTMLButtonElement | null;

    expect(blueprintButton).not.toBeNull();

    await act(async () => {
      blueprintButton?.click();
      await flushAsyncEffects();
    });

    const previewDialog = container.querySelector('[data-dialog-key="blueprint-preview"]');
    const placeButton = previewDialog?.querySelector(
      '[data-ui-button-id="blueprint-preview-place-button"]',
    ) as HTMLButtonElement | null;

    expect(visiblePanel?.querySelector(".blueprint-detail-card")).toBeNull();
    expect(previewDialog).not.toBeNull();
    expect(placeButton).not.toBeNull();
    expect(renderStub.mountBlueprintPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      placeButton?.click();
      await flushAsyncEffects();
    });

    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");
    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
  });

  it("deletes a user blueprint from the preview dialog and refreshes the list", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const blueprint = createPlacementBlueprint({
      name: "待删除蓝图",
      description: "从预览窗口删除",
    });

    await saveBlueprintDocument(blueprint);

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const blueprintButton = visiblePanel?.querySelector(
      `[data-blueprint-id="${blueprint.blueprintId}"]`,
    ) as HTMLButtonElement | null;

    expect(blueprintButton).not.toBeNull();

    await act(async () => {
      blueprintButton?.click();
      await flushAsyncEffects();
    });

    const previewDialog = container.querySelector('[data-dialog-key="blueprint-preview"]');
    const deleteButton = previewDialog?.querySelector(
      '[data-ui-button-id="blueprint-preview-delete-button"]',
    ) as HTMLButtonElement | null;

    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
      await flushAsyncEffects();
    });

    const confirmButton = previewDialog?.querySelector(
      '[data-ui-button-id="blueprint-preview-delete-confirm-button"]',
    ) as HTMLButtonElement | null;

    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toBeNull();
    expect(visiblePanel?.querySelector(`[data-blueprint-id="${blueprint.blueprintId}"]`)).toBeNull();
  });

  it("edits a user blueprint from the preview dialog and saves it into a nested folder", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const targetRootFolder = await createBlueprintFolder({
      name: "生产线目录",
    });

    const targetNestedFolder = await createBlueprintFolder({
      name: "炼油支线",
      parentFolderId: targetRootFolder?.folderId,
    });

    const blueprint = createPlacementBlueprint({
      name: "待移动蓝图",
      description: "从预览窗口移动",
    });

    await saveBlueprintDocument(blueprint);

    const workspace = createWorkspace();
    const renderStub = createBlueprintPreviewRenderStub();
    workspace.render = renderStub.render;
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.runtime.activePanel = "blueprint";
    });

    await act(async () => {
      root.render(
        <>
          <LeftDock appHost={appHost} />
          <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
          <SaveBlueprintDialog appHost={appHost} />
        </>,
      );
      await flushAsyncEffects();
    });

    const visiblePanel = queryVisibleLeftDockPanel(container);
    const blueprintButton = visiblePanel?.querySelector(
      `[data-blueprint-id="${blueprint.blueprintId}"]`,
    ) as HTMLButtonElement | null;

    expect(blueprintButton).not.toBeNull();

    await act(async () => {
      blueprintButton?.click();
      await flushAsyncEffects();
    });

    const previewDialog = container.querySelector('[data-dialog-key="blueprint-preview"]');
    const editButton = previewDialog?.querySelector(
      '[data-ui-button-id="blueprint-preview-move-button"]',
    ) as HTMLButtonElement | null;

    expect(editButton).not.toBeNull();
    expect(editButton?.textContent?.trim()).toBe("修改");

    await act(async () => {
      editButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await flushAsyncEffects();
    });

    const saveDialog = container.querySelector('[data-dialog-key="save-blueprint"]');
    const nameInput = saveDialog?.querySelector(".save-blueprint-input") as HTMLInputElement | null;
    const descriptionInput = saveDialog?.querySelector(".save-blueprint-textarea") as HTMLTextAreaElement | null;
    const folderBreadcrumb = saveDialog?.querySelector(
      "[data-save-blueprint-folder-breadcrumb]",
    ) as HTMLSpanElement | null;

    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
    expect(saveDialog).not.toBeNull();
    expect(nameInput?.value).toBe("待移动蓝图");
    expect(descriptionInput?.value).toBe("从预览窗口移动");
    expect(folderBreadcrumb?.textContent?.trim()).toBe("根目录");

    if (!nameInput || !descriptionInput) {
      throw new Error("Save blueprint edit dialog did not render expected controls.");
    }

    await act(async () => {
      dispatchInputEvent(nameInput, "已修改蓝图");
      dispatchInputEvent(descriptionInput, "从修改窗口保存");
    });

    const rootFolderEntry = saveDialog?.querySelector(
      `[data-save-blueprint-folder-id="${targetRootFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(rootFolderEntry).not.toBeNull();
    expect(rootFolderEntry?.querySelector(".button-icon-image")).not.toBeNull();

    await act(async () => {
      rootFolderEntry?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    const backButton = saveDialog?.querySelector(
      '[data-ui-button-id="save-blueprint-folder-back-button"]',
    ) as HTMLButtonElement | null;

    expect(backButton).not.toBeNull();
    expect(backButton?.textContent?.trim()).toBe("");
    expect(folderBreadcrumb?.textContent?.trim()).toBe("根目录 / 生产线目录");

    const nestedFolderEntry = saveDialog?.querySelector(
      `[data-save-blueprint-folder-id="${targetNestedFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(nestedFolderEntry).not.toBeNull();

    await act(async () => {
      nestedFolderEntry?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(folderBreadcrumb?.textContent?.trim()).toBe("根目录 / … / 炼油支线");

    const saveButton = saveDialog?.querySelector(
      ".save-blueprint-primary-button",
    ) as HTMLButtonElement | null;

    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(false);
    expect(saveButton?.textContent?.trim()).toBe("保存");

    await act(async () => {
      saveButton?.click();
      await flushAsyncEffects();
      await flushAsyncEffects();
    });

    expect(appHost.blueprintPreview.dialogState.visible).toBe(false);
    await expect(readBlueprintRecord(blueprint.blueprintId)).resolves.toMatchObject({
      name: "已修改蓝图",
      description: "从修改窗口保存",
      parentFolderId: targetNestedFolder?.folderId ?? null,
    });
    expect(visiblePanel?.querySelector(`[data-blueprint-id="${blueprint.blueprintId}"]`)).toBeNull();

    const targetRootFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${targetRootFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(targetRootFolderButton).not.toBeNull();

    await act(async () => {
      targetRootFolderButton?.click();
      await flushAsyncEffects();
    });

    const targetNestedFolderButton = visiblePanel?.querySelector(
      `[data-blueprint-folder-id="${targetNestedFolder?.folderId ?? ""}"]`,
    ) as HTMLButtonElement | null;

    expect(targetNestedFolderButton).not.toBeNull();

    await act(async () => {
      targetNestedFolderButton?.click();
      await flushAsyncEffects();
    });

    expect(visiblePanel?.querySelector(`[data-blueprint-id="${blueprint.blueprintId}"]`)).not.toBeNull();
  });
});

async function flushAsyncEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createTestBlueprint(
  overrides: Partial<ReturnType<typeof createBlueprintDocument>> = {},
) {
  return createBlueprintDocument({
    name: "蓝图样例",
    description: "",
    baseId: "wuling_protocol_core",
    initialGridPoint: { x: 10, y: 12 },
    entities: {
      assembler_1: {
        id: "assembler_1",
        definitionId: "assembler",
        position: { x: 10, y: 12 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["assembler_1"],
    slotLinks: [],
    ...overrides,
  });
}

function createPlacementBlueprint(
  overrides: Partial<ReturnType<typeof createBlueprintDocument>> = {},
) {
  return createBlueprintDocument({
    name: "蓝图放置样例",
    description: "",
    baseId: "wuling_protocol_core",
    initialGridPoint: { x: 10, y: 10 },
    entities: {
      source: {
        id: "source",
        definitionId: "item_port_storager_1",
        position: { x: 9, y: 9 },
        rotation: 0,
        config: {},
        tags: [],
      },
      target: {
        id: "target",
        definitionId: "item_port_storager_1",
        position: { x: 12, y: 9 },
        rotation: 90,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["source", "target"],
    slotLinks: [{
      id: "source-target-link",
      linkType: "share-all",
      source: {
        entityId: "source",
        storageSlotGroupId: "output",
        slotId: "output-slot",
      },
      target: {
        entityId: "target",
        storageSlotGroupId: "input",
        slotId: "input-slot",
      },
    }],
    ...overrides,
  });
}

function createFetchStub(payloads: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = normalizeFetchPath(input);
    const payload = payloads[path];

    if (payload === undefined) {
      return {
        ok: false,
        status: 404,
        json: async () => null,
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response;
  });
}

function normalizeFetchPath(input: string | URL | Request): string {
  if (typeof input === "string") {
    return new URL(input, "https://placeholder.local").pathname;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url, "https://placeholder.local").pathname;
}
