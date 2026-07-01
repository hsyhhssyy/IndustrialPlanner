// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeAutoObservable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  OverlayStackLayer,
  OverlayStackProvider,
} from "@/app/shell/shared/overlay-stack";

function createDialogState(visible = true): DialogStateReadWrite {
  return makeAutoObservable<DialogStateReadWrite>({
    visible,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  });
}

function createDialogShellProps(
  dialogKey: string,
  dialogState: DialogStateReadWrite,
  onClose: () => void,
) {
  return {
    closeTitle: "关闭",
    dialogKey,
    dialogState,
    maximizeTitle: "最大化",
    onClose,
    onToggleMaximized: () => undefined,
    restoreTitle: "还原",
    title: dialogKey,
    titleId: `${dialogKey}-title`,
  };
}

function getBackdropZIndex(container: ParentNode, dialogKey: string): number {
  const dialog = container.querySelector(`[data-dialog-key="${dialogKey}"]`);
  const backdrop = dialog?.closest<HTMLElement>(".dialog-shell-backdrop, [data-test-overlay-backdrop]");

  if (backdrop === null || backdrop === undefined) {
    throw new Error(`Expected backdrop for ${dialogKey}.`);
  }

  return Number(backdrop.style.zIndex);
}

describe("OverlayStack", () => {
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

  it("places later dialog layers above earlier dialog layers and closes only the top layer on Escape", () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();

    function Harness() {
      const parentState = useMemo(() => createDialogState(true), []);
      const childState = useMemo(() => createDialogState(false), []);

      return (
        <OverlayStackProvider>
          <DialogShell
            {...createDialogShellProps("parent-dialog", parentState, () => {
              parentClose();
              runInAction(() => {
                parentState.visible = false;
              });
            })}
          >
            <button
              data-test-open-child
              onClick={() => {
                runInAction(() => {
                  childState.visible = true;
                });
              }}
              type="button"
            >
              open child
            </button>
          </DialogShell>
          <DialogShell
            {...createDialogShellProps("child-dialog", childState, () => {
              childClose();
              runInAction(() => {
                childState.visible = false;
              });
            })}
          >
            child
          </DialogShell>
        </OverlayStackProvider>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-test-open-child]")?.click();
    });

    expect(getBackdropZIndex(container, "child-dialog")).toBeGreaterThan(
      getBackdropZIndex(container, "parent-dialog"),
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
    expect(container.querySelector("[data-dialog-key='parent-dialog']")).not.toBeNull();
    expect(container.querySelector("[data-dialog-key='child-dialog']")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(parentClose).toHaveBeenCalledTimes(1);
  });

  it("places a picker dialog above a local business modal opened from the same stack", () => {
    function Harness() {
      const pickerState = useMemo(() => createDialogState(false), []);

      return (
        <OverlayStackProvider>
          <OverlayStackLayer layerId="local-editor" visible>
            {({ zIndex }) => (
              <div data-test-overlay-backdrop style={{ zIndex }}>
                <section data-dialog-key="local-editor" role="dialog">
                  <button
                    data-test-open-picker
                    onClick={() => {
                      runInAction(() => {
                        pickerState.visible = true;
                      });
                    }}
                    type="button"
                  >
                    open picker
                  </button>
                </section>
              </div>
            )}
          </OverlayStackLayer>
          <DialogShell
            {...createDialogShellProps("picker-dialog", pickerState, () => {
              runInAction(() => {
                pickerState.visible = false;
              });
            })}
          >
            picker
          </DialogShell>
        </OverlayStackProvider>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-test-open-picker]")?.click();
    });

    expect(getBackdropZIndex(container, "picker-dialog")).toBeGreaterThan(
      getBackdropZIndex(container, "local-editor"),
    );
  });

  it("keeps compact mobile dialog shells on their default size without drag, resize, or maximize controls", () => {
    const offsetChange = vi.fn();
    const resize = vi.fn();

    function Harness() {
      const dialogState = useMemo(() => {
        const state = createDialogState(true);

        runInAction(() => {
          state.maximized = true;
          state.offsetX = 96;
          state.offsetY = 48;
          state.width = 360;
          state.height = 260;
        });

        return state;
      }, []);

      return (
        <OverlayStackProvider>
          <DialogShell
            {...createDialogShellProps("mobile-fixed-dialog", dialogState, () => undefined)}
            compactMobileLayout
            onOffsetChange={offsetChange}
            onResize={resize}
            showMaximizeButton
          >
            mobile fixed
          </DialogShell>
        </OverlayStackProvider>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    const dialog = container.querySelector<HTMLElement>("[data-dialog-key='mobile-fixed-dialog']");
    const header = dialog?.querySelector<HTMLElement>(".dialog-shell-header");

    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains("is-mobile-fixed")).toBe(true);
    expect(dialog?.classList.contains("is-maximized")).toBe(false);
    expect(dialog?.style.transform).toBe("");
    expect(dialog?.style.width).toBe("");
    expect(dialog?.style.height).toBe("");
    expect(header?.classList.contains("is-draggable")).toBe(false);
    expect(dialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(dialog?.querySelector('button[title="最大化"]')).toBeNull();
  });
});
