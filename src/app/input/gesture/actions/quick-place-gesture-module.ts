import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { runInAction } from "mobx";
import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import {
  QUICK_PLACE_SLOT_SHORTCUTS,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  normalizeQuickPlaceFavorites,
  triggerQuickPlaceDeviceSelection,
} from "@/app/quick-place";
import type {
  GestureActionContext,
  GestureMappingModule,
  KeyboardGestureEvent,
  ShortcutActionRoute,
} from "./types";
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "./shortcut-route-matching";

export function createQuickPlaceGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "quick-place-shortcut",
    shortcutRoutes: [
      {
        id: "quick-place.close",
        actionId: "fixed.quick-place.close",
        binding: { kind: "fixed", value: "Esc" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(_event, context) {
          closeQuickPlace(context.appHost);
          return { status: "handled", consume: true };
        },
      },
      {
        id: "quick-place.open",
        actionId: SHORTCUT_KEY.QUICK_PLACE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.QUICK_PLACE },
        scope: { inputLayers: ["canvas"], activeTools: ["select"] },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          return tryOpenQuickPlaceAt(context, lastMousePosition, "keyboard-shortcut")
            ? { status: "handled", consume: true }
            : { status: "ignored" };
        },
      },
      ...QUICK_PLACE_SLOT_SHORTCUTS.map<ShortcutActionRoute<AppHost>>((shortcut, shortcutIndex) => ({
        id: `quick-place.favorite-${shortcutIndex}`,
        actionId: `fixed.quick-place.favorite-${shortcutIndex}`,
        binding: { kind: "fixed" as const, value: shortcut },
        scope: { inputLayers: ["quick-place"] as const, activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" as const },
        handle: (event, context) => selectQuickPlaceFavorite(context, shortcutIndex, event),
      })),
      {
        id: "quick-place.result-next",
        actionId: "fixed.quick-place.result-next",
        binding: { kind: "fixed", value: "ArrowDown" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return moveQuickPlaceActiveResult(context, event, 1);
        },
      },
      {
        id: "quick-place.result-previous",
        actionId: "fixed.quick-place.result-previous",
        binding: { kind: "fixed", value: "ArrowUp" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return moveQuickPlaceActiveResult(context, event, -1);
        },
      },
      {
        id: "quick-place.confirm",
        actionId: "fixed.quick-place.confirm",
        binding: { kind: "fixed", value: "Enter" },
        scope: { inputLayers: ["quick-place"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        handle(event, context) {
          return confirmQuickPlaceActiveResult(context, event);
        },
      },
    ],
    handle(event, context) {
      if (event.type === "mouse move") {
        lastMousePosition = event.position;
        return { status: "ignored" };
      }

      if (event.type === "on-exit-active-tool") {
        if (context.appHost.internalState.runtime.quickPlace.visible) {
          closeQuickPlace(context.appHost);
          return { status: "handled" };
        }

        return { status: "ignored" };
      }

      if (event.type === "mouse double tap" || event.type === "touch double tap") {
        if (
          event.pointerEntity !== null
          || event.longPress
          || hasActiveModifier(event.modifiers)
          || (event.type === "mouse double tap" && event.button !== 0)
        ) {
          return { status: "ignored" };
        }

        if (tryOpenQuickPlaceAt(context, event.position, "pointer")) {
          return { status: "handled", consume: true };
        }

        return { status: "ignored" };
      }

      // AI-REMOVED 2026-08-30:
      // Reason: 快速放置的打开与关闭按键已迁入同模块的输入层 Shortcut Route。
      // Trigger: ST2-RQ-020 要求快速放置层和画布层的同键复用可分析。
      // Evidence: quick-place.open 与 quick-place.close 分别声明 canvas/select 和 quick-place 作用域。
      // Replacement: shortcutRoutes in createQuickPlaceGestureModule
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (event.type !== "key down") return { status: "ignored" };
      // if (context.appHost.internalState.runtime.quickPlace.visible && event.code === "Escape") {
      //   closeQuickPlace(context.appHost);
      //   return { status: "handled", consume: true };
      // }
      // const matches = context.appHost.internalActions.isShortcutFor(
      //   SHORTCUT_KEY.QUICK_PLACE, event.code, event.key, event.modifiers,
      // );
      // if (!matches) return { status: "ignored" };
      // if (!tryOpenQuickPlaceAt(context, lastMousePosition, "keyboard-shortcut")) {
      //   return { status: "ignored" };
      // }
      // return { status: "handled", consume: true };
      return { status: "ignored" };
    },
  };
}

// AI-REMOVED 2026-07-12:
// Reason: 快速放置打开条件从快捷键分支内联逻辑抽取为公共函数，供快捷键和空白双击共同复用。
// Trigger: 新增选择模式下空白双击 / double tap 触发快速放置，需要与快捷键保持完全一致的 select、enabled、grid 命中条件。
// Evidence: createQuickPlaceGestureModule 中快捷键路径和 double tap 路径均调用 tryOpenQuickPlaceAt。
// Replacement: tryOpenQuickPlaceAt in this file
// Risk: Low
// Human Review: Required
//
// Original code:
// if (
//   context.appHost.internalState.activeTool !== "select"
//   || !context.appHost.internalState.settings.quickPlaceEnabled
// ) {
//   return { status: "ignored" };
// }
//
// const editor = context.workspace.editor;
// if (
//   editor === null
//   || lastMousePosition === null
//   || editor.queries.findGridCellForClientPixelPoint(lastMousePosition) === null
// ) {
//   return { status: "ignored" };
// }
//
// runInAction(() => {
//   context.appHost.internalState.runtime.quickPlace.visible = true;
//   context.appHost.internalState.runtime.quickPlace.anchor = lastMousePosition;
//   context.appHost.internalState.runtime.quickPlace.searchQuery = "";
// });
function tryOpenQuickPlaceAt(
  context: GestureActionContext<AppHost>,
  position: GesturePosition | null,
  openSource: "keyboard-shortcut" | "pointer",
): boolean {
  if (
    context.appHost.internalState.activeTool !== "select"
    || !context.appHost.internalState.settings.quickPlaceEnabled
  ) {
    return false;
  }

  const editor = context.workspace.editor;
  if (
    editor === null
    || position === null
    || editor.queries.findGridCellForClientPixelPoint(position) === null
  ) {
    return false;
  }

  runInAction(() => {
    context.appHost.internalState.runtime.quickPlace.visible = true;
    context.appHost.internalState.runtime.quickPlace.anchor = position;
    context.appHost.internalState.runtime.quickPlace.searchQuery = "";
    context.appHost.internalState.runtime.quickPlace.openSource = openSource;
    context.appHost.internalState.runtime.quickPlace.activeResultId = null;
  });

  return true;
}

function closeQuickPlace(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.runtime.quickPlace.visible = false;
    appHost.internalState.runtime.quickPlace.anchor = null;
    appHost.internalState.runtime.quickPlace.searchQuery = "";
    appHost.internalState.runtime.quickPlace.openSource = null;
    appHost.internalState.runtime.quickPlace.activeResultId = null;
  });
}

function selectQuickPlaceFavorite(
  context: GestureActionContext<AppHost>,
  shortcutIndex: number,
  event: KeyboardGestureEvent,
) {
  const entries = buildCurrentQuickPlaceEntries(context);
  const favorites = normalizeQuickPlaceFavorites(
    context.appHost.internalState.workbench.quickPlaceFavoriteEntityIds,
    new Set(entries.map((entry) => entry.id)),
  );
  const deviceId = favorites[shortcutIndex];
  if (deviceId === null || deviceId === undefined) {
    return { status: "ignored" as const };
  }

  selectQuickPlaceDevice(context.appHost, deviceId, event);
  return { status: "handled" as const, consume: true };
}

function moveQuickPlaceActiveResult(
  context: GestureActionContext<AppHost>,
  event: KeyboardGestureEvent,
  delta: -1 | 1,
) {
  if (!isQuickPlaceSearchKeyboardEvent(event)) {
    return { status: "ignored" as const };
  }

  const entries = filterQuickPlaceDeviceEntries(
    buildCurrentQuickPlaceEntries(context),
    context.appHost.internalState.runtime.quickPlace.searchQuery,
  );
  if (entries.length === 0) {
    return { status: "ignored" as const };
  }

  const currentId = context.appHost.internalState.runtime.quickPlace.activeResultId;
  const currentIndex = currentId === null
    ? -1
    : entries.findIndex((entry) => entry.id === currentId);
  const nextIndex = currentIndex < 0
    ? (delta > 0 ? 0 : entries.length - 1)
    : Math.min(entries.length - 1, Math.max(0, currentIndex + delta));
  runInAction(() => {
    context.appHost.internalState.runtime.quickPlace.activeResultId = entries[nextIndex]?.id ?? null;
  });
  return { status: "handled" as const, consume: true };
}

function confirmQuickPlaceActiveResult(
  context: GestureActionContext<AppHost>,
  event: KeyboardGestureEvent,
) {
  if (!isQuickPlaceSearchKeyboardEvent(event)) {
    return { status: "ignored" as const };
  }

  const entries = filterQuickPlaceDeviceEntries(
    buildCurrentQuickPlaceEntries(context),
    context.appHost.internalState.runtime.quickPlace.searchQuery,
  );
  const activeResultId = context.appHost.internalState.runtime.quickPlace.activeResultId;
  const entry = activeResultId === null
    ? entries[0]
    : entries.find((candidate) => candidate.id === activeResultId) ?? entries[0];
  if (entry === undefined) {
    return { status: "ignored" as const };
  }

  selectQuickPlaceDevice(context.appHost, entry.id, event);
  return { status: "handled" as const, consume: true };
}

function buildCurrentQuickPlaceEntries(context: GestureActionContext<AppHost>) {
  const currentBaseId = context.workspace.editor?.document.getSnapshot().baseId ?? null;
  return buildQuickPlaceDeviceEntries({
    definitions: context.workspace.registry.entityDefinitions,
    translate: context.appHost.actions.translate,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(
      context.appHost,
      definition,
      currentBaseId,
    ),
  });
}

function selectQuickPlaceDevice(
  appHost: AppHost,
  deviceId: string,
  event: KeyboardGestureEvent,
): void {
  closeQuickPlace(appHost);
  triggerQuickPlaceDeviceSelection({
    appHost,
    deviceId,
    source: "mouse",
    button: 0,
    altKey: event.modifiers.alt,
    ctrlKey: event.modifiers.ctrl,
    metaKey: event.modifiers.meta,
    shiftKey: event.modifiers.shift,
    sourceEvent: event.sourceEvent,
  });
}

function isQuickPlaceSearchKeyboardEvent(event: KeyboardGestureEvent): boolean {
  const sourceEvent = event.sourceEvent as {
    readonly isComposing?: boolean;
    readonly target?: { readonly tagName?: string };
  } | null;

  return sourceEvent?.isComposing !== true
    && sourceEvent?.target?.tagName?.toLowerCase() === "input";
}

function hasActiveModifier(modifiers: {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}): boolean {
  return modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift;
}
