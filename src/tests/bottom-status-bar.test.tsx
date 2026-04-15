// @vitest-environment jsdom

import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { createWorkbenchController as createWorkbenchControllerBase } from "@/workspace/workspace-controller";
import { asLegacyWorkbenchController } from "@/tests/helpers/legacy-workbench-controller";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const createWorkbenchController = (
  ...args: Parameters<typeof createWorkbenchControllerBase>
) => asLegacyWorkbenchController(createWorkbenchControllerBase(...args));

async function renderBottomStatusBar(
  controller: ReturnType<typeof createWorkbenchController>,
): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(BottomStatusBar, { controller }));
  });

  return {
    container,
    root,
  };
}

async function disposeBottomStatusBar(options: {
  controller: ReturnType<typeof createWorkbenchController>;
  root: Root;
}) {
  await act(async () => {
    options.root.unmount();
  });

  options.controller.dispose();
}

function getRightStatusChipTexts(container: HTMLDivElement): string[] {
  return Array.from(
    container.querySelectorAll(".status-bar-group-right .status-chip"),
  ).map((element) => element.textContent?.trim() ?? "");
}

describe("BottomStatusBar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows an authoring view badge, v2 copyright text, and current mode/tool summary", async () => {
    const controller = createWorkbenchController();
    const { container, root } = await renderBottomStatusBar(controller);

    expect(container.querySelectorAll(".status-chip")).toHaveLength(3);
    expect(container.querySelector(".status-chip-primary")?.textContent).toBe(
      "当前视图: 放置",
    );
    expect(container.querySelector(".status-bar-copyright")?.textContent).toBe(
      `© ${new Date().getFullYear()} 集成工业仿真`,
    );
    expect(getRightStatusChipTexts(container)).toEqual([
      "当前模式: 选择",
      "工具: 选择",
    ]);
    expect(container.textContent).not.toContain("编译版本");
    expect(container.textContent).not.toContain("Tick");
    expect(container.textContent).not.toContain("当前选中");

    await act(async () => {
      controller.setLeftPanelMode("blueprint");
    });

    expect(container.querySelector(".status-chip-primary")?.textContent).toBe(
      "当前视图: 蓝图",
    );

    await act(async () => {
      controller.armPlacement("belt_straight_1x1", "belt");
    });

    expect(container.querySelector(".status-chip-primary")?.textContent).toBe(
      "当前视图: 放置",
    );
    expect(getRightStatusChipTexts(container)).toEqual([
      "当前模式: 放置",
      "工具: 传送带",
    ]);

    await disposeBottomStatusBar({ controller, root });
  });
});