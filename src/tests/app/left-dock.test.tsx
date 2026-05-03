// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import { LeftDock } from "@/app/shell/layout/left-dock";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
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

function queryVisibleLeftDockPanel(container: HTMLDivElement): HTMLDivElement | null {
  return container.querySelector(".left-dock-panel:not([hidden])") as HTMLDivElement | null;
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

  it("renders four primary tabs and defaults to the placement panel", () => {
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

    expect(primaryButtons).toHaveLength(4);
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
    expect(historyPanel?.textContent).toContain("清空历史");
    expect(historyPanel?.textContent).toContain("文档命令流");

    const blueprintButton = clickTab("蓝图模式");
    const blueprintPanel = queryVisibleLeftDockPanel(container);

    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");
    expect(blueprintButton.getAttribute("aria-pressed")).toBe("true");
    expect(blueprintPanel?.getAttribute("data-panel-id")).toBe("blueprint");
    expect(blueprintPanel?.textContent).toContain("导入蓝图");
    expect(blueprintPanel?.textContent).toContain("仓库总线样例");

    const deleteButton = clickTab("删除模式");
    const deletePanel = queryVisibleLeftDockPanel(container);

    expect(appHost.internalState.runtime.activePanel).toBe("delete");
    expect(deleteButton.getAttribute("aria-pressed")).toBe("true");
    expect(deletePanel?.getAttribute("data-panel-id")).toBe("delete");
    expect(deletePanel?.textContent).toContain("单点删除");
    expect(deletePanel?.textContent).toContain("恢复最近");

    act(() => {
      clickTab("放置模式");
    });

    const placementPanelAfterSwitch = container.querySelector(
      '.left-dock-panel[data-panel-id="placement"]',
    ) as HTMLDivElement | null;

    expect(placementPanelAfterSwitch).toBe(placementPanelBeforeSwitch);
    expect(placementPanelAfterSwitch?.hidden).toBe(false);
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

    act(() => {
      historyButton?.click();
    });

    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.internalState.runtime.activePanel).toBe("history");

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
    expect(historyPanel?.textContent).toContain("清空历史");
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
});
