// @vitest-environment jsdom

import { observable, runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";

import { createGestureAdapter, type GestureEvent } from "@/app/input/gesture/adapter";
import {
  createGestureActionRouter,
  type GestureActionContext,
  type GestureHandleResult,
  type GestureMappingModule,
  type ShortcutActionRoute,
} from "@/app/input/gesture/actions";
import { SHORTCUT_KEY } from "@/app/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { ActiveTool } from "@/domain/app/types/app-types";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";

interface FakeAppHost {
  readonly id: string;
}

function createAdapterHost(activeTool: ActiveTool = "select") {
  return {
    workspace: {
      editor: null,
    },
    internalState: observable({
      activeTool,
    }),
  };
}

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

function createModule(
  options: {
    readonly id: string;
    readonly priority?: number;
    readonly when?: (context: GestureActionContext<FakeAppHost>) => boolean;
    readonly shortcutRoutes?: readonly ShortcutActionRoute<FakeAppHost>[];
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
    shortcutRoutes: options.shortcutRoutes,
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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
    const adapter = createGestureAdapter(createAdapterHost());
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

  it("dispatches active tool exit before enter and blocks later handlers once one is not ignored", () => {
    const adapterHost = createAdapterHost();
    const adapter = createGestureAdapter(adapterHost);
    const workspace = createWorkspace();
    const calls: string[] = [];

    createGestureActionRouter({
      gestureAdapter: adapter,
      workspace,
      getAppHost: () => ({ id: "host" }),
      modules: [
        createModule({
          id: "exit-first",
          priority: 40,
          handle: (event) => {
            if (event.type !== "on-exit-active-tool") {
              return { status: "ignored" };
            }

            calls.push("exit-first");
            return { status: "handled", consume: false };
          },
        }),
        createModule({
          id: "exit-second",
          priority: 30,
          handle: (event) => {
            if (event.type !== "on-exit-active-tool") {
              return { status: "ignored" };
            }

            calls.push("exit-second");
            return { status: "handled" };
          },
        }),
        createModule({
          id: "enter-first",
          priority: 20,
          handle: (event) => {
            if (event.type !== "on-enter-active-tool") {
              return { status: "ignored" };
            }

            calls.push("enter-first");
            return { status: "handled", consume: false };
          },
        }),
        createModule({
          id: "enter-second",
          priority: 10,
          handle: (event) => {
            if (event.type !== "on-enter-active-tool") {
              return { status: "ignored" };
            }

            calls.push("enter-second");
            return { status: "handled" };
          },
        }),
      ],
    });

    runInAction(() => {
      adapterHost.internalState.activeTool = "move";
    });

    expect(calls).toEqual(["exit-first", "enter-first"]);
  });

  it("executes configurable routes from the current executable scope", () => {
    const adapterHost = createAdapterHost("move");
    const adapter = createGestureAdapter(adapterHost);
    const handleRotate = vi.fn(() => ({ status: "handled" } as const));

    createGestureActionRouter({
      gestureAdapter: adapter,
      workspace: createWorkspace(),
      getAppHost: () => ({ id: "host" }),
      getShortcutBinding: (shortcutId) => (
        shortcutId === SHORTCUT_KEY.ROTATE ? "R" : ""
      ),
      getShortcutInputLayer: () => "canvas",
      getActiveTool: () => adapterHost.internalState.activeTool,
      modules: [
        createModule({
          id: "move-rotate",
          shortcutRoutes: [
            {
              id: "move.rotate",
              actionId: SHORTCUT_KEY.ROTATE,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.ROTATE,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["move"],
              },
              triggerPolicy: { kind: "allow-any-additional-modifiers" },
              handle: handleRotate,
            },
          ],
        }),
      ],
    });

    const handled = adapter.handleKeyDown({
      code: "KeyR",
      key: "r",
      keyCode: 82,
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    });

    expect(handled).toBe(true);
    expect(handleRotate).toHaveBeenCalledTimes(1);
  });

  it("allows R and Ctrl+R when their executable scopes do not intersect", () => {
    const bindings = new Map<string, string>([
      [SHORTCUT_KEY.ROTATE, "R"],
      [SHORTCUT_KEY.ROTATE_VIEWPORT, "Ctrl+R"],
    ]);
    const router = createGestureActionRouter({
      gestureAdapter: createGestureAdapter(createAdapterHost()),
      workspace: createWorkspace(),
      getAppHost: () => ({ id: "host" }),
      getShortcutBinding: (shortcutId) => bindings.get(shortcutId) ?? "",
      getShortcutInputLayer: () => "canvas",
      getActiveTool: () => "select",
      modules: [
        createModule({
          id: "rotation-routes",
          shortcutRoutes: [
            {
              id: "move.rotate",
              actionId: SHORTCUT_KEY.ROTATE,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.ROTATE,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["move"],
              },
              triggerPolicy: { kind: "allow-any-additional-modifiers" },
              handle: () => ({ status: "handled" }),
            },
            {
              id: "selection.rotate-viewport",
              actionId: SHORTCUT_KEY.ROTATE_VIEWPORT,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["select"],
              },
              triggerPolicy: { kind: "exact" },
              handle: () => ({ status: "handled" }),
            },
          ],
        }),
      ],
    });

    expect(router.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT,
      slotIndex: 0,
      nextBinding: "Ctrl+R",
    })).toEqual([]);
  });

  it("reports trigger overlap only when executable scopes intersect", () => {
    const bindings = new Map<string, string>([
      [SHORTCUT_KEY.DELETE_DEVICE, "F"],
      [SHORTCUT_KEY.ROTATE_VIEWPORT, "Ctrl+F"],
    ]);
    const router = createGestureActionRouter({
      gestureAdapter: createGestureAdapter(createAdapterHost()),
      workspace: createWorkspace(),
      getAppHost: () => ({ id: "host" }),
      getShortcutBinding: (shortcutId) => bindings.get(shortcutId) ?? "",
      getShortcutInputLayer: () => "canvas",
      getActiveTool: () => "move",
      modules: [
        createModule({
          id: "overlapping-routes",
          shortcutRoutes: [
            {
              id: "move.delete-device",
              actionId: SHORTCUT_KEY.DELETE_DEVICE,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.DELETE_DEVICE,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["move"],
              },
              triggerPolicy: { kind: "allow-any-additional-modifiers" },
              handle: () => ({ status: "handled" }),
            },
            {
              id: "move.other-operation",
              actionId: SHORTCUT_KEY.ROTATE_VIEWPORT,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["move"],
              },
              triggerPolicy: { kind: "exact" },
              handle: () => ({ status: "handled" }),
            },
          ],
        }),
      ],
    });

    expect(router.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.DELETE_DEVICE,
      slotIndex: 0,
      nextBinding: "F",
    })).toEqual([
      expect.objectContaining({
        kind: "configurable",
        shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT,
        slotIndex: 0,
        binding: "Ctrl+F",
      }),
    ]);
  });

  it("reports fixed routes as non-replaceable conflicts", () => {
    const router = createGestureActionRouter({
      gestureAdapter: createGestureAdapter(createAdapterHost()),
      workspace: createWorkspace(),
      getAppHost: () => ({ id: "host" }),
      getShortcutBinding: (shortcutId) => (
        shortcutId === SHORTCUT_KEY.QUICK_PLACE ? "Z" : ""
      ),
      getShortcutInputLayer: () => "canvas",
      getActiveTool: () => "select",
      modules: [
        createModule({
          id: "fixed-conflict-routes",
          shortcutRoutes: [
            {
              id: "quick-place.open",
              actionId: SHORTCUT_KEY.QUICK_PLACE,
              binding: {
                kind: "configurable",
                shortcutId: SHORTCUT_KEY.QUICK_PLACE,
              },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["select"],
              },
              triggerPolicy: { kind: "exact" },
              handle: () => ({ status: "handled" }),
            },
            {
              id: "placement-device.0",
              actionId: "fixed.placement-device.0",
              binding: { kind: "fixed", value: "1" },
              scope: {
                inputLayers: ["canvas"],
                activeTools: ["select"],
              },
              triggerPolicy: { kind: "exact" },
              handle: () => ({ status: "handled" }),
            },
          ],
        }),
      ],
    });

    expect(router.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.QUICK_PLACE,
      slotIndex: 0,
      nextBinding: "1",
    })).toEqual([
      expect.objectContaining({
        kind: "fixed",
        actionId: "fixed.placement-device.0",
        binding: "1",
      }),
    ]);
  });
});
