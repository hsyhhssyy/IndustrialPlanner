import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { GestureModifiers, KeyboardSnapshot } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridRotation } from "@/domain/shared/grid";
import type {
  GestureActionContext,
  GestureHandleResult,
  GestureMappingModule,
  KeyboardGestureEvent,
} from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const ROTATE_VIEW_BUTTON_ID = "canvas-bottom-left-secondary-toolbar-button-rotate-view";
const ROTATE_VIEW_HOLD_DURATION_MS = 2_000;

interface KeyboardHoldSource {
  readonly kind: "keyboard";
  readonly code: string;
  readonly requiredModifiers: GestureModifiers;
}

interface UiButtonHoldSource {
  readonly kind: "ui-button";
  readonly gestureId: string;
}

type ViewportRotationHoldSource = KeyboardHoldSource | UiButtonHoldSource;

interface ViewportRotationHoldSession {
  readonly appHost: AppHost;
  readonly feedbackGestureId: string;
  readonly source: ViewportRotationHoldSource;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createHypergryphViewportRotationModule(): GestureMappingModule<AppHost> {
  let holdSession: ViewportRotationHoldSession | null = null;
  let completedKeyboardSource: KeyboardHoldSource | null = null;
  let completedUiButtonGestureId: string | null = null;
  let unsubscribeKeyboardReset: (() => void) | null = null;

  const clearKeyboardResetSubscription = (): void => {
    unsubscribeKeyboardReset?.();
    unsubscribeKeyboardReset = null;
  };

  const finishHoldSession = (
    session: ViewportRotationHoldSession,
    action: "none" | "rotate" | "reset",
  ): void => {
    if (holdSession !== session) {
      return;
    }

    if (session.timer !== null) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    holdSession = null;
    clearKeyboardResetSubscription();
    session.appHost.gestureAdapter.endUiButtonHoldFeedback(session.feedbackGestureId);

    const editor = session.appHost.workspace.editor;
    if (editor === null || action === "none") {
      return;
    }

    if (action === "reset") {
      editor.actions.setViewportDisplayRotation(0);
    } else {
      rotateViewport(editor, "clockwise");
    }
    session.appHost.internalActions.alignCanvasFloatingToolbar();
  };

  const isHoldSourceActive = (session: ViewportRotationHoldSession): boolean => {
    if (session.source.kind === "ui-button") {
      return session.appHost.gestureAdapter.isUiButtonPressActive(session.source.gestureId);
    }

    return isKeyboardHoldActive(
      session.appHost.gestureAdapter.getKeyboardSnapshot(),
      session.source,
    );
  };

  const startHoldSession = (
    context: GestureActionContext<AppHost>,
    source: ViewportRotationHoldSource,
    feedbackGestureId: string,
  ): GestureHandleResult => {
    if (holdSession !== null) {
      return { status: "handled" };
    }

    const session: ViewportRotationHoldSession = {
      appHost: context.appHost,
      feedbackGestureId,
      source,
      timer: null,
    };
    holdSession = session;
    context.appHost.gestureAdapter.beginUiButtonHoldFeedback({
      uiButtonId: ROTATE_VIEW_BUTTON_ID,
      gestureId: feedbackGestureId,
      durationMs: ROTATE_VIEW_HOLD_DURATION_MS,
    });

    if (source.kind === "keyboard") {
      unsubscribeKeyboardReset = context.appHost.gestureAdapter.subscribeKeyboardSnapshot(
        (snapshot) => {
          if (
            snapshot.lastCode === null
            && holdSession === session
            && !isKeyboardHoldActive(snapshot, source)
          ) {
            finishHoldSession(session, "none");
          }
        },
      );
    }

    session.timer = setTimeout(() => {
      session.timer = null;
      if (holdSession !== session) {
        return;
      }

      if (!isHoldSourceActive(session) || session.appHost.workspace.editor === null) {
        finishHoldSession(session, "none");
        return;
      }

      if (source.kind === "keyboard") {
        completedKeyboardSource = source;
      } else {
        completedUiButtonGestureId = source.gestureId;
      }
      finishHoldSession(session, "reset");
    }, ROTATE_VIEW_HOLD_DURATION_MS);

    return { status: "handled" };
  };

  const handleShortcutLifecycle = (
    event: KeyboardGestureEvent,
    context: GestureActionContext<AppHost>,
    allowStart: boolean,
  ): GestureHandleResult => {
    if (completedKeyboardSource !== null) {
      if (!isKeyboardHoldActive(context.keyboard, completedKeyboardSource)) {
        completedKeyboardSource = null;
        return { status: "handled" };
      }
      return allowStart ? { status: "handled" } : { status: "ignored" };
    }

    if (holdSession?.source.kind === "keyboard") {
      if (
        event.type === "key up"
        && !isKeyboardHoldActive(context.keyboard, holdSession.source)
      ) {
        finishHoldSession(holdSession, "rotate");
        return { status: "handled" };
      }
      return allowStart ? { status: "handled" } : { status: "ignored" };
    }

    if (!allowStart || event.type !== "key down") {
      return { status: "ignored" };
    }

    const code = resolveKeyboardEventCode(event);
    if (code === null) {
      return { status: "ignored" };
    }

    return startHoldSession(context, {
      kind: "keyboard",
      code,
      requiredModifiers: event.modifiers,
    }, event.gestureId);
  };

  return {
    id: "hypergryph-viewport-rotation",
    when: isHypergryphGestureEnabled,
    shortcutRoutes: [{
      id: "rotate-viewport.non-operation",
      actionId: SHORTCUT_KEY.ROTATE_VIEWPORT,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE_VIEWPORT },
      scope: {
        inputLayers: ["canvas"],
        activeTools: ["select", "marquee", "dark-pipe-link"],
      },
      triggerPolicy: { kind: "exact" },
      claimsBrowserDefault: true,
      events: ["key down", "key up"],
      handle(event, context) {
        const editor = context.workspace.editor;
        if (editor === null) {
          return { status: "ignored" };
        }

        return handleShortcutLifecycle(event, context, true);
      },
    }],
    handle(event, context) {
      if (event.type === "key down" || event.type === "key up") {
        const result = handleShortcutLifecycle(event, context, false);
        if (result.status !== "ignored") {
          return result;
        }
      }

      switch (event.type) {
        case "rotate clockwise": {
          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }
          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        case "rotate counterclockwise": {
          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }
          rotateViewport(editor, "counterclockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        // AI-REMOVED 2026-08-30:
        // Reason: 画布旋转快捷键的非操作模式有效域已迁入 Shortcut Route。
        // Trigger: ST2-RQ-020 的 R / Ctrl+R 基准冲突案例。
        // Evidence: rotate-viewport.non-operation 仅覆盖 select/marquee/dark-pipe-link。
        // Replacement: shortcutRoutes[rotate-viewport.non-operation] in this module
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // case "key down":
        //   if (!context.appHost.internalActions.isShortcutFor(
        //     SHORTCUT_KEY.ROTATE_VIEWPORT,
        //     event.code,
        //     event.key,
        //     event.modifiers,
        //   )) {
        //     return { status: "ignored" };
        //   }
        //   rotateViewport(editor, "clockwise");
        //   context.appHost.internalActions.alignCanvasFloatingToolbar();
        //   return { status: "handled" };

        case "ui-button-press-start":
          if (
            event.uiButtonId !== ROTATE_VIEW_BUTTON_ID
            || event.button !== 0
            || context.workspace.editor === null
          ) {
            return { status: "ignored" };
          }

          return startHoldSession(context, {
            kind: "ui-button",
            gestureId: event.gestureId,
          }, event.gestureId);

        case "ui-button-press-end":
          if (event.uiButtonId !== ROTATE_VIEW_BUTTON_ID || event.button !== 0) {
            return { status: "ignored" };
          }

          if (completedUiButtonGestureId === event.gestureId) {
            completedUiButtonGestureId = null;
            return { status: "handled" };
          }

          if (
            holdSession?.source.kind !== "ui-button"
            || holdSession.source.gestureId !== event.gestureId
          ) {
            return { status: "ignored" };
          }

          finishHoldSession(holdSession, event.reason === "release" ? "rotate" : "none");
          return { status: "handled" };

        case "ui-button-touch-tap": {
          if (event.uiButtonId !== ROTATE_VIEW_BUTTON_ID) {
            return { status: "ignored" };
          }

          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }
          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        case "ui-button-mouse-tap": {
          if (event.button !== 0 || event.uiButtonId !== ROTATE_VIEW_BUTTON_ID) {
            return { status: "ignored" };
          }

          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }
          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

function resolveKeyboardEventCode(event: {
  readonly code: string | null;
  readonly key: string | null;
  readonly keyCode: number | null;
}): string | null {
  if (event.code !== null && event.code !== "") {
    return event.code;
  }
  if (event.key !== null && event.key !== "") {
    return event.key;
  }
  if (event.keyCode !== null) {
    return `keyCode:${event.keyCode}`;
  }
  return null;
}

function isKeyboardHoldActive(
  snapshot: KeyboardSnapshot,
  source: KeyboardHoldSource,
): boolean {
  return snapshot.pressedKeys.has(source.code)
    && (!source.requiredModifiers.alt || snapshot.modifiers.alt)
    && (!source.requiredModifiers.ctrl || snapshot.modifiers.ctrl)
    && (!source.requiredModifiers.meta || snapshot.modifiers.meta)
    && (!source.requiredModifiers.shift || snapshot.modifiers.shift);
}

function rotateViewport(
  editor: EditorContract,
  direction: "clockwise" | "counterclockwise",
): void {
  editor.actions.setViewportDisplayRotation(
    resolveNextViewportRotation(editor.state.viewport.displayRotation, direction),
  );
}

function resolveNextViewportRotation(
  currentRotation: GridRotation,
  direction: "clockwise" | "counterclockwise",
): GridRotation {
  const rotations: readonly GridRotation[] = [0, 90, 180, 270];
  const currentIndex = rotations.indexOf(currentRotation);
  const normalizedIndex = currentIndex === -1 ? 0 : currentIndex;
  const step = direction === "clockwise" ? 1 : -1;
  const nextIndex = (normalizedIndex + step + rotations.length) % rotations.length;

  return rotations[nextIndex] ?? 0;
}
