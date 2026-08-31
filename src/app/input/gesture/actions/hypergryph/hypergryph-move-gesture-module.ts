import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { createMovePreviewBlueprintDocument } from "@/app/blueprint/save-blueprint";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import type {
  CanvasFloatingToolbarButtonId,
  CanvasRightDockToolbarItemRequest,
} from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { placeBlueprintFromMoveAndContinue } from "./hypergryph-blueprint-placement-gesture-module";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  didPreviewRectChange,
  isPreviewBoundingBoxAtClientPoint,
  resolveTouchDragAnchorAfterPreviewMove,
  TOUCH_PREVIEW_HIT_SLOP_PX,
} from "./mobile-preview-bounds";
import {
  openOverlapEntityMenuForCandidates,
  resolveOverlappingEntityCandidatesAtClientPoint,
} from "./overlap-entity-candidates";

const MOVE_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-copy",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

const MOVE_ENTRY_BUTTON_IDS = {
  marquee: "canvas-right-dock-toolbar-button-move",
  select: "canvas-floating-toolbar-button-move",
} as const;
const PLACEMENT_MARQUEE_TOOL_BUTTON_ID = "placement-tool-marquee";

const ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "delete-device", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "delete-device", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "cancel-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

export function createHypergryphMoveGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-move-gesture",
    when: isHypergryphGestureEnabled,
    shortcutRoutes: [
      {
        id: "move.enter-selection",
        actionId: SHORTCUT_KEY.MOVE_SELECTION,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.MOVE_SELECTION },
        scope: {
          inputLayers: ["canvas", "inspector-dialog"],
          activeTools: ["select", "marquee"],
        },
        triggerPolicy: { kind: "exact" },
        handle(_event, context) {
          const editor = context.workspace.editor;
          return editor === null
            ? { status: "ignored" }
            : tryEnterMoveModeFromKeyboard(context.appHost, editor, lastMousePosition);
        },
      },
      {
        id: "move.switch-device-mode",
        actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
        scope: { inputLayers: ["canvas"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle(_event, context) {
          const editor = context.workspace.editor;
          return editor === null
            ? { status: "ignored" }
            : switchMovePreviewVariant(context.appHost, editor, lastMousePosition);
        },
      },
      {
        id: "move.delete-operation",
        actionId: SHORTCUT_KEY.DELETE_DEVICE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.DELETE_DEVICE },
        scope: { inputLayers: ["canvas", "inspector-dialog"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.workspace.editor;
          if (editor === null) return { status: "ignored" };
          deleteMoveOperation(context.appHost, editor);
          return { status: "handled" };
        },
      },
      {
        id: "current-operation.rotate-move",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["move"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.workspace.editor;
          if (editor === null) return { status: "ignored" };
          rotateMovePreview(context.appHost, editor, lastMousePosition);
          return { status: "handled" };
        },
      },
    ],
    acceptsLongPress(context) {
      const tool = context.appHost.internalState.activeTool;
      return tool === "select" || tool === "marquee";
    },
    handle(event, context) {
      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "move" || event.to === "move") {
          return { status: "ignored" };
        }

        cleanupMoveOperationDraft(context.appHost);
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "move") {
          return { status: "ignored" };
        }

        syncMoveEntryUi(context.appHost);
        return { status: "handled" };
      }

      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (context.appHost.internalState.activeTool === "move") {
        switch (event.type) {
          case "mouse-long-press-ready":
          case "tap-long-press-ready":
            return { status: "handled" };

          // AI-REMOVED 2026-08-30:
          // Reason: move 内的 Tab/F/R 已拆为三条 allow-any-additional-modifiers Route。
          // Trigger: ST2-RQ-020 操作模式快捷键自定义 modifier 兼容。
          // Evidence: move.switch-device-mode、move.delete-operation、current-operation.rotate-move。
          // Replacement: shortcutRoutes in createHypergryphMoveGestureModule
          // Risk: Low
          // Human Review: Required
          //
          // Original code:
          /*
          case "key down":
            if (isSwitchDeviceModeShortcut({
              appHost: context.appHost,
              code: event.code,
              key: event.key,
              modifiers: event.modifiers,
            })) {
              return switchMovePreviewVariant(context.appHost, editor, lastMousePosition);
            }

            if (isDeleteDeviceShortcut({
              appHost: context.appHost,
              code: event.code,
              key: event.key,
              modifiers: event.modifiers,
            })) {
              deleteMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            if (!isRotateMoveShortcut({
              appHost: context.appHost,
              code: event.code,
              key: event.key,
              modifiers: event.modifiers,
            })) {
              return { status: "ignored" };
            }

            rotateMovePreview(context.appHost, editor, lastMousePosition);
            return { status: "handled" };
          */

          case "mouse dragstart":
            return handleMoveMouseDragStart({
              appHost: context.appHost,
              editor,
              entityDefinitionMap: createEntityDefinitionMap(context.appHost),
              originButton: event.originButton,
              position: event.position,
            });

          case "touch dragstart":
            return handleMoveTouchDragStart({
              appHost: context.appHost,
              editor,
              entityDefinitionMap: createEntityDefinitionMap(context.appHost),
              position: event.startPosition,
            });

          case "mouse move":
            return driveMovePreview({
              appHost: context.appHost,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: true,
            });

          case "mouse dragmove":
            if (event.originButton !== 0) {
              return { status: "ignored" };
            }

            return driveMovePreview({
              appHost: context.appHost,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: false,
            });

          case "touch dragmove":
            return driveMovePreview({
              appHost: context.appHost,
              editor,
              position: event.position,
              allowMouseEntryAnchorInit: false,
            });

          case "mouse dragend":
            return (
              event.originButton === 0
              && context.appHost.internalState.runtime.moveAnchor !== null
            )
              ? { status: "handled" }
              : { status: "ignored" };

          case "touch dragend":
            return context.appHost.internalState.runtime.moveAnchor !== null
              ? { status: "handled" }
              : { status: "ignored" };

          case "mouse tap":
            if (event.button === 2) {
              cancelMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            if (event.button === 0 && !event.longPress) {
              if (
                event.modifiers.ctrl
                && context.appHost.state.settings.hypergryphCopyWhileMoving
              ) {
                return copyMoveOperation({
                  appHost: context.appHost,
                  editor,
                  source: "mouse",
                  currentMousePosition: lastMousePosition,
                });
              }

              applyMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            return { status: "handled" };

          case "ui-button-touch-tap":
            if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
              return switchMovePreviewVariant(context.appHost, editor, null);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor, "touch");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-copy") {
              return copyMoveOperation({
                appHost: context.appHost,
                editor,
                source: "touch",
                currentMousePosition: null,
              });
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
              rotateMovePreview(context.appHost, editor, null);
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
              cancelMoveOperation(context.appHost, editor, "touch");
              return { status: "handled" };
            }

            return { status: "ignored" };

          case "ui-button-mouse-tap":
            if (event.button !== 0) {
              return { status: "ignored" };
            }

            if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
              return switchMovePreviewVariant(context.appHost, editor, lastMousePosition);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-copy") {
              return copyMoveOperation({
                appHost: context.appHost,
                editor,
                source: "mouse",
                currentMousePosition: lastMousePosition,
              });
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
              rotateMovePreview(context.appHost, editor, lastMousePosition);
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
              cancelMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            return { status: "ignored" };

          default:
            return { status: "ignored" };
        }
      }

      switch (event.type) {
        case "ui-button-touch-tap":
          return handleMoveEntryButtonTap({
            appHost: context.appHost,
            editor,
            uiButtonId: event.uiButtonId,
            source: "touch",
            initialMousePosition: null,
          });

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return handleMoveEntryButtonTap({
            appHost: context.appHost,
            editor,
            uiButtonId: event.uiButtonId,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });

        case "mouse dragstart":
          if (
            event.originButton !== 0
            || !context.appHost.state.settings.hypergryphImmediateMove
          ) {
            return { status: "ignored" };
          }

          return tryEnterMoveModeFromPointerEvent({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.startPosition,
            menuPosition: event.startPosition,
            enterPosition: event.position,
            source: "mouse",
            directInitialMousePosition: event.position,
            menuInitialMousePosition: event.startPosition,
          });

        case "mouse-long-press-ready":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return tryEnterMoveModeFromPointerEvent({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.position,
            menuPosition: event.position,
            enterPosition: event.position,
            source: "mouse",
            directInitialMousePosition: event.position,
            menuInitialMousePosition: event.position,
          });

        case "tap-long-press-ready":
          return tryEnterMoveModeFromPointerEvent({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            candidatePosition: event.position,
            menuPosition: event.position,
            enterPosition: event.position,
            source: "touch",
            directInitialMousePosition: null,
            menuInitialMousePosition: null,
          });

        // AI-REMOVED 2026-08-30:
        // Reason: 移动选区入口已迁入 move.enter-selection Route，并显式支持 Inspector 穿透层。
        // Trigger: ST2-RQ-020 输入层统一。
        // Evidence: Route 覆盖 select/marquee 的 canvas 与 inspector-dialog。
        // Replacement: shortcutRoutes[move.enter-selection] in this module
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        /*
        case "key down":
          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.MOVE_SELECTION,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          return tryEnterMoveModeFromKeyboard(context.appHost, editor, lastMousePosition);
        */

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handleMoveEntryButtonTap(options: {
  appHost: AppHost;
  editor: EditorContract;
  uiButtonId: string;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  return tryEnterMoveModeFromSelection(options);
}

// AI-REMOVED 2026-07-03:
// Reason: 移动入口现在必须在真正进入 move 前支持重叠设备菜单；旧实现直接使用 event.pointerEntity，无法让用户在同一格多个设备中选择目标。
// Trigger: 用户需求——重叠设备点击选择与长按移动时必须弹出设备菜单，用户选择后才执行操作。
// Evidence: Search-First 定位到 mouse dragstart / mouse-long-press-ready / tap-long-press-ready 均直接调用 tryEnterMoveMode；新实现统一通过 tryEnterMoveModeFromPointerEvent 先解析多候选。
// Replacement: tryEnterMoveModeFromPointerEvent
// Risk: Medium；立即拖拽多候选时不延续原始拖拽链，选择后进入 move 模式等待后续操作。
// Human Review: Required
//
// Original code:
// return tryEnterMoveMode({
//   appHost: context.appHost,
//   editor,
//   pointerEntity: event.pointerEntity,
//   position: event.position,
//   source: "mouse",
//   initialMousePosition: event.position,
// });
// return tryEnterMoveMode({
//   appHost: context.appHost,
//   editor,
//   pointerEntity: event.pointerEntity,
//   position: event.position,
//   source: "touch",
//   initialMousePosition: null,
// });
function tryEnterMoveModeFromPointerEvent(options: {
  appHost: AppHost;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  candidatePosition: GesturePosition;
  menuPosition: GesturePosition;
  enterPosition: GesturePosition;
  source: "mouse" | "touch";
  directInitialMousePosition: GesturePosition | null;
  menuInitialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.appHost.internalState.activeTool;
  const selection = options.editor.state.collections[EntityCollectionType.selection];
  const filterCandidate = previousTool === "marquee"
    ? (entity: WorldEntity) => selection.contains(entity.id)
    : undefined;
  const candidates = resolveOverlappingEntityCandidatesAtClientPoint({
    appHost: options.appHost,
    editor: options.editor,
    position: options.candidatePosition,
    pointerEntity: options.pointerEntity,
    filterCandidate,
  });

  if (
    openOverlapEntityMenuForCandidates({
      appHost: options.appHost,
      editor: options.editor,
      position: options.menuPosition,
      candidates,
      onSelect: (entity) => {
        tryEnterMoveMode({
          appHost: options.appHost,
          editor: options.editor,
          pointerEntity: entity,
          position: options.menuPosition,
          source: options.source,
          initialMousePosition: options.menuInitialMousePosition,
        });
      },
    })
  ) {
    return { status: "handled" };
  }

  return tryEnterMoveMode({
    appHost: options.appHost,
    editor: options.editor,
    pointerEntity: candidates[0] ?? options.pointerEntity,
    position: options.enterPosition,
    source: options.source,
    initialMousePosition: options.directInitialMousePosition,
  });
}

function tryEnterMoveMode(options: {
  appHost: AppHost;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  position: GesturePosition;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.appHost.internalState.activeTool;

  if (
    previousTool !== "select"
    && previousTool !== "marquee"
  ) {
    return { status: "ignored" };
  }

  const selection = options.editor.state.collections[EntityCollectionType.selection];
  const selectedEntityIds = [...selection];
  const anchor = options.editor.queries.findGridCellForClientPixelPoint(
    options.position,
  );

  try {
    if (!prepareSelectionForMoveEnter({
      editor: options.editor,
      pointerEntity: options.pointerEntity,
      previousTool,
      selection,
      source: options.source,
    })) {
      if (didMouseSelectEnterMutateSelection({
        pointerEntity: options.pointerEntity,
        previousTool,
        source: options.source,
      })) {
        restoreFailedEnterMove({
          appHost: options.appHost,
          editor: options.editor,
          selectedEntityIds,
          previousTool,
        });
      }

      return { status: "ignored" };
    }

    return finalizeMoveEnter({
      appHost: options.appHost,
      editor: options.editor,
      selectedEntityIds,
      previousTool,
      source: options.source,
      anchor,
      requireAnchor: true,
      initialMousePosition: options.initialMousePosition,
    });
  } catch {
    restoreFailedEnterMove({
      appHost: options.appHost,
      editor: options.editor,
      selectedEntityIds,
      previousTool,
    });
    return { status: "ignored" };
  }
}

function tryEnterMoveModeFromSelection(options: {
  appHost: AppHost;
  editor: EditorContract;
  uiButtonId: string;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const previousTool = options.appHost.internalState.activeTool;
  const entryButtonId = resolveMoveEntryButtonId(previousTool);
  if (entryButtonId === null || options.uiButtonId !== entryButtonId) {
    return { status: "ignored" };
  }

  const selection = options.editor.state.collections[EntityCollectionType.selection];
  if (selection.length === 0) {
    return { status: "ignored" };
  }

  return finalizeMoveEnter({
    appHost: options.appHost,
    editor: options.editor,
    selectedEntityIds: [...selection],
    previousTool,
    source: options.source,
    anchor: null,
    requireAnchor: false,
    initialMousePosition: options.initialMousePosition,
  });
}

function tryEnterMoveModeFromKeyboard(
  appHost: AppHost,
  editor: EditorContract,
  initialMousePosition: GesturePosition | null,
): GestureHandleResult {
  const previousTool = appHost.internalState.activeTool;

  if (previousTool !== "select" && previousTool !== "marquee") {
    return { status: "ignored" };
  }

  const selection = editor.state.collections[EntityCollectionType.selection];
  if (selection.length === 0) {
    return { status: "ignored" };
  }

  return finalizeMoveEnter({
    appHost,
    editor,
    selectedEntityIds: [...selection],
    previousTool,
    source: "mouse",
    anchor: null,
    requireAnchor: false,
    initialMousePosition,
  });
}

function resolveMoveEntryButtonId(
  activeTool: AppHost["internalState"]["activeTool"],
): string | null {
  if (activeTool === "marquee") {
    return MOVE_ENTRY_BUTTON_IDS.marquee;
  }

  if (activeTool === "select") {
    return MOVE_ENTRY_BUTTON_IDS.select;
  }

  return null;
}

function finalizeMoveEnter(options: {
  appHost: AppHost;
  editor: EditorContract;
  selectedEntityIds: readonly string[];
  previousTool: AppHost["internalState"]["activeTool"];
  source: "mouse" | "touch";
  anchor: GridPoint | null;
  requireAnchor: boolean;
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  try {
    options.editor.actions.createMoveOperationDraft();

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null || (options.requireAnchor && options.anchor === null)) {
      restoreFailedEnterMove({
        appHost: options.appHost,
        editor: options.editor,
        selectedEntityIds: options.selectedEntityIds,
        previousTool: options.previousTool,
      });
      return { status: "ignored" };
    }

    options.appHost.internalState.runtime.movePointerMode = options.source;
    options.appHost.internalState.runtime.moveAnchor = options.source === "touch"
      ? options.anchor
      : null;
    options.appHost.internalState.runtime.moveEnterFrom = options.previousTool;

    if (
      options.source === "mouse"
      && options.initialMousePosition !== null
      && isClientPointInsideViewport(options.editor, options.initialMousePosition)
    ) {
      options.editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.initialMousePosition,
      );
      const movedRect = options.editor.queries.findEntityCollectionGridRect(
        EntityCollectionType.preview,
      );
      if (movedRect !== null && didPreviewRectChange(previewRect, movedRect)) {
        rotateMovePreviewToBuildingSnap({
          appHost: options.appHost,
          editor: options.editor,
          trigger: "after-move",
          currentMousePosition: options.initialMousePosition,
        });
      }
    }

    options.appHost.internalActions.setActiveTool("move");
    return { status: "handled" };
  } catch {
    restoreFailedEnterMove({
      appHost: options.appHost,
      editor: options.editor,
      selectedEntityIds: options.selectedEntityIds,
      previousTool: options.previousTool,
    });
    return { status: "ignored" };
  }
}

function prepareSelectionForMoveEnter(options: {
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  previousTool: AppHost["internalState"]["activeTool"];
  selection: EditorContract["state"]["collections"][typeof EntityCollectionType.selection];
  source: "mouse" | "touch";
}): boolean {
  if (options.pointerEntity === null) {
    return false;
  }

  if (options.previousTool === "marquee") {
    return (
      options.source === "mouse"
      &&
      options.selection.length > 0
      && options.selection.contains(options.pointerEntity.id)
    );
  }

  if (options.previousTool !== "select") {
    return false;
  }

  options.editor.actions.clearCollection(EntityCollectionType.selection);
  options.editor.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId: options.pointerEntity.id,
  });

  return options.editor.state.collections[EntityCollectionType.selection].contains(
    options.pointerEntity.id,
  );
}

function didMouseSelectEnterMutateSelection(options: {
  pointerEntity: WorldEntity | null;
  previousTool: AppHost["internalState"]["activeTool"];
  source: "mouse" | "touch";
}): boolean {
  return (
    options.previousTool === "select"
    && options.pointerEntity !== null
  );
}

function restoreFailedEnterMove(options: {
  appHost: AppHost;
  editor: EditorContract;
  selectedEntityIds: readonly string[];
  previousTool: AppHost["internalState"]["activeTool"];
}): void {
  safelyCancelMoveDraft(options.editor);
  clearMoveUi(options.appHost);
  options.appHost.internalActions.setActiveTool(options.previousTool);

  try {
    options.editor.actions.clearCollection(EntityCollectionType.selection);

    for (const entityId of options.selectedEntityIds) {
      options.editor.actions.addToCollection({
        collectionType: EntityCollectionType.selection,
        entityId,
      });
    }
  } catch {
    // Selection restoration is best-effort after a failed move enter.
  }
}

function handleMoveTouchDragStart(options: {
  appHost: AppHost;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
}): GestureHandleResult {
  return primeMoveAnchorFromPreview({
    ...options,
    hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
  });
}

function handleMoveMouseDragStart(options: {
  appHost: AppHost;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton !== 0) {
    return { status: "ignored" };
  }

  if (options.appHost.internalState.runtime.movePointerMode === "mouse") {
    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    options.editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      options.position,
    );
    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (
      beforeRect !== null
      && movedRect !== null
      && didPreviewRectChange(beforeRect, movedRect)
    ) {
      rotateMovePreviewToBuildingSnap({
        appHost: options.appHost,
        editor: options.editor,
        trigger: "after-move",
        currentMousePosition: options.position,
      });
    }
    return { status: "handled" };
  }

  if (options.appHost.internalState.runtime.moveAnchor !== null) {
    return { status: "handled" };
  }

  return primeMoveAnchorFromPreview({
    appHost: options.appHost,
    editor: options.editor,
    entityDefinitionMap: options.entityDefinitionMap,
    position: options.position,
  });
}

function primeMoveAnchorFromPreview(options: {
  appHost: AppHost;
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
  hitSlopPx?: number;
}): GestureHandleResult {
  try {
    if (!isPreviewEntityAtClientPoint({
      editor: options.editor,
      entityDefinitionMap: options.entityDefinitionMap,
      position: options.position,
      hitSlopPx: options.hitSlopPx,
    })) {
      options.appHost.internalState.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.editor.queries.findGridCellForClientPixelPoint(
      options.position,
    );

    if (anchor === null) {
      options.appHost.internalState.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    options.appHost.internalState.runtime.moveAnchor = anchor;
    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
}

function driveMovePreview(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
  allowMouseEntryAnchorInit: boolean;
}): GestureHandleResult {
  try {
    if (options.appHost.internalState.runtime.movePointerMode === "mouse") {
      return driveMouseMovePreview(options);
    }

    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (beforeRect === null) {
      options.appHost.internalState.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    const moveAnchor = resolveMovePreviewAnchor({
      appHost: options.appHost,
      beforeRect,
      allowMouseEntryAnchorInit: options.allowMouseEntryAnchorInit,
    });

    if (moveAnchor === null) {
      return { status: "ignored" };
    }

    if (options.appHost.internalState.runtime.moveAnchor === null) {
      options.appHost.internalState.runtime.moveAnchor = moveAnchor;
    }

    const nextGridPoint = resolveMovePreviewTargetGridPoint({
      editor: options.editor,
      position: options.position,
      moveAnchor,
    });

    if (nextGridPoint === null) {
      return { status: "ignored" };
    }

    if (areGridPointsEqual(moveAnchor, nextGridPoint)) {
      return { status: "handled" };
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: moveAnchor,
      endGridPoint: nextGridPoint,
    });

    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && didPreviewRectChange(beforeRect, movedRect)) {
      rotateMovePreviewToBuildingSnap({
        appHost: options.appHost,
        editor: options.editor,
        trigger: "after-move",
        currentMousePosition: null,
      });
    }

    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (afterRect !== null) {
      options.appHost.internalState.runtime.moveAnchor = resolveTouchDragAnchorAfterPreviewMove({
        beforeRect,
        afterRect,
        startGridPoint: moveAnchor,
        endGridPoint: nextGridPoint,
      });

      if (didPreviewRectChange(beforeRect, afterRect)) {
        options.appHost.internalActions.alignCanvasFloatingToolbar();
      }
    }

    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
}

function driveMouseMovePreview(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  const beforeRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );

  if (beforeRect === null) {
    return { status: "ignored" };
  }

  options.editor.actions.moveCollectionCenterPointTo(
    EntityCollectionType.preview,
    options.position,
  );
  const movedRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (movedRect !== null && !areGridRectsEqual(beforeRect, movedRect)) {
    rotateMovePreviewToBuildingSnap({
      appHost: options.appHost,
      editor: options.editor,
      trigger: "after-move",
      currentMousePosition: options.position,
    });
  }
  const afterRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );

  if (afterRect !== null && !areGridRectsEqual(beforeRect, afterRect)) {
    options.appHost.internalActions.alignCanvasFloatingToolbar();
  }

  return { status: "handled" };
}

function resolveMovePreviewAnchor(options: {
  appHost: AppHost;
  beforeRect: GridRect;
  allowMouseEntryAnchorInit: boolean;
}): GridPoint | null {
  const currentAnchor = options.appHost.internalState.runtime.moveAnchor;

  if (currentAnchor !== null) {
    return currentAnchor;
  }

  if (
    !options.allowMouseEntryAnchorInit
    || options.appHost.internalState.runtime.movePointerMode !== "mouse"
  ) {
    return null;
  }

  return resolveGridCellCenterPoint(resolveGridRectCenterCell(options.beforeRect));
}

function resolveMovePreviewTargetGridPoint(options: {
  editor: EditorContract;
  position: GesturePosition;
  moveAnchor: GridPoint;
}): GridPoint | null {
  const gridCell = options.editor.queries.findGridCellForClientPixelPoint(
    options.position,
  );

  if (gridCell === null) {
    return null;
  }

  return usesGridCellCenterTracking(options.moveAnchor)
    ? resolveGridCellCenterPoint(gridCell)
    : gridCell;
}

function resolveGridRectCenterCell(gridRect: GridRect): GridPoint {
  return {
    x: gridRect.x + Math.floor((gridRect.width - 1) / 2),
    y: gridRect.y + Math.floor((gridRect.height - 1) / 2),
  };
}

function resolveGridCellCenterPoint(gridPoint: GridPoint): GridPoint {
  return {
    x: gridPoint.x + 0.5,
    y: gridPoint.y + 0.5,
  };
}

function usesGridCellCenterTracking(gridPoint: GridPoint): boolean {
  return !Number.isInteger(gridPoint.x) || !Number.isInteger(gridPoint.y);
}

function rotateMovePreview(
  appHost: AppHost,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): void {
  if (rotateMovePreviewToBuildingSnap({
    appHost,
    editor,
    trigger: "before-rotate",
    currentMousePosition,
  })) {
    appHost.internalActions.alignCanvasFloatingToolbar();
    return;
  }

  if (appHost.internalState.runtime.movePointerMode === "mouse") {
    editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
    if (
      currentMousePosition !== null
      && isClientPointInsideViewport(editor, currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        currentMousePosition,
      );
    }
    appHost.internalActions.alignCanvasFloatingToolbar();
    return;
  }

  editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  appHost.internalActions.alignCanvasFloatingToolbar();
}

function rotateMovePreviewToBuildingSnap(options: {
  readonly appHost: AppHost;
  readonly editor: EditorContract;
  readonly trigger: "after-move" | "before-rotate";
  readonly currentMousePosition: GesturePosition | null;
}): boolean {
  const isMouse = options.appHost.internalState.runtime.movePointerMode === "mouse";
  const clientPixelPoint = isMouse
    && options.currentMousePosition !== null
    && isClientPointInsideViewport(options.editor, options.currentMousePosition)
    ? options.currentMousePosition
    : null;

  return options.editor.actions.rotateCollectionToSnapOnBuilding({
    collectionType: EntityCollectionType.preview,
    trigger: options.trigger,
    pivotMode: isMouse ? "center" : "pivot-cell",
    clientPixelPoint,
  });
}

function switchMovePreviewVariant(
  appHost: AppHost,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): GestureHandleResult {
  if (appHost.state.moveKind !== "ordinary") {
    return { status: "ignored" };
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (previewEntity === null) {
    return { status: "ignored" };
  }

  const beforeRect = editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (beforeRect === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    appHost,
    definitionId: previewEntity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  const moveAnchor = appHost.internalState.runtime.moveAnchor;
  if (!editor.actions.replaceEntityDefinition(previewEntity.id, nextDefinitionId)) {
    return { status: "ignored" };
  }

  if (appHost.internalState.runtime.movePointerMode === "mouse") {
    if (
      currentMousePosition !== null
      && isClientPointInsideViewport(editor, currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        currentMousePosition,
      );
    }
  } else if (moveAnchor !== null) {
    preserveMoveAnchorAfterVariantSwitch({
      editor,
      moveAnchor,
      beforeRect,
    });
  }

  appHost.internalActions.alignCanvasFloatingToolbar();
  syncMoveEntryUi(appHost);
  return { status: "handled" };
}

function preserveMoveAnchorAfterVariantSwitch(options: {
  editor: EditorContract;
  moveAnchor: GridPoint;
  beforeRect: GridRect;
}): void {
  const afterRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (afterRect === null) {
    return;
  }

  if (usesGridCellCenterTracking(options.moveAnchor)) {
    const afterCenter = resolveGridCellCenterPoint(resolveGridRectCenterCell(afterRect));
    if (areGridPointsEqual(afterCenter, options.moveAnchor)) {
      return;
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: afterCenter,
      endGridPoint: options.moveAnchor,
    });
    return;
  }

  const anchorOffset = {
    x: clamp(
      options.moveAnchor.x - options.beforeRect.x,
      0,
      Math.max(0, afterRect.width - 1),
    ),
    y: clamp(
      options.moveAnchor.y - options.beforeRect.y,
      0,
      Math.max(0, afterRect.height - 1),
    ),
  };
  const nextTopLeft = {
    x: options.moveAnchor.x - anchorOffset.x,
    y: options.moveAnchor.y - anchorOffset.y,
  };

  if (afterRect.x === nextTopLeft.x && afterRect.y === nextTopLeft.y) {
    return;
  }

  options.editor.actions.moveCollectionTo({
    collectionType: EntityCollectionType.preview,
    startGridPoint: {
      x: afterRect.x,
      y: afterRect.y,
    },
    endGridPoint: nextTopLeft,
  });
}

function applyMoveOperation(
  appHost: AppHost,
  editor: EditorContract,
  source: "mouse" | "touch",
): void {
  const shouldReturnToMarquee = appHost.internalState.runtime.moveEnterFrom === "marquee";

  try {
    const applied = editor.actions.applyMoveOerationDraft();
    if (!applied) {
      return;
    }
  } catch {
    safelyCancelMoveDraft(editor);
  }

  clearMoveUi(appHost);
  appHost.internalActions.setActiveTool("select");
  if (!shouldReturnToMarquee) {
    clearSingleSelectionIfNotInspectorMode(appHost, editor);
  }
  if (shouldReturnToMarquee) {
    triggerPlacementMarqueeToolTap(appHost, source);
  }
}

function copyMoveOperation(options: {
  appHost: AppHost;
  editor: EditorContract;
  source: "mouse" | "touch";
  currentMousePosition: GesturePosition | null;
}): GestureHandleResult {
  if (!options.appHost.state.settings.hypergryphCopyWhileMoving) {
    return { status: "ignored" };
  }

  const blueprint = createMovePreviewBlueprintDocument({
    workspace: options.appHost.workspace,
    name: "Temp Blueprint",
  });
  if (blueprint === null) {
    return { status: "ignored" };
  }

  const placementAnchor = blueprint.initialGridPoint;
  const record = {
    ...blueprint,
    parentFolderId: null,
  };

  try {
    options.editor.actions.cancelMoveOperationDraft();
  } catch {
    return { status: "ignored" };
  }

  clearMoveUi(options.appHost);
  options.editor.actions.clearCollection(EntityCollectionType.selection);
  return placeBlueprintFromMoveAndContinue({
    appHost: options.appHost,
    editor: options.editor,
    record,
    source: options.source,
    placementAnchor,
    currentMousePosition: options.currentMousePosition,
  });
}

function cancelMoveOperation(
  appHost: AppHost,
  editor: EditorContract,
  source: "mouse" | "touch",
): void {
  const shouldReturnToMarquee = appHost.internalState.runtime.moveEnterFrom === "marquee";

  try {
    editor.actions.cancelMoveOperationDraft();
  } finally {
    clearMoveUi(appHost);
    appHost.internalActions.setActiveTool("select");
    if (!shouldReturnToMarquee) {
      clearSingleSelectionIfNotInspectorMode(appHost, editor);
    }
    if (shouldReturnToMarquee) {
      triggerPlacementMarqueeToolTap(appHost, source);
    }
  }
}

/**
 * 在移动模式下按 F 键删除当前设备。
 * 先取消移动草稿，再删除 selection 中的实体，最后清理 UI 并恢复工具状态。
 */
function deleteMoveOperation(
  appHost: AppHost,
  editor: EditorContract,
): void {
  const shouldReturnToMarquee = appHost.internalState.runtime.moveEnterFrom === "marquee";

  try {
    editor.actions.cancelMoveOperationDraft();
    editor.actions.deleteCollection(EntityCollectionType.selection);
  } finally {
    clearMoveUi(appHost);
    appHost.internalActions.setActiveTool(shouldReturnToMarquee ? "marquee" : "select");
  }
}

export function cleanupMoveOperationDraft(appHost: AppHost): void {
  const editor = appHost.workspace.editor;
  if (editor !== null) {
    safelyCancelMoveDraft(editor);
  }

  clearMoveUi(appHost);
}

function clearMoveUi(appHost: AppHost): void {
  appHost.internalState.runtime.moveAnchor = null;
  appHost.internalState.runtime.moveEnterFrom = null;
  appHost.internalState.runtime.movePointerMode = null;
  appHost.internalActions.hideCanvasFloatingToolbar();
  appHost.internalActions.hideCanvasRightDockToolbar();
}

/**
 * 从 Move 返回 Select 时，如果是单选且未开启"再次点击打开设备属性"，则取消选择。
 * 与 select gesture 中对已选中实体的二次点击行为保持一致。
 */
function clearSingleSelectionIfNotInspectorMode(
  appHost: AppHost,
  editor: EditorContract,
): void {
  if (appHost.state.settings.hypergryphInspectorOpenOnSecondClick) {
    return;
  }

  const selection = editor.state.collections[EntityCollectionType.selection];

  if (selection.length === 1) {
    editor.actions.clearCollection(EntityCollectionType.selection);
  }
}

function syncMoveEntryUi(appHost: AppHost): boolean {
  const pointerMode = appHost.internalState.runtime.movePointerMode;
  if (pointerMode === null) {
    appHost.internalActions.hideCanvasRightDockToolbar();
    return true;
  }

  if (pointerMode !== "touch") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.showCanvasRightDockToolbar(
      resolveMoveRightDockToolbarItems(appHost),
    );
    return true;
  }

  appHost.internalActions.hideCanvasRightDockToolbar();
  return appHost.internalActions.showCanvasFloatingToolbarForCollection(
    resolveMoveToolbarButtonIds(appHost),
    EntityCollectionType.preview,
  );
}

function resolveMoveRightDockToolbarItems(
  appHost: AppHost,
): readonly CanvasRightDockToolbarItemRequest[] {
  if (appHost.state.moveKind !== "ordinary") {
    return BATCH_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  const editor = appHost.workspace.editor;
  if (editor === null || editor === undefined) {
    return ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (
    previewEntity === null
    || !canSwitchEntityVariantDefinition({
      appHost,
      definitionId: previewEntity.definitionId,
    })
  ) {
    return ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  return ORDINARY_MOVE_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT;
}

function resolveMoveToolbarButtonIds(
  appHost: AppHost,
): readonly CanvasFloatingToolbarButtonId[] {
  if (appHost.state.moveKind !== "ordinary") {
    return resolveBaseMoveToolbarButtonIds(appHost);
  }

  const editor = appHost.workspace.editor;
  if (editor === null || editor === undefined) {
    return resolveBaseMoveToolbarButtonIds(appHost);
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (
    previewEntity === null
    || !canSwitchEntityVariantDefinition({
      appHost,
      definitionId: previewEntity.definitionId,
    })
  ) {
    return resolveBaseMoveToolbarButtonIds(appHost);
  }

  const buttonIds: CanvasFloatingToolbarButtonId[] = [
    "canvas-floating-toolbar-button-cancel",
    SWITCH_DEVICE_MODE_BUTTON_ID,
  ];
  if (appHost.state.settings.hypergryphCopyWhileMoving) {
    buttonIds.push("canvas-floating-toolbar-button-copy");
  }
  buttonIds.push(
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  );
  return buttonIds;
}

function resolveBaseMoveToolbarButtonIds(
  appHost: AppHost,
): readonly CanvasFloatingToolbarButtonId[] {
  if (appHost.state.settings.hypergryphCopyWhileMoving) {
    return MOVE_TOOLBAR_BUTTON_IDS;
  }

  return [
    "canvas-floating-toolbar-button-cancel",
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  ];
}

function triggerPlacementMarqueeToolTap(
  appHost: AppHost,
  source: "mouse" | "touch",
): void {
  const modifiers = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  if (source === "touch") {
    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: PLACEMENT_MARQUEE_TOOL_BUTTON_ID,
      ...modifiers,
    });
    return;
  }

  appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: PLACEMENT_MARQUEE_TOOL_BUTTON_ID,
    button: 0,
    ...modifiers,
  });
}

function safelyCancelMoveDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelMoveOperationDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; move should not leave UI half-entered.
  }
}

// AI-REMOVED 2026-08-30:
// Reason: 旧辅助函数绕过 Action Route，自行决定 modifier 匹配，造成运行时与设置冲突判定可漂移。
// Trigger: ST2-RQ-020 要求作用域和触发策略来自实际可执行路由。
// Evidence: 全仓调用检索仅命中这些定义；移动模式键盘入口已全部注册为 shortcutRoutes。
// Replacement: createHypergryphMoveGestureModule().shortcutRoutes
// Risk: Low
// Human Review: Required
//
// Original code:
/*
function isRotateMoveShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): boolean {
  // AI-REMOVED 2026-08-02:
  // Reason: 移动模式快捷键不再拒绝修饰键组合
  // Trigger: Ctrl 连续放置时按 R 误触 Ctrl+R 旋转画布；用户要求放置/移动模式快捷键可与任意 modifier 组合
  // Evidence: 事件路由按注册顺序分发，本模块消费 key down 后 viewport-rotation 模块不再收到
  // Replacement: 移除 modifier 检查，isShortcutFor 未传 modifiers 时仅匹配主键
  // Risk: 移动模式下 Ctrl+R 不再旋转画布（预期）
  // Human Review: Required
  //
  // if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
  //   return false;
  // }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.ROTATE,
    options.code,
    options.key,
  );
}

function isDeleteDeviceShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): boolean {
  // AI-REMOVED 2026-08-02:
  // Reason: 移动模式快捷键不再拒绝修饰键组合
  // Trigger: 用户要求放置/移动模式快捷键可与任意 modifier 组合（如 Ctrl+F 删除设备）
  // Evidence: 事件路由按注册顺序分发，本模块消费 key down 后后续模块不再收到
  // Replacement: 移除 modifier 检查，isShortcutFor 未传 modifiers 时仅匹配主键
  // Risk: 浏览器级组合键 Ctrl+F（查找）无法被 JS 完全拦截，可能同时触发删除设备与浏览器查找
  // Human Review: Required
  //
  // if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
  //   return false;
  // }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.DELETE_DEVICE,
    options.code,
    options.key,
  );
}

function isSwitchDeviceModeShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): boolean {
  // AI-REMOVED 2026-08-02:
  // Reason: 移动模式快捷键不再拒绝修饰键组合
  // Trigger: 用户要求放置/移动模式快捷键可与任意 modifier 组合
  // Evidence: 事件路由按注册顺序分发，本模块消费 key down 后后续模块不再收到
  // Replacement: 移除 modifier 检查，isShortcutFor 未传 modifiers 时仅匹配主键
  // Risk: 移动模式下 Ctrl+Tab 同时触发切换设备变体与浏览器标签行为（浏览器组合键无法被 JS 完全拦截）
  // Human Review: Required
  //
  // if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
  //   return false;
  // }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.SWITCH_DEVICE_MODE,
    options.code,
    options.key,
  );
}
*/

function resolveSinglePreviewEntity(editor: EditorContract): WorldEntity | null {
  const preview = editor.state.collections[EntityCollectionType.preview];
  if (preview.length !== 1) {
    return null;
  }

  const entityId = preview[0];
  if (entityId === undefined) {
    return null;
  }

  return editor.queries.getEntityById(entityId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function isPreviewEntityAtClientPoint(options: {
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
  hitSlopPx?: number;
}): boolean {
  void options.entityDefinitionMap;
  return isPreviewBoundingBoxAtClientPoint({
    editor: options.editor,
    position: options.position,
    hitSlopPx: options.hitSlopPx,
  });
}

// AI-REMOVED 2026-07-06:
// Reason: 移动端 move drag start 需要按当前 preview 包围盒命中，而不是逐个 preview 实体 footprint 命中；否则包围盒仍可见但实体虚影已移出屏幕时无法再次拖动。
// Trigger: 用户需求——移动端放置和移动模式在 drag start 时判断当前位置是否在虚影包围盒内。
// Evidence: Search-First 定位到 primeMoveAnchorFromPreview 仅通过 isPreviewEntityAtClientPoint 命中实体 footprint；新实现统一使用 isPreviewBoundingBoxAtClientPoint。
// Replacement: isPreviewEntityAtClientPoint -> isPreviewBoundingBoxAtClientPoint
// Risk: Low；命中范围扩大到 preview 包围盒，符合移动端多设备/蓝图拖动需求。
// Human Review: Required
//
// Original code:
// function isGridCellInsideEntity(options: {
//   cell: GridPoint;
//   entity: WorldEntity;
//   footprint: EntityDefinition["footprint"];
// }): boolean {
//   const footprint = getRotatedGridFootprint(
//     options.footprint,
//     options.entity.rotation,
//   );
//
//   return (
//     options.cell.x >= options.entity.position.x
//     && options.cell.x < options.entity.position.x + footprint.width
//     && options.cell.y >= options.entity.position.y
//     && options.cell.y < options.entity.position.y + footprint.height
//   );
// }

// AI-REMOVED 2026-07-11:
// Reason: 移动模式触控拖动吸附设备时，旧函数要求 footprint 完全按手指向量移动，无法表达沿边吸附的单轴跟随行为。
// Trigger: 用户反馈移动端净水节点吸附后，拖动位移被异常放大。
// Evidence: driveMovePreview 已改用 resolveTouchDragAnchorAfterPreviewMove 按轴更新 moveAnchor。
// Replacement: src/app/input/gesture/actions/hypergryph/mobile-preview-bounds.ts resolveTouchDragAnchorAfterPreviewMove
// Risk: Low；普通非吸附拖动在两个轴上仍会得到相同 anchor 更新结果。
// Human Review: Required
//
// Original code:
// function didRectMoveByGridVector(options: {
//   beforeRect: GridRect;
//   afterRect: GridRect;
//   startGridPoint: GridPoint;
//   endGridPoint: GridPoint;
// }): boolean {
//   const vector = {
//     x: options.endGridPoint.x - options.startGridPoint.x,
//     y: options.endGridPoint.y - options.startGridPoint.y,
//   };
//
//   return (
//     options.afterRect.x === options.beforeRect.x + vector.x
//     && options.afterRect.y === options.beforeRect.y + vector.y
//     && options.afterRect.width === options.beforeRect.width
//     && options.afterRect.height === options.beforeRect.height
//   );
// }

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function createEntityDefinitionMap(
  appHost: AppHost,
): ReadonlyMap<string, EntityDefinition> {
  return new Map(
    appHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
}
