// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";

describe("InspectorCollapsiblePanel", () => {
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
    vi.unstubAllGlobals();
  });

  function renderPanel(onHeaderAction = vi.fn()) {
    act(() => {
      root.render(
        <InspectorCollapsiblePanel
          dataInspectorKey="slot-config"
          headerActions={(
            <button data-header-action onClick={onHeaderAction} type="button">
              编辑模式
            </button>
          )}
          title="槽位配置"
        >
          <div data-panel-body>正文</div>
        </InspectorCollapsiblePanel>,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
    const action = container.querySelector<HTMLButtonElement>("[data-header-action]");

    if (toggle === null || action === null) {
      throw new Error("InspectorCollapsiblePanel did not render expected header buttons.");
    }

    return { action, onHeaderAction, toggle };
  }

  it("renders the expand arrow before the title and collapses from the title button", () => {
    const { toggle } = renderPanel();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(toggle.textContent).toBe("槽位配置");
    expect(container.querySelector("[data-panel-body]")).not.toBeNull();

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-panel-body]")).toBeNull();
  });

  it("does not collapse when a header action control is clicked", () => {
    const onHeaderAction = vi.fn();
    const { action, toggle } = renderPanel(onHeaderAction);

    act(() => {
      action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onHeaderAction).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-panel-body]")).not.toBeNull();
  });
});
