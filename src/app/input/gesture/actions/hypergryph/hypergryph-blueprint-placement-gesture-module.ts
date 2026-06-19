import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { createSelectionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import { canPlaceBlueprintDocumentInCurrentBase } from "@/app/placement-zone-availability";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

import type { GestureActionContext, GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  closeCompactLeftDockOnPlacementEnter,
  driveMousePlacementPreview,
  drivePlacementPreview,
  primePlacementAnchorFromPreview,
  resolveViewportCenterGridPoint,
  rotatePlacementPreview,
  syncPlacementEntryUi,
} from "./hypergryph-single-placement-gesture-module";

const BLUEPRINT_PREVIEW_PLACE_BUTTON_ID = "blueprint-preview-place-button";
const TEMP_BLUEPRINT_NAME = "Temp Blueprint";

type TempBlueprintShortcut = "copy" | "paste";

export function createHypergryphBlueprintPlacementGestureModule(): GestureMappingModule<AppHost> {
  let lastTempBlueprint: BlueprintLibraryRecord | null = null;
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-blueprint-placement-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }

      if (event.type === "key down") {
        const shortcut = resolveTempBlueprintShortcut({
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        });

        if (shortcut !== null) {
          if (isEditableKeyboardTarget(event.sourceEvent)) {
            return { status: "ignored" };
          }

          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }

          if (shortcut === "copy") {
            if (context.appHost.internalState.activeTool !== "marquee") {
              return { status: "ignored" };
            }

            const record = createTempBlueprintRecord(context);
            if (record === null) {
              return { status: "ignored" };
            }

            lastTempBlueprint = record;
            return enterBlueprintPlacement({
              appHost: context.appHost,
              editor,
              record,
              source: "mouse",
              initialMousePosition: lastMousePosition,
            });
          }

          if (lastTempBlueprint === null) {
            return { status: "ignored" };
          }

          return enterBlueprintPlacement({
            appHost: context.appHost,
            editor,
            record: lastTempBlueprint,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });
        }
      }

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
            initialMousePosition: null,
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
            initialMousePosition: lastMousePosition,
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

          rotateBlueprintPlacementPreview(context.appHost, editor, lastMousePosition);
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
          return driveMousePlacementPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse dragmove":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          return driveMousePlacementPreview({
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
            applyBlueprintPlacement(context.appHost, editor, lastMousePosition, {
              continuous: event.modifiers.shift || event.modifiers.ctrl,
            });
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyBlueprintPlacement(context.appHost, editor, null, { continuous: false });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.appHost, editor, null);
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
            applyBlueprintPlacement(context.appHost, editor, lastMousePosition, { continuous: false });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.appHost, editor, lastMousePosition);
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
  record?: BlueprintLibraryRecord;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
  placementAnchor?: GridPoint;
}): GestureHandleResult {
  const record = options.record ?? options.appHost.blueprintPreview.record;

  if (record === null || options.editor.actions.createBlueprintPlacementDraft === undefined) {
    return { status: "ignored" };
  }

  if (!canPlaceBlueprintDocumentInCurrentBase(options.appHost, record)) {
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

  const placementAnchor = options.placementAnchor
    ?? resolveViewportCenterGridPoint(options.editor);

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

    if (
      options.source === "mouse"
      && options.initialMousePosition !== null
      && isClientPointInsideViewport(options.editor, options.initialMousePosition)
    ) {
      options.editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.initialMousePosition,
      );
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

export function placeBlueprintFromMoveAndContinue(options: {
  appHost: AppHost;
  editor: EditorContract;
  record: BlueprintLibraryRecord;
  source: "mouse" | "touch";
  placementAnchor: GridPoint;
  currentMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const enterResult = enterBlueprintPlacement({
    appHost: options.appHost,
    editor: options.editor,
    record: options.record,
    source: options.source,
    initialMousePosition: null,
    placementAnchor: options.placementAnchor,
  });
  if (enterResult.status !== "handled") {
    return enterResult;
  }

  applyBlueprintPlacement(
    options.appHost,
    options.editor,
    options.currentMousePosition,
    { continuous: true },
  );
  return { status: "handled" };
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

function applyBlueprintPlacement(
  appHost: AppHost,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
  options: { continuous: boolean },
): void {
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
    const applied = editor.actions.applyPlacementDraft();
    if (!applied) {
      return;
    }

    if (options.continuous) {
      appHost.internalState.runtime.placementAnchor = placementAnchor;
      editor.actions.createBlueprintPlacementDraft(record, placementAnchor);

      for (let index = 0; index < rotationSteps; index += 1) {
        editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
      }

      if (
        pointerMode === "mouse"
        && currentMousePosition !== null
        && isClientPointInsideViewport(editor, currentMousePosition)
      ) {
        editor.actions.moveCollectionCenterPointTo(
          EntityCollectionType.preview,
          currentMousePosition,
        );
      }

      const previewRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);

      if (previewRect === null || !syncPlacementEntryUi(appHost, pointerMode)) {
        throw new Error("failed to re-arm blueprint placement preview");
      }

      return;
    }
  } catch {
    safelyCancelPlacementDraft(editor);
  }

  // 非连续放置 或 异常 → 回到 select
  clearBlueprintPlacementUi(appHost);
  appHost.internalActions.setActiveTool("select");
  appHost.internalActions.setActivePanel("placement");
}

function cancelBlueprintPlacement(appHost: AppHost, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    clearBlueprintPlacementUi(appHost);
    appHost.internalActions.setActiveTool("select");
    appHost.internalActions.setActivePanel("placement");
  }
}

function rotateBlueprintPlacementPreview(
  appHost: AppHost,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): void {
  rotatePlacementPreview(appHost, editor, {
    pointerMode: appHost.internalState.runtime.blueprintPlacementPointerMode,
    currentMousePosition,
  });
  appHost.internalState.runtime.blueprintPlacementRotationSteps = normalizeRotationSteps(
    appHost.internalState.runtime.blueprintPlacementRotationSteps + 1,
  );
}

function isClientPointInsideViewport(
  editor: EditorContract,
  position: GesturePosition,
): boolean {
  const clientRect = editor.state.viewport.clientRect;

  return position.x >= clientRect.left
    && position.x <= clientRect.left + clientRect.width
    && position.y >= clientRect.top
    && position.y <= clientRect.top + clientRect.height;
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
  appHost.internalActions.setActivePanel("placement");
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

function createTempBlueprintRecord(
  context: GestureActionContext<AppHost>,
): BlueprintLibraryRecord | null {
  const blueprintDocument = createSelectionBlueprintDocument({
    workspace: context.workspace,
    name: TEMP_BLUEPRINT_NAME,
  });

  if (blueprintDocument === null) {
    return null;
  }

  return {
    ...blueprintDocument,
    parentFolderId: null,
  };
}

function resolveTempBlueprintShortcut(options: {
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  };
}): TempBlueprintShortcut | null {
  if (
    options.modifiers.alt
    || options.modifiers.shift
    || (!options.modifiers.ctrl && !options.modifiers.meta)
  ) {
    return null;
  }

  if (matchesKeyboardKey(options, "KeyC", "c")) {
    return "copy";
  }

  if (matchesKeyboardKey(options, "KeyV", "v")) {
    return "paste";
  }

  return null;
}

function matchesKeyboardKey(
  options: {
    code: string | null;
    key: string | null;
  },
  code: string,
  key: string,
): boolean {
  return options.code === code || options.key?.toLowerCase() === key;
}

function isEditableKeyboardTarget(sourceEvent: unknown): boolean {
  const target = (sourceEvent as { target?: unknown } | null)?.target;

  if (!isElementLikeTarget(target)) {
    return false;
  }

  const tagName = typeof target.tagName === "string"
    ? target.tagName.toLowerCase()
    : "";

  if (tagName === "input" || tagName === "textarea") {
    return true;
  }

  if (target.isContentEditable === true) {
    return true;
  }

  if (typeof target.closest === "function") {
    return target.closest(
      "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
    ) !== null;
  }

  return false;
}

function isElementLikeTarget(target: unknown): target is {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly closest?: (selector: string) => unknown;
} {
  return typeof target === "object" && target !== null;
}
