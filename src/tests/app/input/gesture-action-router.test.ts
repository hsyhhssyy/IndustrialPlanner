// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createGestureAdapter, type GestureEvent } from "@/app/input/gesture-adapter";
import {
  createGestureActionRouter,
  type GestureActionContext,
  type GestureHandleResult,
  type GestureMappingModule,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";

interface FakeAppHost {
  readonly id: string;
}

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

function createModule(
  options: {
    readonly id: string;
    readonly priority?: number;
    readonly when?: (context: GestureActionContext<FakeAppHost>) => boolean;
    readonly handle?: (
      event: GestureEvent,
      context: GestureActionContext<FakeAppHost>,
    ) => GestureHandleResult;
  },
): GestureMappingModule<FakeAppHost> {
  return {
    id: options.id,
    priority: options.priority,
    when: options.when,
    handle: options.handle ?? (() => ({ status: "ignored" })),
  };
}

function mouseTapEvent(gestureId = "tap-1"): GestureEvent {
  return {
    type: "mouse tap",
    gestureId,
    button: 0,
    buttons: 0,
    position: { x: 10, y: 12 },
    longPress: false,
    pointerEntity: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(gestureId = "drag-1"): GestureEvent {
  return {
    type: "mouse dragstart",
    gestureId,
    originButton: 0,
    button: 0,
    buttons: 1,
    position: { x: 4, y: 4 },
    startPosition: { x: 0, y: 0 },
    longPress: false,
    pointerEntity: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragMoveEvent(gestureId = "drag-1"): GestureEvent {
  return {
    type: "mouse dragmove",
    gestureId,
    originButton: 0,
    buttons: 1,
    position: { x: 8, y: 4 },
    delta: { x: 4, y: 0 },
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragEndEvent(gestureId = "drag-1"): GestureEvent {
  return {
    type: "mouse dragend",
    gestureId,
    originButton: 0,
    releaseButton: 0,
    button: 0,
    buttons: 0,
    position: { x: 8, y: 4 },
    reason: "release",
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

describe("GestureActionRouter", () => {
  it("uses when guards and priority order before consuming handled events", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const appHost: FakeAppHost = { id: "host" };
    const calls: string[] = [];

    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => appHost,
      modules: [
        createModule({
          id: "low",
          priority: 1,
          handle: () => {
            calls.push("low");
            return { status: "handled" };
          },
        }),
        createModule({
          id: "off",
          priority: 100,
          when: () => false,
          handle: () => {
            calls.push("off");
            return { status: "handled" };
          },
        }),
        createModule({
          id: "high",
          priority: 10,
          handle: () => {
            calls.push("high");
            return { status: "handled" };
          },
        }),
      ],
    });

    const result = router.handleGesture(mouseTapEvent());

    expect(calls).toEqual(["high"]);
    expect(result).toEqual({
      handledBy: ["high"],
      consumedBy: "high",
      claimedBy: null,
    });
  });

  it("allows non-exclusive modules to continue dispatch with consume false", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const calls: string[] = [];
    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
      modules: [
        createModule({
          id: "status-bar",
          priority: 20,
          handle: () => {
            calls.push("status-bar");
            return { status: "handled", consume: false };
          },
        }),
        createModule({
          id: "selection",
          priority: 10,
          handle: () => {
            calls.push("selection");
            return { status: "handled" };
          },
        }),
      ],
    });

    const result = router.handleGesture(mouseTapEvent());

    expect(calls).toEqual(["status-bar", "selection"]);
    expect(result).toEqual({
      handledBy: ["status-bar", "selection"],
      consumedBy: "selection",
      claimedBy: null,
    });
  });

  it("keeps dragmove and dragend routed to the module that claimed dragstart", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const claimedCalls: string[] = [];
    const fallbackCalls: string[] = [];
    let claimedModuleEnabled = true;
    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
      modules: [
        createModule({
          id: "claimed",
          priority: 20,
          when: () => claimedModuleEnabled,
          handle: (event) => {
            claimedCalls.push(event.type);
            if (event.type === "mouse dragstart") {
              return { status: "claimed" };
            }
            return { status: "handled" };
          },
        }),
        createModule({
          id: "fallback",
          priority: 10,
          handle: (event) => {
            fallbackCalls.push(event.type);
            return { status: "handled" };
          },
        }),
      ],
    });

    const startResult = router.handleGesture(mouseDragStartEvent());
    claimedModuleEnabled = false;
    const moveResult = router.handleGesture(mouseDragMoveEvent());
    const endResult = router.handleGesture(mouseDragEndEvent());

    expect(startResult.claimedBy).toBe("claimed");
    expect(moveResult.handledBy).toEqual(["claimed"]);
    expect(endResult.handledBy).toEqual(["claimed"]);
    expect(router.getDragClaimOwner("drag-1")).toBeNull();
    expect(claimedCalls).toEqual([
      "mouse dragstart",
      "mouse dragmove",
      "mouse dragend",
    ]);
    expect(fallbackCalls).toEqual([]);
  });

  it("passes workspace, appHost and keyboard snapshot through context", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const appHost: FakeAppHost = { id: "app-host" };
    const contextSpy = vi.fn();
    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => appHost,
      modules: [
        createModule({
          id: "context-reader",
          handle: (_event, context) => {
            contextSpy(context);
            return { status: "handled" };
          },
        }),
      ],
    });

    adapter.handleKeyDown({
      code: "ShiftLeft",
      key: "Shift",
      keyCode: 16,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    });
    router.handleGesture(mouseTapEvent());

    expect(contextSpy).toHaveBeenCalledTimes(2);
    const context = contextSpy.mock.calls[1]?.[0] as GestureActionContext<FakeAppHost>;
    expect(context.workspace).toBe(workspace);
    expect(context.appHost).toBe(appHost);
    expect(context.keyboard.pressedKeys.has("ShiftLeft")).toBe(true);
  });

  it("subscribes to adapter events and stops after dispose", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const calls: string[] = [];
    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
      modules: [
        createModule({
          id: "tap-module",
          handle: (event) => {
            calls.push(event.type);
            return { status: "handled" };
          },
        }),
      ],
    });

    adapter.handlePointerDown({
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 1,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    adapter.handlePointerUp({
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    router.dispose();
    adapter.handlePointerMove({
      pointerId: 2,
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
      button: -1,
      buttons: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(calls).toEqual(["mouse tap"]);
    expect(() => router.registerModule(createModule({ id: "late" }))).toThrow(
      "GestureActionRouter has been disposed.",
    );
  });

  it("forwards key and semantic ui button events from the adapter", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const received: Array<{ type: string; pressedShift: boolean; uiButtonId?: string }> = [];

    createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
      modules: [
        createModule({
          id: "observer",
          handle: (event, context) => {
            received.push({
              type: event.type,
              pressedShift: context.keyboard.pressedKeys.has("ShiftLeft"),
              uiButtonId: "uiButtonId" in event ? event.uiButtonId : undefined,
            });
            return { status: "handled", consume: false };
          },
        }),
      ],
    });

    adapter.handleKeyDown({
      code: "ShiftLeft",
      key: "Shift",
      keyCode: 16,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    });
    adapter.handleUiButtonMouseTap({
      uiButtonId: "utility-settings",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(received).toEqual([
      {
        type: "key down",
        pressedShift: true,
        uiButtonId: undefined,
      },
      {
        type: "ui-button-mouse-tap",
        pressedShift: true,
        uiButtonId: "utility-settings",
      },
    ]);
  });

  it("rejects duplicate module ids and supports unregistering modules", () => {
    const adapter = createGestureAdapter();
    const workspace = createWorkspace();
    const calls: string[] = [];
    const router = createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
    });

    const unregister = router.registerModule(
      createModule({
        id: "unique",
        handle: () => {
          calls.push("unique");
          return { status: "handled" };
        },
      }),
    );

    expect(() => router.registerModule(createModule({ id: "unique" }))).toThrow(
      'Gesture mapping module "unique" is already registered.',
    );

    unregister();
    router.handleGesture(mouseTapEvent());

    expect(calls).toEqual([]);
    expect(router.getRegisteredModuleIds()).toEqual([]);
  });
});
