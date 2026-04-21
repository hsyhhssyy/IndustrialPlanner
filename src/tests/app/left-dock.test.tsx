// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/app-host";
import { LeftDock } from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
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

describe("Left dock panel switching", () => {
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
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders four primary tabs and defaults to the placement panel", () => {
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

    const toolbarGroups = container.querySelectorAll(".toolbar-rail-group");
    const primaryButtons = toolbarGroups[0]?.querySelectorAll(".rail-button");

    expect(primaryButtons).toHaveLength(4);
    expect(container.textContent).toContain("放置模式");
    expect(container.textContent).toContain("保存蓝图");
    expect(container.textContent).toContain("多口暗管出口");
    expect(container.textContent).not.toContain("设备");
    expect(container.textContent).not.toContain("拖动虚影后点击确认完成放置。");
    expect(container.querySelectorAll(".placement-panel-group")).toHaveLength(6);
    expect(container.querySelectorAll(".placement-panel-divider")).toHaveLength(5);
    expect(container.querySelectorAll(".placement-button .button-icon-image")).toHaveLength(
      container.querySelectorAll(".placement-button").length,
    );
    expect(container.querySelectorAll(".placement-action-button .placement-button-hotkey")).toHaveLength(2);
    expect(container.querySelectorAll(".placement-device-button .placement-button-hotkey")).toHaveLength(22);
    expect(container.textContent).toContain("Esc");
    expect(container.textContent).toContain("Ctrl+S");
    expect(appHost.internalState.runtime.activePanel).toBeNull();
  });

  it("switches runtime activePanel and left dock content when tabs are clicked", () => {
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

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(historyButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("清空历史");
    expect(container.textContent).toContain("文档命令流");

    const blueprintButton = clickTab("蓝图模式");

    expect(appHost.internalState.runtime.activePanel).toBe("blueprint");
    expect(blueprintButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("导入蓝图");
    expect(container.textContent).toContain("仓库总线样例");

    const deleteButton = clickTab("删除模式");

    expect(appHost.internalState.runtime.activePanel).toBe("delete");
    expect(deleteButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("单点删除");
    expect(container.textContent).toContain("恢复最近");
  });
});