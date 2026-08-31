import { observable } from "mobx";

import {
  CONFIGURABLE_SHORTCUT_ACTION_SPECS,
  type ShortcutKeyId,
} from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import { createGestureAdapter } from "@/app/input/gesture/adapter";
import {
  createGestureActionRouter,
  type GestureActionContext,
  type GestureHandleResult,
  type GestureMappingModule,
  type KeyboardGestureEvent,
  type ShortcutInputLayer,
} from "@/app/input/gesture/actions";
import type { ActiveTool } from "@/domain/app";

const DEFAULT_SHORTCUT_BINDINGS = new Map<ShortcutKeyId, string>(
  CONFIGURABLE_SHORTCUT_ACTION_SPECS.map((spec) => [spec.id, spec.defaultBindings.join(";")]),
);

export function handleKeyboardShortcutThroughRouter(options: {
  readonly module: GestureMappingModule<AppHost>;
  readonly context: GestureActionContext<AppHost>;
  readonly event: KeyboardGestureEvent;
  readonly activeTool?: ActiveTool;
  readonly inputLayer?: ShortcutInputLayer;
  readonly shortcutBindings?: Readonly<Partial<Record<ShortcutKeyId, string>>>;
}): GestureHandleResult {
  const activeTool = options.activeTool ?? (
    options.context.appHost as { readonly internalState?: { readonly activeTool?: ActiveTool } }
  ).internalState?.activeTool ?? "select";
  const adapter = createGestureAdapter({
    workspace: { editor: null },
    internalState: observable({ activeTool }),
  });
  let capturedResult: GestureHandleResult = { status: "ignored" };
  const observedModule: GestureMappingModule<AppHost> = {
    ...options.module,
    shortcutRoutes: options.module.shortcutRoutes?.map((route) => ({
      ...route,
      handle(event, context) {
        capturedResult = route.handle(event, context);
        return capturedResult;
      },
    })),
    handle(event, context) {
      capturedResult = options.module.handle(event, context);
      return capturedResult;
    },
  };
  const getHostShortcutBinding = (
    options.context.appHost.internalActions as {
      readonly getKeyboardShortcutFor?: (shortcutId: string) => string;
    }
  ).getKeyboardShortcutFor;
  const router = createGestureActionRouter({
    gestureAdapter: adapter,
    workspace: options.context.workspace,
    getAppHost: () => options.context.appHost,
    getShortcutBinding: (shortcutId) => {
      const override = options.shortcutBindings?.[shortcutId];
      if (override !== undefined) return override;
      if (getHostShortcutBinding !== undefined) return getHostShortcutBinding(shortcutId);
      return DEFAULT_SHORTCUT_BINDINGS.get(shortcutId) ?? "";
    },
    getShortcutInputLayer: () => options.inputLayer ?? "canvas",
    getActiveTool: () => activeTool,
    modules: [observedModule],
  });

  const keyboardEvent = {
    code: options.event.code ?? "",
    key: options.event.key ?? "",
    keyCode: options.event.keyCode ?? 0,
    altKey: options.event.modifiers.alt,
    ctrlKey: options.event.modifiers.ctrl,
    metaKey: options.event.modifiers.meta,
    shiftKey: options.event.modifiers.shift,
  };
  if (options.event.type === "key down") {
    adapter.handleKeyDown(keyboardEvent);
  } else {
    adapter.handleKeyUp(keyboardEvent);
  }

  router.dispose();
  adapter.dispose();
  return capturedResult;
}
