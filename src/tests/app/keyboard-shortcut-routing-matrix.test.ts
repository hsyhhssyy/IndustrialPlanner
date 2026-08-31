// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  APP_SHORTCUTS_STORAGE_VERSION,
  CONFIGURABLE_SHORTCUT_ACTION_SPECS,
  SHORTCUT_ACTION_SPECS,
  SHORTCUT_KEY,
  parseShortcutBinding,
} from "@/app/actions/keyboard-shortcut-manager";
import { createAppHost, type AppHost } from "@/app/host/app-host";
import type { KeyboardGestureEvent, ShortcutActionRoute } from "@/app/input/gesture/actions";
import { doesShortcutRouteMatchKeyboardEvent } from "@/app/input/gesture/actions/shortcut-route-matching";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";

describe("keyboard shortcut real-route matrix", () => {
  const appHosts: AppHost[] = [];

  afterEach(() => {
    while (appHosts.length > 0) {
      appHosts.pop()?.dispose();
    }
    localStorage.clear();
  });

  it("covers every configurable and fixed ActionSpec with executable routes", () => {
    const appHost = createTrackedAppHost(appHosts);
    const routes = appHost.gestureActionRouter.getRegisteredShortcutRoutes();
    const routedActionIds = new Set(routes.map((route) => route.actionId));

    expect(() => appHost.gestureActionRouter.assertShortcutRouteIntegrity()).not.toThrow();
    expect(Array.from(routedActionIds).sort()).toEqual(
      SHORTCUT_ACTION_SPECS.map((spec) => spec.id).sort(),
    );
  });

  it("matches every default slot on every real route", () => {
    const appHost = createTrackedAppHost(appHosts);
    const actionSpecById = new Map(SHORTCUT_ACTION_SPECS.map((spec) => [spec.id, spec]));

    for (const route of appHost.gestureActionRouter.getRegisteredShortcutRoutes()) {
      const spec = actionSpecById.get(route.actionId);
      expect(spec, route.id).toBeDefined();
      expect(route.scope.inputLayers.length, route.id).toBeGreaterThan(0);
      expect(route.scope.activeTools.length, route.id).toBeGreaterThan(0);

      for (const binding of spec?.defaultBindings ?? []) {
        if (binding === undefined) {
          continue;
        }
        expect(doesShortcutRouteMatchKeyboardEvent({
          binding,
          triggerPolicy: route.triggerPolicy,
          event: createKeyboardEvent(binding, route),
        }), `${route.id} should match ${binding}`).toBe(true);
      }
    }
  });

  it("keeps the core R, Ctrl+R, G and Ctrl+V scope relationships explicit", () => {
    const appHost = createTrackedAppHost(appHosts);
    const routes = appHost.gestureActionRouter.getRegisteredShortcutRoutes();

    expect(collectCanvasTools(routes, SHORTCUT_KEY.ROTATE)).toEqual([
      "blueprint-placement",
      "logistics-placement",
      "move",
      "single-placement",
    ]);
    expect(collectCanvasTools(routes, SHORTCUT_KEY.ROTATE_VIEWPORT)).toEqual([
      "dark-pipe-link",
      "marquee",
      "select",
    ]);
    expect(collectCanvasTools(routes, SHORTCUT_KEY.RESOURCES_POWER)).toEqual(["select"]);
    expect(collectCanvasTools(routes, SHORTCUT_KEY.PASTE_SELECTION)).toEqual([
      "blueprint-placement",
      "dark-pipe-link",
      "logistics-placement",
      "marquee",
      "move",
      "select",
      "single-placement",
    ]);
  });

  it("accepts both safe duplicate examples without clearing either action", () => {
    persistShortcuts({
      [SHORTCUT_KEY.ROTATE]: "G",
      [SHORTCUT_KEY.RESOURCES_POWER]: "G",
    });
    const appHost = createTrackedAppHost(appHosts);

    expect(appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.ROTATE)).toBe("G");
    expect(appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.RESOURCES_POWER)).toBe("G");
    expect(appHost.gestureActionRouter.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.ROTATE,
      slotIndex: 0,
      nextBinding: "G",
    })).toEqual([]);
    expect(appHost.gestureActionRouter.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT,
      slotIndex: 0,
      nextBinding: "Ctrl+R",
    })).toEqual([]);
  });

  it("explains why changing current-operation rotation to V really conflicts with Ctrl+V", () => {
    const appHost = createTrackedAppHost(appHosts);

    expect(appHost.gestureActionRouter.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.ROTATE,
      slotIndex: 0,
      nextBinding: "V",
    })).toEqual([
      expect.objectContaining({
        actionId: SHORTCUT_KEY.PASTE_SELECTION,
        binding: "Ctrl+V",
        kind: "configurable",
        overlappingInputLayers: ["canvas"],
        overlappingActiveTools: expect.arrayContaining([
          "blueprint-placement",
          "logistics-placement",
          "move",
          "single-placement",
        ]),
      }),
    ]);
  });

  it("loads an existing hard conflict without invalidating either stored action", () => {
    persistShortcuts({
      [SHORTCUT_KEY.DELETE_DEVICE]: "F",
      [SHORTCUT_KEY.PASTE_SELECTION]: "Ctrl+F",
    });
    const appHost = createTrackedAppHost(appHosts);

    expect(appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.DELETE_DEVICE)).toBe("F");
    expect(appHost.internalActions.getKeyboardShortcutFor(SHORTCUT_KEY.PASTE_SELECTION)).toBe("Ctrl+F");
    expect(appHost.gestureActionRouter.findShortcutConflicts({
      shortcutId: SHORTCUT_KEY.DELETE_DEVICE,
      slotIndex: 0,
      nextBinding: "F",
    })).toEqual([
      expect.objectContaining({
        actionId: SHORTCUT_KEY.PASTE_SELECTION,
        binding: "Ctrl+F",
        overlappingActiveTools: expect.arrayContaining(["move"]),
      }),
    ]);
  });

  it("keeps every shipped default free of actionable conflicts", () => {
    const appHost = createTrackedAppHost(appHosts);

    for (const spec of CONFIGURABLE_SHORTCUT_ACTION_SPECS) {
      spec.defaultBindings.forEach((binding, slotIndex) => {
        if (binding === undefined) {
          return;
        }
        expect(appHost.gestureActionRouter.findShortcutConflicts({
          shortcutId: spec.id,
          slotIndex: slotIndex as 0 | 1,
          nextBinding: binding,
        }), `${spec.id} ${binding}`).toEqual([]);
      });
    }
  });
});

function createTrackedAppHost(appHosts: AppHost[]): AppHost {
  const appHost = createAppHost(createWorkspace());
  appHosts.push(appHost);
  return appHost;
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

function persistShortcuts(shortcuts: Readonly<Partial<Record<string, string>>>): void {
  localStorage.setItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY, JSON.stringify({
    _v: APP_SHORTCUTS_STORAGE_VERSION,
    data: shortcuts,
  }));
}

function collectCanvasTools(
  routes: readonly ShortcutActionRoute<AppHost>[],
  actionId: string,
): string[] {
  return Array.from(new Set(
    routes
      .filter((route) => route.actionId === actionId && route.scope.inputLayers.includes("canvas"))
      .flatMap((route) => route.scope.activeTools),
  )).sort();
}

function createKeyboardEvent(
  binding: string,
  route: ShortcutActionRoute<AppHost>,
): KeyboardGestureEvent {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) {
    throw new Error(`Cannot create keyboard event from ${binding}`);
  }

  const primary = parsed.primaryKey;
  const modifierPrimary = primary === "ctrl"
    || primary === "shift"
    || primary === "alt"
    || primary === "meta";
  const modifiers = {
    ...parsed.modifiers,
    ...(modifierPrimary ? { [primary]: true } : {}),
  };
  const { code, key } = resolveKeyboardIdentity(primary);

  return {
    type: route.events?.[0] ?? "key down",
    gestureId: `default-${route.id}-${binding}`,
    code,
    key,
    keyCode: null,
    modifiers,
    sourceEvent: null,
  };
}

function resolveKeyboardIdentity(primary: string): { code: string; key: string } {
  if (primary.length === 1 && primary >= "a" && primary <= "z") {
    return { code: `Key${primary.toUpperCase()}`, key: primary };
  }
  if (primary.length === 1 && primary >= "0" && primary <= "9") {
    return { code: `Digit${primary}`, key: primary };
  }

  const identityByPrimary: Readonly<Record<string, { code: string; key: string }>> = {
    alt: { code: "AltLeft", key: "Alt" },
    arrowdown: { code: "ArrowDown", key: "ArrowDown" },
    arrowleft: { code: "ArrowLeft", key: "ArrowLeft" },
    arrowright: { code: "ArrowRight", key: "ArrowRight" },
    arrowup: { code: "ArrowUp", key: "ArrowUp" },
    ctrl: { code: "ControlLeft", key: "Control" },
    enter: { code: "Enter", key: "Enter" },
    esc: { code: "Escape", key: "Escape" },
    meta: { code: "MetaLeft", key: "Meta" },
    shift: { code: "ShiftLeft", key: "Shift" },
    tab: { code: "Tab", key: "Tab" },
  };
  const identity = identityByPrimary[primary];
  if (identity === undefined) {
    throw new Error(`Missing keyboard identity for ${primary}`);
  }
  return identity;
}
