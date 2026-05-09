import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  closeCompactLeftDockOnPlacementEnter,
  drivePlacementPreview,
  primePlacementAnchorFromPreview,
  resolveViewportCenterGridPoint,
  rotatePlacementPreview,
  syncPlacementEntryUi,
} from "./hypergryph-single-placement-gesture-module";

const BLUEPRINT_PREVIEW_PLACE_BUTTON_ID = "blueprint-preview-place-button";

export function createHypergryphBlueprintPlacementGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-blueprint-placement-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "blueprint-placement" || event.to === "blueprint-placement") {
          return { status: "ignored" };
        }

        cleanupBlueprintPlacement(context.appHost, context.workspace.editor);
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "blueprint-placement") {
          return { status: "ignored" };
        }

        closeCompactLeftDockOnPlacementEnter(context.appHost);
        syncPlacementEntryUi(
          context.appHost,
          context.appHost.internalState.runtime.blueprintPlacementPointerMode,
        );
        return { status: "handled" };
      }

      const editor = context.workspace.editor;

      if (
        event.type === "ui-button-touch-tap"
        && event.uiButtonId === BLUEPRINT_PREVIEW_PLACE_BUTTON_ID
      ) {
        return editor === null
          ? { status: "ignored" }
          : enterBlueprintPlacement({
            appHost: context.appHost,
            editor,
            source: "touch",
          });
      }

      if (
        event.type === "ui-button-mouse-tap"
        && event.button === 0
        && event.uiButtonId === BLUEPRINT_PREVIEW_PLACE_BUTTON_ID
      ) {
        return editor === null
          ? { status: "ignored" }
          : enterBlueprintPlacement({
            appHost: context.appHost,
            editor,
            source: "mouse",
          });
      }

      if (editor === null || context.appHost.internalState.activeTool !== "blueprint-placement") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          return { status: "handled" };

        case "key down":
          if (!isRotatePlacementShortcut({
            appHost: context.appHost,
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          })) {
            return { status: "ignored" };
          }

          rotateBlueprintPlacementPreview(context.appHost, editor);
          return { status: "handled" };

        case "mouse dragstart":
          return handlePlacementMouseDragStart({
            appHost: context.appHost,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          return primePlacementAnchorFromPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse move":
          return drivePlacementPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse dragmove":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          return drivePlacementPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "touch dragmove":
          return drivePlacementPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse dragend":
          return (
            event.originButton === 0
            && context.appHost.internalState.runtime.placementAnchor !== null
          )
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return context.appHost.internalState.runtime.placementAnchor !== null
            ? { status: "handled" }
            : { status: "ignored" };

        case "mouse tap":
          if (event.button === 2) {
            cancelBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && !event.longPress) {
            applyBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelBlueprintPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function enterBlueprintPlacement(options: {
  appHost: AppHost;
  editor: EditorContract;
  source: "mouse" | "touch";
}): GestureHandleResult {
  const record = options.appHost.blueprintPreview.record;

  if (record === null || options.editor.actions.createBlueprintPlacementDraft === undefined) {
    return { status: "ignored" };
  }

  const previousTool = options.appHost.internalState.activeTool;
  const reenteringBlueprintPlacement = previousTool === "blueprint-placement";

  if (!reenteringBlueprintPlacement && previousTool !== "select") {
    options.appHost.internalActions.setActiveTool("select");
  }

  if (reenteringBlueprintPlacement) {
    safelyCancelPlacementDraft(options.editor);
    clearBlueprintPlacementUi(options.appHost);
  }

  const placementAnchor = resolveViewportCenterGridPoint(options.editor);

  if (placementAnchor === null) {
    return { status: "ignored" };
  }

  try {
    options.appHost.internalState.runtime.placementAnchor = placementAnchor;
    options.appHost.internalState.runtime.blueprintPlacementRecord = record;
    options.appHost.internalState.runtime.blueprintPlacementPointerMode = options.source;
    options.appHost.internalState.runtime.blueprintPlacementRotationSteps = 0;
    options.editor.actions.createBlueprintPlacementDraft(record, placementAnchor);

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null) {
      restoreFailedBlueprintPlacementEnter(options.appHost, options.editor);
      return { status: "ignored" };
    }

    options.appHost.blueprintPreview.close();

    if (reenteringBlueprintPlacement) {
      if (!syncPlacementEntryUi(options.appHost, options.source)) {
        restoreFailedBlueprintPlacementEnter(options.appHost, options.editor);
        return { status: "ignored" };
      }

      return { status: "handled" };
    }

    options.appHost.internalActions.setActiveTool("blueprint-placement");
    return { status: "handled" };
  } catch {
    restoreFailedBlueprintPlacementEnter(options.appHost, options.editor);
    return { status: "ignored" };
  }
}

function handlePlacementMouseDragStart(options: {
  appHost: AppHost;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton !== 0) {
    return { status: "ignored" };
  }

  if (options.appHost.internalState.runtime.placementAnchor !== null) {
    return { status: "handled" };
  }

  return primePlacementAnchorFromPreview({
    appHost: options.appHost,
    editor: options.editor,
    position: options.position,
  });
}

function applyBlueprintPlacement(appHost: AppHost, editor: EditorContract): void {
  const record = appHost.internalState.runtime.blueprintPlacementRecord;
  const placementAnchor = appHost.internalState.runtime.placementAnchor;
  const pointerMode = appHost.internalState.runtime.blueprintPlacementPointerMode;
  const rotationSteps = normalizeRotationSteps(
    appHost.internalState.runtime.blueprintPlacementRotationSteps,
  );

  if (
    record === null
    || placementAnchor === null
    || pointerMode === null
    || editor.actions.createBlueprintPlacementDraft === undefined
  ) {
    cancelBlueprintPlacement(appHost, editor);
    return;
  }

  try {
    editor.actions.applyPlacementDraft();
    appHost.internalState.runtime.placementAnchor = placementAnchor;
    editor.actions.createBlueprintPlacementDraft(record, placementAnchor);

    for (let index = 0; index < rotationSteps; index += 1) {
      rotatePlacementPreview(appHost, editor);
    }

    const previewRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);

    if (previewRect === null || !syncPlacementEntryUi(appHost, pointerMode)) {
      throw new Error("failed to re-arm blueprint placement preview");
    }
  } catch {
    safelyCancelPlacementDraft(editor);
    clearBlueprintPlacementUi(appHost);
    appHost.internalActions.setActiveTool("select");
  }
}

function cancelBlueprintPlacement(appHost: AppHost, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    clearBlueprintPlacementUi(appHost);
    appHost.internalActions.setActiveTool("select");
  }
}

function rotateBlueprintPlacementPreview(appHost: AppHost, editor: EditorContract): void {
  rotatePlacementPreview(appHost, editor);
  appHost.internalState.runtime.blueprintPlacementRotationSteps = normalizeRotationSteps(
    appHost.internalState.runtime.blueprintPlacementRotationSteps + 1,
  );
}

function cleanupBlueprintPlacement(appHost: AppHost, editor: EditorContract | null): void {
  if (editor !== null) {
    safelyCancelPlacementDraft(editor);
  }

  clearBlueprintPlacementUi(appHost);
}

function clearBlueprintPlacementUi(appHost: AppHost): void {
  appHost.internalState.runtime.placementAnchor = null;
  appHost.internalState.runtime.blueprintPlacementRecord = null;
  appHost.internalState.runtime.blueprintPlacementPointerMode = null;
  appHost.internalState.runtime.blueprintPlacementRotationSteps = 0;
  appHost.internalActions.hideCanvasFloatingToolbar();
}

function restoreFailedBlueprintPlacementEnter(appHost: AppHost, editor: EditorContract): void {
  safelyCancelPlacementDraft(editor);
  clearBlueprintPlacementUi(appHost);
  appHost.internalActions.setActiveTool("select");
}

function safelyCancelPlacementDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; placement should not leave UI half-entered.
  }
}

function normalizeRotationSteps(rotationSteps: number): number {
  return ((Math.trunc(rotationSteps) % 4) + 4) % 4;
}

function isRotatePlacementShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): boolean {
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return false;
  }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.ROTATE,
    options.code,
    options.key,
  );
}