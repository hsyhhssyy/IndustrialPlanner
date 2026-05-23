import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridRotation } from "@/domain/shared/grid";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const ROTATE_VIEW_BUTTON_ID = "canvas-bottom-left-secondary-toolbar-button-rotate-view";

export function createHypergryphViewportRotationModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-viewport-rotation",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "rotate clockwise":
          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };

        case "rotate counterclockwise":
          rotateViewport(editor, "counterclockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };

        case "key down":
          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.ROTATE_VIEWPORT,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };

        case "ui-button-touch-tap":
          if (event.uiButtonId !== ROTATE_VIEW_BUTTON_ID) {
            return { status: "ignored" };
          }

          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || event.uiButtonId !== ROTATE_VIEW_BUTTON_ID) {
            return { status: "ignored" };
          }

          rotateViewport(editor, "clockwise");
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
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
