// AI-REMOVED 2026-11-12:
// Reason: 旧输入测试伪造 Editor/App 及已退出的 viewport，不能覆盖真实会话。
// Trigger: REQ-048 相机和 Canvas 契约迁移。
// Evidence: 当前业务通过独立 view 投影，Editor 查询必须来自真实文档。
// Replacement: 真实 Canvas state
// Risk: 真正布局与原生触控另由浏览器验证。
// Human Review: Required
// Original code:
// import { observable } from "mobx";

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
// AI-REMOVED 2026-11-12:
// Reason: 旧输入测试伪造 Editor/App 及已退出的 viewport，不能覆盖真实会话。
// Trigger: REQ-048 相机和 Canvas 契约迁移。
// Evidence: 当前业务通过独立 view 投影，Editor 查询必须来自真实文档。
// Replacement: options.context.canvas
// Risk: 真正布局与原生触控另由浏览器验证。
// Human Review: Required
// Original code:
//   const activeTool = options.activeTool ?? (
//     options.context.appHost as { readonly internalState?: { readonly activeTool?: ActiveTool } }
//   ).internalState?.activeTool ?? "select";
//   const adapter = createGestureAdapter({
//     workspace: { editor: null },
//     internalState: observable({ activeTool }),
//   });
  const activeTool = options.activeTool ?? options.context.canvas.state.activeTool;
  const adapter = createGestureAdapter(options.context.canvas);
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
    getCanvas: () => options.context.canvas,
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
