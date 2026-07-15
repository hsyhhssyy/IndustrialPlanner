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

function dispatchPointerEvent(
  target: EventTarget,
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
  });
  target.dispatchEvent(event);
  return event;
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

  it("resizes dialog shells from Windows-style edges and corners", () => {
    const dialogState = createDialogState(true);

    runInAction(() => {
      dialogState.offsetX = 100;
      dialogState.offsetY = 80;
      dialogState.width = 400;
      dialogState.height = 300;
    });

    function Harness() {
      return (
        <OverlayStackProvider>
          <DialogShell
            {...createDialogShellProps("resizable-dialog", dialogState, () => undefined)}
            onOffsetChange={(offsetX, offsetY) => {
              runInAction(() => {
                dialogState.offsetX = offsetX;
                dialogState.offsetY = offsetY;
              });
            }}
            onResize={(width, height) => {
              runInAction(() => {
                dialogState.width = width;
                dialogState.height = height;
              });
            }}
          >
            resizable
          </DialogShell>
        </OverlayStackProvider>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    const dialog = container.querySelector<HTMLElement>("[data-dialog-key='resizable-dialog']");
    const northwestHandle = dialog?.querySelector<HTMLElement>(".dialog-shell-resize-edge--nw");

    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll(".dialog-shell-resize-edge")).toHaveLength(8);
    expect(dialog?.querySelector(".dialog-shell-resize-grip")).toBeNull();
    expect(northwestHandle).not.toBeNull();

    act(() => {
      dispatchPointerEvent(northwestHandle!, "pointerdown", {
        pointerId: 10,
        pointerType: "mouse",
        clientX: 200,
        clientY: 180,
        button: 0,
        buttons: 1,
      });
      dispatchPointerEvent(window, "pointermove", {
        pointerId: 10,
        pointerType: "mouse",
        clientX: 160,
        clientY: 150,
        buttons: 1,
      });
    });

    expect(document.body.classList.contains("is-resizing-dialog-shell")).toBe(true);
    expect(document.body.classList.contains("is-resizing-dialog-shell-nw")).toBe(true);
    expect(dialogState.width).toBe(440);
    expect(dialogState.height).toBe(330);
    expect(dialogState.offsetX).toBe(80);
    expect(dialogState.offsetY).toBe(65);
    expect(dialogState.offsetX + (dialogState.width ?? Number.NaN) / 2).toBe(300);
    expect(dialogState.offsetY + (dialogState.height ?? Number.NaN) / 2).toBe(230);

    act(() => {
      dispatchPointerEvent(window, "pointerup", {
        pointerId: 10,
        pointerType: "mouse",
        clientX: 160,
        clientY: 150,
        buttons: 0,
      });
    });

    expect(document.body.classList.contains("is-resizing-dialog-shell")).toBe(false);
    expect(document.body.classList.contains("is-resizing-dialog-shell-nw")).toBe(false);
  });

  it("keeps height fixed when a dialog shell only allows width resizing", () => {
    const dialogState = createDialogState(true);

    runInAction(() => {
      dialogState.offsetX = 20;
      dialogState.offsetY = 10;
      dialogState.width = 360;
      dialogState.height = 260;
    });

    function Harness() {
      return (
        <OverlayStackProvider>
          <DialogShell
            {...createDialogShellProps("width-only-dialog", dialogState, () => undefined)}
            onOffsetChange={(offsetX, offsetY) => {
              runInAction(() => {
                dialogState.offsetX = offsetX;
                dialogState.offsetY = offsetY;
              });
            }}
            onResize={(width) => {
              runInAction(() => {
                dialogState.width = width;
              });
            }}
            resizableHeight={false}
          >
            width only
          </DialogShell>
        </OverlayStackProvider>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    const dialog = container.querySelector<HTMLElement>("[data-dialog-key='width-only-dialog']");
    const northwestHandle = dialog?.querySelector<HTMLElement>(".dialog-shell-resize-edge--nw");

    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll(".dialog-shell-resize-edge")).toHaveLength(6);
    expect(dialog?.querySelector(".dialog-shell-resize-edge--e")).not.toBeNull();
    expect(dialog?.querySelector(".dialog-shell-resize-edge--w")).not.toBeNull();
    expect(northwestHandle).not.toBeNull();
    expect(dialog?.querySelector(".dialog-shell-resize-edge--s")).toBeNull();
    expect(dialog?.querySelector(".dialog-shell-resize-edge--n")).toBeNull();
    expect(dialog?.querySelector(".dialog-shell-resize-edge--se")).not.toBeNull();

    act(() => {
      dispatchPointerEvent(northwestHandle!, "pointerdown", {
        pointerId: 11,
        pointerType: "mouse",
        clientX: 120,
        clientY: 120,
        button: 0,
        buttons: 1,
      });
      dispatchPointerEvent(window, "pointermove", {
        pointerId: 11,
        pointerType: "mouse",
        clientX: 90,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(window, "pointerup", {
        pointerId: 11,
        pointerType: "mouse",
        clientX: 90,
        clientY: 180,
        buttons: 0,
      });
    });

    expect(dialogState.width).toBe(390);
    expect(dialogState.height).toBe(260);
    expect(dialogState.offsetX).toBe(5);
    expect(dialogState.offsetY).toBe(10);
    expect(dialogState.offsetX + (dialogState.width ?? Number.NaN) / 2).toBe(200);
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
