// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { TimelineDialog } from "@/app/shell/dialogs/timeline-dialog";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly button?: number;
    readonly buttons?: number;
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

function dispatchRangeInput(target: HTMLInputElement, value: number): Event {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(target, String(value));

  const event = new Event("input", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("TimelineDialog", () => {
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
    appHost?.dispose();
    container.remove();
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-theme");
    vi.unstubAllGlobals();
  });

  it("only seeks while the timeline playhead is being dragged", async () => {
    const seekTimelineToTick = vi.fn(async () => true);
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry: createRegistryContract(),
      app: null,
      editor: null,
      render: null,
      simulation: {
        state: {
          runningState: "pause",
          simulationSpeed: 1,
          statistics: {
            tickPerSecond: 0,
            targetTickPerSecond: 0,
            baseBatteryJoules: 0,
            baseBatteryCapacity: 0,
          },
          bufferSize: 501,
          timeline: {
            enabled: true,
            tickDurationSeconds: 0.5,
            rulerDurationSeconds: 300,
            windowStartTickNumber: 0,
            cursorTickNumber: 100,
            availableFromTickNumber: 0,
            availableToTickNumber: 500,
            marks: [],
            isSeeking: false,
          },
        },
        queries: {} as NonNullable<WorkspaceContract["simulation"]>["queries"],
        actions: {
          start: vi.fn(async () => {}),
          pause: vi.fn(),
          resume: vi.fn(),
          stop: vi.fn(),
          setSimulationSpeed: vi.fn(),
          advancePlaybackByDeltaMs: vi.fn(async () => {}),
          patchRuntimeSlot: vi.fn(async () => {}),
          resetAdmissionCounter: vi.fn(async () => {}),
          enableTimeline: vi.fn(async () => {}),
          disableTimeline: vi.fn(),
          seekTimelineToTick,
        },
      },
    };
    appHost = createAppHost(workspace);

    runInAction(() => {
      appHost?.internalActions.openDialog("timeline");
    });

    act(() => {
      root.render(<TimelineDialog appHost={appHost!} />);
    });

    const input = container.querySelector(".timeline-ruler-input") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe("100");

    act(() => {
      dispatchRangeInput(input!, 300);
    });

    expect(seekTimelineToTick).not.toHaveBeenCalled();
    expect(input?.value).toBe("100");

    await act(async () => {
      dispatchPointerEvent(input!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 1,
      });
      dispatchRangeInput(input!, 120);
      await Promise.resolve();
    });

    expect(seekTimelineToTick).toHaveBeenCalledTimes(1);
    expect(seekTimelineToTick).toHaveBeenLastCalledWith(120);

    act(() => {
      dispatchPointerEvent(input!, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        buttons: 0,
      });
    });
  });
});
