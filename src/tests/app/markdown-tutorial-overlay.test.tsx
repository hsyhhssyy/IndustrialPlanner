// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownTutorialOverlay } from "@/app/shell/dialogs/markdown-tutorial-overlay";

const { fetchHelpTutorialPagesMock } = vi.hoisted(() => ({
  fetchHelpTutorialPagesMock: vi.fn(),
}));

vi.mock("@/app/shell/dialogs/help-markdown", () => ({
  MISSING_HELP_TUTORIAL_IMAGE_PATH: "/help/__missing-tutorial-image__.webp",
  fetchHelpTutorialPages: fetchHelpTutorialPagesMock,
}));

function dispatchPointerDown(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
}

function queryRequiredElement<TElement extends Element>(container: ParentNode, selector: string): TElement {
  const element = container.querySelector(selector);

  if (element === null) {
    throw new Error(`Expected element ${selector} to exist.`);
  }

  return element as TElement;
}

describe("MarkdownTutorialOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchHelpTutorialPagesMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderOverlay(onClose = vi.fn()) {
    fetchHelpTutorialPagesMock.mockResolvedValueOnce([
      {
        image: {
          src: "/help/tutorial-a.webp",
          alt: "教程图 A",
          title: null,
        },
        html: "<p>第一页说明</p>",
      },
      {
        image: null,
        html: "<p>第二页说明</p>",
      },
    ]);

    await act(async () => {
      root.render(
        <MarkdownTutorialOverlay
          dialogKey="settings-guide"
          durationMs={null}
          onClose={onClose}
          path="/help/test.md"
          title="测试教程"
          visible
        />,
      );
    });

    return onClose;
  }

  it("keeps the overlay open when pressing the image or page controls", async () => {
    const onClose = await renderOverlay();
    const image = queryRequiredElement<HTMLImageElement>(container, "img");
    const nextPageButton = queryRequiredElement<HTMLButtonElement>(container, "[aria-label='下一页']");

    dispatchPointerDown(image);
    expect(onClose).not.toHaveBeenCalled();

    dispatchPointerDown(nextPageButton);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      nextPageButton.click();
    });

    expect(container.textContent).toContain("第二页说明");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the overlay when pressing text or backdrop areas", async () => {
    const onClose = await renderOverlay();
    const markdownText = queryRequiredElement<HTMLParagraphElement>(
      container,
      ".markdown-tutorial-overlay-markdown p",
    );
    const backdrop = queryRequiredElement<HTMLDivElement>(container, ".markdown-tutorial-overlay-backdrop");

    dispatchPointerDown(markdownText);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    dispatchPointerDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
