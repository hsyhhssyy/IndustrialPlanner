import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const MOVE_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

const MOVE_ENTRY_BUTTON_IDS = {
  marquee: "canvas-right-dock-toolbar-button-move",
  select: "canvas-floating-toolbar-button-move",
} as const;
const PLACEMENT_MARQUEE_TOOL_BUTTON_ID = "placement-tool-marquee";

export function createHypergryphMoveGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-move-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
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

          case "key down":
            if (isSwitchDeviceModeShortcut({
              appHost: context.appHost,
              code: event.code,
              key: event.key,
              modifiers: event.modifiers,
            })) {
              return switchMovePreviewVariant(context.appHost, editor);
            }

            if (!isRotateMoveShortcut({
              appHost: context.appHost,
              code: event.code,
              key: event.key,
              modifiers: event.modifiers,
            })) {
              return { status: "ignored" };
            }

            rotateMovePreview(context.appHost, editor);
            return { status: "handled" };

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
              position: event.position,
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
              applyMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            return { status: "handled" };

          case "ui-button-touch-tap":
            if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
              return switchMovePreviewVariant(context.appHost, editor);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor, "touch");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
              rotateMovePreview(context.appHost, editor);
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
              return switchMovePreviewVariant(context.appHost, editor);
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor, "mouse");
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
              rotateMovePreview(context.appHost, editor);
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
          });

        case "mouse dragstart":
          if (
            event.originButton !== 0
            || !context.appHost.state.settings.hypergryphImmediateMove
          ) {
            return { status: "ignored" };
          }

          return tryEnterMoveMode({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            position: event.position,
            source: "mouse",
          });

        case "mouse-long-press-ready":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return tryEnterMoveMode({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            position: event.position,
            source: "mouse",
          });

        case "tap-long-press-ready":
          return tryEnterMoveMode({
            appHost: context.appHost,
            editor,
            pointerEntity: event.pointerEntity,
            position: event.position,
            source: "touch",
          });

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
}): GestureHandleResult {
  return tryEnterMoveModeFromSelection(options);
}

function tryEnterMoveMode(options: {
  appHost: AppHost;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  position: GesturePosition;
  source: "mouse" | "touch";
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
  const anchor = options.editor.queries.findGridCellForClientPixlePoint(
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
    options.appHost.internalState.runtime.moveAnchor = options.anchor;
    options.appHost.internalState.runtime.moveEnterFrom = options.previousTool;
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
  return primeMoveAnchorFromPreview(options);
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
}): GestureHandleResult {
  try {
    if (!isPreviewEntityAtClientPoint({
      editor: options.editor,
      entityDefinitionMap: options.entityDefinitionMap,
      position: options.position,
    })) {
      options.appHost.internalState.runtime.moveAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.editor.queries.findGridCellForClientPixlePoint(
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

    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (
      afterRect !== null
      && didRectMoveByGridVector({
        beforeRect,
        afterRect,
        startGridPoint: moveAnchor,
        endGridPoint: nextGridPoint,
      })
    ) {
      options.appHost.internalState.runtime.moveAnchor = nextGridPoint;
      options.appHost.internalActions.alignCanvasFloatingToolbar();
    }

    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
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
  const gridCell = options.editor.queries.findGridCellForClientPixlePoint(
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

function rotateMovePreview(appHost: AppHost, editor: EditorContract): void {
  editor.actions.rotateCollection(EntityCollectionType.preview);
  appHost.internalActions.alignCanvasFloatingToolbar();
}

function switchMovePreviewVariant(
  appHost: AppHost,
  editor: EditorContract,
): GestureHandleResult {
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

  if (moveAnchor !== null) {
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
    return true;
  }

  if (pointerMode !== "touch") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    return true;
  }

  return appHost.internalActions.showCanvasFloatingToolbarForCollection(
    resolveMoveToolbarButtonIds(appHost),
    EntityCollectionType.preview,
  );
}

function resolveMoveToolbarButtonIds(
  appHost: AppHost,
): readonly CanvasFloatingToolbarButtonId[] {
  const editor = appHost.workspace.editor;
  if (editor === null || editor === undefined) {
    return MOVE_TOOLBAR_BUTTON_IDS;
  }

  const previewEntity = resolveSinglePreviewEntity(editor);
  if (
    previewEntity === null
    || !canSwitchEntityVariantDefinition({
      appHost,
      definitionId: previewEntity.definitionId,
    })
  ) {
    return MOVE_TOOLBAR_BUTTON_IDS;
  }

  return [
    "canvas-floating-toolbar-button-cancel",
    SWITCH_DEVICE_MODE_BUTTON_ID,
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
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return false;
  }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.ROTATE,
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
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return false;
  }

  return options.appHost.internalActions.isShortcutFor(
    SHORTCUT_KEY.SWITCH_DEVICE_MODE,
    options.code,
    options.key,
  );
}

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

function isPreviewEntityAtClientPoint(options: {
  editor: EditorContract;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  position: GesturePosition;
}): boolean {
  const gridCell = options.editor.queries.findGridCellForClientPixlePoint(
    options.position,
  );

  if (gridCell === null) {
    return false;
  }

  const preview = options.editor.state.collections[EntityCollectionType.preview];
  for (let index = preview.length - 1; index >= 0; index -= 1) {
    const entityId = preview[index];
    if (entityId === undefined) {
      continue;
    }

    const entity = options.editor.queries.getEntityById(entityId);
    if (entity === null) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    if (
      isGridCellInsideEntity({
        cell: gridCell,
        entity,
        footprint: definition.footprint,
      })
    ) {
      return true;
    }
  }

  return false;
}

function isGridCellInsideEntity(options: {
  cell: GridPoint;
  entity: WorldEntity;
  footprint: EntityDefinition["footprint"];
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}

function didRectMoveByGridVector(options: {
  beforeRect: GridRect;
  afterRect: GridRect;
  startGridPoint: GridPoint;
  endGridPoint: GridPoint;
}): boolean {
  const vector = {
    x: options.endGridPoint.x - options.startGridPoint.x,
    y: options.endGridPoint.y - options.startGridPoint.y,
  };

  return (
    options.afterRect.x === options.beforeRect.x + vector.x
    && options.afterRect.y === options.beforeRect.y + vector.y
    && options.afterRect.width === options.beforeRect.width
    && options.afterRect.height === options.beforeRect.height
  );
}

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
