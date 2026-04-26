import type { AppHost } from "@/app/app-host";
import type { GesturePosition } from "@/app/input/gesture-adapter";
import type { EditorContract } from "@/domain/contract/editor-contract";
import type { WorldEntity } from "@/domain/entity/world-document";
import { EntityCollectionType } from "@/domain/state/types";
import type { GridPoint, GridRect } from "@/domain/types/grid";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const MOVE_TOOLBAR_BUTTON_IDS = [
  "canvas-toolbar-button-ok",
  "canvas-toolbar-button-cancel",
] as const;

export function createHypergryphMoveGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-move-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (context.appHost.internalState.runtime.activeTool === "move") {
        switch (event.type) {
          case "mouse-long-press-ready":
          case "tap-long-press-ready":
            return { status: "handled" };

          case "mouse dragstart":
            return (
              event.originButton === 0
              && context.appHost.internalState.runtime.moveAnchor !== null
            )
              ? { status: "handled" }
              : { status: "ignored" };

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
            });

          case "mouse dragmove":
            if (event.originButton !== 0) {
              return { status: "ignored" };
            }

            return driveMovePreview({
              appHost: context.appHost,
              editor,
              position: event.position,
            });

          case "touch dragmove":
            return driveMovePreview({
              appHost: context.appHost,
              editor,
              position: event.position,
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
              cancelMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            if (event.button === 0 && !event.longPress) {
              applyMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            return { status: "handled" };

          case "ui-button-touch-tap":
            if (event.uiButtonId === "canvas-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-toolbar-button-cancel") {
              cancelMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            return { status: "ignored" };

          case "ui-button-mouse-tap":
            if (event.button !== 0) {
              return { status: "ignored" };
            }

            if (event.uiButtonId === "canvas-toolbar-button-ok") {
              applyMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            if (event.uiButtonId === "canvas-toolbar-button-cancel") {
              cancelMoveOperation(context.appHost, editor);
              return { status: "handled" };
            }

            return { status: "ignored" };

          default:
            return { status: "ignored" };
        }
      }

      switch (event.type) {
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

function tryEnterMoveMode(options: {
  appHost: AppHost;
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  position: GesturePosition;
  source: "mouse" | "touch";
}): GestureHandleResult {
  const previousTool = options.appHost.internalState.runtime.activeTool;

  if (
    previousTool !== "select"
    && previousTool !== "marquee"
  ) {
    return { status: "ignored" };
  }

  const selection = options.editor.state.collections[EntityCollectionType.selection];
  const selectedEntityIds = [...selection];

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

    options.editor.actions.createMoveOperationDraft();

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    const anchor = options.editor.queries.findGridCellForClientPixlePoint(
      options.position,
    );

    if (previewRect === null || anchor === null) {
      restoreFailedEnterMove({
        appHost: options.appHost,
        editor: options.editor,
        selectedEntityIds,
        previousTool,
      });
      return { status: "ignored" };
    }

    if (options.source === "touch") {
      if (!options.appHost.internalActions.showCanvasToolbarForCollection(
        MOVE_TOOLBAR_BUTTON_IDS,
        EntityCollectionType.preview,
      )) {
        restoreFailedEnterMove({
          appHost: options.appHost,
          editor: options.editor,
          selectedEntityIds,
          previousTool,
        });
        return { status: "ignored" };
      }

    } else {
      options.appHost.internalActions.hideCanvasToolbar();
    }

    options.appHost.internalState.runtime.moveAnchor = anchor;
    options.appHost.internalActions.setActiveTool("move");
    return { status: "handled" };
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

function prepareSelectionForMoveEnter(options: {
  editor: EditorContract;
  pointerEntity: WorldEntity | null;
  previousTool: AppHost["internalState"]["runtime"]["activeTool"];
  selection: EditorContract["state"]["collections"][typeof EntityCollectionType.selection];
  source: "mouse" | "touch";
}): boolean {
  if (options.pointerEntity === null) {
    return false;
  }

  if (options.source === "touch") {
    return (
      options.previousTool === "select"
      && options.selection.length > 0
      && options.selection.contains(options.pointerEntity.id)
    );
  }

  if (options.previousTool === "marquee") {
    return (
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
  previousTool: AppHost["internalState"]["runtime"]["activeTool"];
  source: "mouse" | "touch";
}): boolean {
  return (
    options.source === "mouse"
    && options.previousTool === "select"
    && options.pointerEntity !== null
  );
}

function restoreFailedEnterMove(options: {
  appHost: AppHost;
  editor: EditorContract;
  selectedEntityIds: readonly string[];
  previousTool: AppHost["internalState"]["runtime"]["activeTool"];
}): void {
  safelyCancelMoveDraft(options.editor);
  options.appHost.internalState.runtime.moveAnchor = null;
  options.appHost.internalActions.hideCanvasToolbar();
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
}): GestureHandleResult {
  try {
    const moveAnchor = options.appHost.internalState.runtime.moveAnchor;
    if (moveAnchor === null) {
      return { status: "ignored" };
    }

    const nextGridPoint = options.editor.queries.findGridCellForClientPixlePoint(
      options.position,
    );

    if (nextGridPoint === null) {
      return { status: "ignored" };
    }

    if (areGridPointsEqual(moveAnchor, nextGridPoint)) {
      return { status: "handled" };
    }

    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (beforeRect === null) {
      options.appHost.internalState.runtime.moveAnchor = null;
      return { status: "ignored" };
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
      options.appHost.internalActions.alignCanvasToolbar();
    }

    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.moveAnchor = null;
    return { status: "ignored" };
  }
}

function applyMoveOperation(appHost: AppHost, editor: EditorContract): void {
  try {
    editor.actions.applyMoveOerationDraft();
  } catch {
    safelyCancelMoveDraft(editor);
  } finally {
    clearMoveUi(appHost);
    appHost.internalActions.setActiveTool("select");
  }
}

function cancelMoveOperation(appHost: AppHost, editor: EditorContract): void {
  try {
    editor.actions.cancelMoveOperationDraft();
  } finally {
    clearMoveUi(appHost);
    appHost.internalActions.setActiveTool("select");
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
  appHost.internalActions.hideCanvasToolbar();
}

function safelyCancelMoveDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelMoveOperationDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; move should not leave UI half-entered.
  }
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
