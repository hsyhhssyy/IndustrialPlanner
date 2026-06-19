import { describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphMoveGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import {
  EntityCollectionType,
  type EntityCollectionType as EntityCollectionTypeValue,
} from "@/domain/editor/types/editor-types";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";

describe("createHypergryphMoveGestureModule", () => {
  it("enters mouse move from select by selecting the pointer entity first", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 4, y: 4 },
    );
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("select");
    expect(appHost.internalActions.hideCanvasFloatingToolbar).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(appHost.internalActions.hideCanvasFloatingToolbar).toHaveBeenCalled();
  });

  it("requires an existing selection when mouse move enters from marquee", () => {
    const missed = createContext({
      activeTool: "marquee",
    });
    const handled = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const missedResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      missed.context,
    );

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      handled.context,
    );

    expect(missedResult).toEqual({ status: "ignored" });
    expect(missed.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(missed.appHost.internalState.activeTool).toBe("marquee");
    expect(result).toEqual({ status: "handled" });
    expect(handled.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(handled.appHost.internalState.activeTool).toBe("move");
    expect(handled.appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(handled.editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 2, y: 2 },
    );
    expect(handled.appHost.internalState.runtime.moveEnterFrom).toBe("marquee");
  });

  it("enters touch move from select by selecting the pointer entity first", () => {
    const marquee = createContext({
      activeTool: "marquee",
    });
    const select = createContext();
    const module = createHypergryphMoveGestureModule();

    const marqueeResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      marquee.context,
    );
    const selectResult = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      select.context,
    );

    expect(marqueeResult).toEqual({ status: "ignored" });
    expect(marquee.editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
    expect(selectResult).toEqual({ status: "handled" });
    expect(select.editor.actions.clearCollection).toHaveBeenCalledWith(
      EntityCollectionType.selection,
    );
    expect(select.editor.actions.addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "unselected-entity",
    });
    expect(select.editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(select.appHost.internalState.activeTool).toBe("move");
    expect(select.appHost.internalState.runtime.moveEnterFrom).toBe("select");
    expect(select.appHost.internalActions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "move"), select.context),
    ).toEqual({ status: "handled" });
    expect(select.appHost.internalActions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from the marquee right dock button and initializes the touch move ui", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("marquee");
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "move"), context),
    ).toEqual({ status: "handled" });
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("enters move from marquee via M key shortcut when selection is non-empty", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      keyDownEvent({ code: "KeyM", key: "m" }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("marquee");
  });

  it("enters move from select via M key shortcut when selection is non-empty", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      keyDownEvent({ code: "KeyM", key: "m" }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("select");
  });

  it("ignores M key shortcut when selection is empty", () => {
    const { context, editor, selection } = createContext();
    const module = createHypergryphMoveGestureModule();

    // Clear selection
    selection.replace([]);

    const result = module.handle(
      keyDownEvent({ code: "KeyM", key: "m" }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createMoveOperationDraft).not.toHaveBeenCalled();
  });

  it("moves mouse-entered preview by collection center point", () => {
    const { context, editor, appHost, previewRectRef } = createContext({
      previewRect: {
        x: 9,
        y: 17,
        width: 4,
        height: 8,
      },
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.moveCollectionCenterPointTo).mockImplementation((_, point) => {
      previewRectRef.current = {
        ...previewRectRef.current,
        x: point.x,
        y: point.y,
      };
    });

    expect(
      module.handle(uiButtonMouseTapEvent("canvas-floating-toolbar-button-move"), context),
    ).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 20, y: 30 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      1,
      EntityCollectionType.preview,
      { x: 20, y: 30 },
    );
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseMoveEvent({ position: { x: 21, y: 31 } }), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenNthCalledWith(
      2,
      EntityCollectionType.preview,
      { x: 21, y: 31 },
    );
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
  });

  it("enters move from the select floating button with touch and initializes the touch move ui", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("canvas-floating-toolbar-button-move"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.createMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("select");
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("moves the mouse preview center from drag start after entering move from the right dock button", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-right-dock-toolbar-button-move"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    const dragStartResult = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(dragStartResult).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 5, y: 5 },
    );
  });

  it("rolls back draft state and restores selection when entering move cannot create a preview", () => {
    const { context, editor, appHost, selection, preview } = createContext();
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
      selection.replace([]);
      preview.replace([]);
    });

    const result = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBeNull();
  });

  it("restores the original selection when touch move enter fails after retargeting selection", () => {
    const { context, editor, selection, preview } = createContext();
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
      selection.replace([]);
      preview.replace([]);
    });

    const result = module.handle(
      tapLongPressReadyEvent({
        pointerEntity: entity("unselected-entity", { x: 4, y: 4 }),
        position: { x: 4, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect([...selection]).toEqual(["selected-entity"]);
  });

  it("uses preview entity hit testing for touch drag start while already moving", () => {
    const { context, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    const originalEntityResult = module.handle(
      touchDragStartEvent({
        position: { x: 2, y: 2 },
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(originalEntityResult).toEqual({ status: "ignored" });
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

    const previewResult = module.handle(
      touchDragStartEvent({
        position: { x: 5, y: 5 },
        pointerEntity: null,
      }),
      context,
    );

    expect(previewResult).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
  });

  it("moves the preview by incremental grid vectors and follows it with the toolbar", () => {
    const { context, editor, appHost, previewRectRef } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
      startGridPoint,
      endGridPoint,
    }) => {
      previewRectRef.current = {
        ...previewRectRef.current,
        x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
        y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
      };
    });

    const result = module.handle(
      touchDragMoveEvent({
        position: { x: 6, y: 4 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 6, y: 4 });
    expect(appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview with the R key while moving", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyR", key: "r" }), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalActions.isShortcutFor).toHaveBeenCalledWith(
      SHORTCUT_KEY.ROTATE,
      "KeyR",
      "r",
    );
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the mouse move preview around center and snaps it back to the current mouse", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      movePointerMode: "mouse",
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 24, y: 32 } }), context)).toEqual({
      status: "handled",
    });
    vi.mocked(editor.actions.moveCollectionCenterPointTo).mockClear();

    const result = module.handle(keyDownEvent({ code: "KeyR", key: "r" }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundCenterPoint).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(editor.actions.moveCollectionCenterPointTo).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      { x: 24, y: 32 },
    );
    expect(appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("rotates the preview from the rotate toolbar button while moving", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    const result = module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.rotateCollectionAroundPivotCell).toHaveBeenCalledWith(
      EntityCollectionType.preview,
      90,
    );
    expect(appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("switches the move preview variant, keeps the anchor, then continues moving and applies", () => {
    const { context, editor, appHost, previewRectRef } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "item_port_filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.moveCollectionTo).mockImplementation(({
      startGridPoint,
      endGridPoint,
    }) => {
      previewRectRef.current = {
        ...previewRectRef.current,
        x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
        y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
      };
    });

    expect(module.handle(keyDownEvent({ code: "Tab", key: "Tab" }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "preview-entity",
      "item_port_liquid_filling_pd_mc_1",
    );
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 12, y: 11 });

    expect(module.handle(touchDragMoveEvent({ position: { x: 13, y: 12 } }), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.moveCollectionTo).toHaveBeenLastCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 12, y: 11 },
      endGridPoint: { x: 13, y: 12 },
    });
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 13, y: 12 });

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("cancels a switched move preview without applying it", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 12, y: 11 },
      previewDefinitionId: "item_port_filling_pd_mc_1",
      previewRect: { x: 10, y: 10, width: 6, height: 4 },
      toolbarVisible: true,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledTimes(1);

    expect(module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context)).toEqual({
      status: "handled",
    });
    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.applyMoveOerationDraft).not.toHaveBeenCalled();
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
  });

  it("applies with a non-long-press left mouse tap and cancels with a right mouse tap", () => {
    const applyContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const cancelContext = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), applyContext.context),
    ).toEqual({ status: "handled" });
    expect(applyContext.editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(applyContext.appHost.internalState.activeTool).toBe("select");
    expect(applyContext.appHost.internalState.runtime.moveAnchor).toBeNull();

    expect(
      module.handle(mouseTapEvent({ button: 2, longPress: false }), cancelContext.context),
    ).toEqual({ status: "handled" });
    expect(cancelContext.editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(cancelContext.appHost.internalState.activeTool).toBe("select");
    expect(cancelContext.appHost.internalState.runtime.moveAnchor).toBeNull();
  });

  it("treats Ctrl+left-click as ordinary move apply when copy while moving is disabled", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({
        button: 0,
        longPress: false,
        modifiers: { ctrl: true },
      }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.cancelMoveOperationDraft).not.toHaveBeenCalled();
    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("hides the touch copy button when copy while moving is disabled", () => {
    const { context, appHost } = createContext({
      activeTool: "move",
      movePointerMode: "touch",
      copyWhileMoving: false,
    });
    const module = createHypergryphMoveGestureModule();

    expect(module.handle(onEnterActiveToolEvent("select", "move"), context)).toEqual({
      status: "handled",
    });
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      [
        "canvas-floating-toolbar-button-cancel",
        "canvas-floating-toolbar-button-rotate",
        "canvas-floating-toolbar-button-ok",
      ],
      EntityCollectionType.preview,
    );
  });

  it("keeps mouse move active when applying is rejected", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.applyMoveOerationDraft).mockReturnValue(false);

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(appHost.internalActions.setActiveTool).not.toHaveBeenCalled();
  });

  it("keeps touch move active when applying is rejected", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
    });
    const module = createHypergryphMoveGestureModule();

    vi.mocked(editor.actions.applyMoveOerationDraft).mockReturnValue(false);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 5 });
    expect(appHost.internalActions.setActiveTool).not.toHaveBeenCalled();
  });

  it("returns to marquee through a mouse tool tap when mouse applying a marquee-entered move", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBeNull();
    expect(appHost.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(appHost.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("returns to marquee through a touch tool tap when touch cancelling a marquee-entered move", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.cancelMoveOperationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.moveEnterFrom).toBeNull();
    expect(appHost.gestureAdapter.handleUiButtonTouchTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(appHost.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
  });

  it("does not return to marquee after active exits from a select-entered move", () => {
    const { context, appHost } = createContext({
      activeTool: "move",
      moveAnchor: { x: 5, y: 5 },
      moveEnterFrom: "select",
    });
    const module = createHypergryphMoveGestureModule();

    expect(
      module.handle(mouseTapEvent({ button: 0, longPress: false }), context),
    ).toEqual({ status: "handled" });

    expect(appHost.gestureAdapter.handleUiButtonMouseTap).not.toHaveBeenCalled();
    expect(appHost.gestureAdapter.handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("preserves selection through the marquee → move → marquee round-trip", () => {
    const { context, editor, appHost, selection, preview } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMoveGestureModule();

    // The real createMoveOperationDraft reads from selection but does NOT clear it.
    // Override the mock to match the real implementation.
    vi.mocked(editor.actions.createMoveOperationDraft).mockImplementation(() => {
      const sourceEntityIds = [...selection];
      preview.replace(["preview-entity"]);
      (editor.state.collections[EntityCollectionType.ghost] as MockCollection).replace(sourceEntityIds);
    });

    // Push a second entity into selection so the round-trip preserves multiple entities.
    selection.push("another-selected");

    // Enter move from marquee via mouse long-press.
    const enterResult = module.handle(
      mouseLongPressReadyEvent({
        pointerEntity: entity("selected-entity", { x: 2, y: 2 }),
      }),
      context,
    );

    expect(enterResult).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveEnterFrom).toBe("marquee");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // Apply the move — the module should trigger a return to marquee
    // without clearing selection.
    const applyResult = module.handle(
      mouseTapEvent({ button: 0, longPress: false }),
      context,
    );

    expect(applyResult).toEqual({ status: "handled" });
    expect(editor.actions.applyMoveOerationDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalActions.setActiveTool).toHaveBeenCalledWith("select");
    expect([...selection]).toEqual(["selected-entity", "another-selected"]);

    // The marquee re-entry is delegated to the marquee gesture module via
    // handleUiButtonMouseTap — selection clearing (or preservation) at that
    // point is the marquee module's responsibility.
    expect(appHost.gestureAdapter.handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  });
});

function createContext(options: {
  activeTool?: ActiveTool;
  moveAnchor?: GridPoint | null;
  moveEnterFrom?: ActiveTool | null;
  movePointerMode?: "mouse" | "touch" | null;
  toolbarVisible?: boolean;
  previewRect?: GridRect;
  previewDefinitionId?: string;
  copyWhileMoving?: boolean;
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
  appHost: AppHost;
  selection: MockCollection;
  preview: MockCollection;
  previewRectRef: { current: GridRect };
} {
  const selection = createCollection(["selected-entity"]);
  const marquee = createCollection([]);
  const reverseMarquee = createCollection([]);
  const preview = createCollection(["preview-entity"]);
  const ghost = createCollection([]);
  const previewRectRef = {
    current: options.previewRect ?? {
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    },
  };
  const previewEntity = entity(
    "preview-entity",
    { x: previewRectRef.current.x, y: previewRectRef.current.y },
    options.previewDefinitionId,
  );
  const selectedEntity = entity("selected-entity", { x: 2, y: 2 });
  const unselectedEntity = entity("unselected-entity", { x: 4, y: 4 });
  const shortcuts: Record<string, string> = {
    [SHORTCUT_KEY.ROTATE]: "R",
    [SHORTCUT_KEY.SWITCH_DEVICE_MODE]: "Tab",
    [SHORTCUT_KEY.MOVE_SELECTION]: "M",
  };
  const editor: MockEditor = {
    state: {
      viewport: {
        center: { x: 0, y: 0 },
        clientRect: { left: 0, top: 0, width: 100, height: 100 },
        gridSize: 1,
        gridCellPixelSize: 1,
        displayRotation: 0,
      },
      collections: {
        [EntityCollectionType.selection]: selection,
        [EntityCollectionType.marquee]: marquee,
        [EntityCollectionType.reverseMarquee]: reverseMarquee,
        [EntityCollectionType.preview]: preview,
        [EntityCollectionType.ghost]: ghost,
        [EntityCollectionType.logisticsHead]: createCollection([]),
        [EntityCollectionType.powered]: createCollection([]),
        [EntityCollectionType.invalidPlacement]: createCollection([]),
      },
    },
    queries: {
      getEntityById: vi.fn((entityId: string) => {
        if (entityId === "preview-entity") {
          return previewEntity;
        }

        if (entityId === "selected-entity") {
          return selectedEntity;
        }

        if (entityId === "unselected-entity") {
          return unselectedEntity;
        }

        return null;
      }),
      findEntityCollectionGridRect: vi.fn((collectionType) =>
        collectionType === EntityCollectionType.preview && preview.length > 0
          ? previewRectRef.current
          : null,
      ),
      findGridCellForClientPixelPoint: vi.fn((point) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      })),
      findClientRectForGridCell: vi.fn((cell) => ({
        left: cell.x * 16,
        top: cell.y * 16,
        width: 16,
        height: 16,
      })),
    },
    actions: {
      createMoveOperationDraft: vi.fn(() => {
        const sourceEntityIds = [...selection];
        selection.replace([]);
        preview.replace(["preview-entity"]);
        ghost.replace(sourceEntityIds);
      }),
      cancelMoveOperationDraft: vi.fn(() => {
        preview.replace([]);
        ghost.replace([]);
      }),
      applyMoveOerationDraft: vi.fn(() => true),
      moveCollectionTo: vi.fn(),
      moveCollectionCenterPointTo: vi.fn(),
      rotateCollection: vi.fn(),
      rotateCollectionAroundCenterPoint: vi.fn(),
      rotateCollectionAroundPivotCell: vi.fn(),
      replaceEntityDefinition: vi.fn((entityId: string, nextDefinitionId: string) => {
        if (entityId !== previewEntity.id) {
          return false;
        }

        previewEntity.definitionId = nextDefinitionId;
        previewEntity.config = {};
        return true;
      }),
      clearCollection: vi.fn((collectionType: EntityCollectionTypeValue) => {
        (editor.state.collections[collectionType] as MockCollection).replace([]);
      }),
      addToCollection: vi.fn(({
        collectionType,
        entityId,
      }: {
        collectionType: EntityCollectionTypeValue;
        entityId: string;
      }) => {
        const collection = editor.state.collections[collectionType] as MockCollection;
        if (!collection.contains(entityId)) {
          collection.push(entityId);
        }
      }),
    },
  };
  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
        hypergryphImmediateMove: true,
        hypergryphCopyWhileMoving: options.copyWhileMoving ?? false,
      },
    },
    internalState: {
      activeTool: options.activeTool ?? "select",
      runtime: {
        moveAnchor: options.moveAnchor ?? null,
        moveEnterFrom: options.moveEnterFrom ?? null,
        movePointerMode: options.movePointerMode ?? null,
        canvasFloatingToolbar: {
          visible: options.toolbarVisible ?? false,
          buttonIds: [],
          anchor: null,
          attachedCollection: null,
          measuredSize: null,
        },
      },
    },
    gestureAdapter: {
      handleUiButtonMouseTap: vi.fn(),
      handleUiButtonTouchTap: vi.fn(),
    },
    internalActions: {
      setActiveTool: vi.fn((activeTool) => {
        appHost.internalState.activeTool = activeTool;
      }),
      showCanvasFloatingToolbarForCollection: vi.fn((buttonIds, collectionType) => {
        if (editor.queries.findEntityCollectionGridRect(collectionType) === null) {
          return false;
        }

        appHost.internalState.runtime.canvasFloatingToolbar.visible = true;
        appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [...buttonIds];
        appHost.internalState.runtime.canvasFloatingToolbar.anchor = { x: 80, y: 72 };
        appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = collectionType;
        return true;
      }),
      alignCanvasFloatingToolbar: vi.fn(() => true),
      setCanvasFloatingToolbarSize: vi.fn(),
      hideCanvasFloatingToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasFloatingToolbar.visible = false;
        appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
      }),
      getKeyboardShortcutFor: vi.fn((key: string) => shortcuts[key] ?? ""),
      isShortcutFor: vi.fn((key: string, code: string | null, eventKey?: string | null) => {
        const shortcut = (shortcuts[key] ?? "")
          .trim()
          .toLowerCase();
        if (shortcut === "") {
          return false;
        }

        if ((eventKey ?? "").trim().toLowerCase() === shortcut) {
          return true;
        }

        if (shortcut.length === 1 && shortcut >= "a" && shortcut <= "z") {
          return code === `Key${shortcut.toUpperCase()}`;
        }

        if (shortcut.length === 1 && shortcut >= "0" && shortcut <= "9") {
          return code === `Digit${shortcut}` || code === `Numpad${shortcut}`;
        }

        return (code ?? "").trim().toLowerCase() === shortcut;
      }),
    },
    workspace: {
      editor,
      registry: createRegistryContract(),
    },
  } as unknown as AppHost;

  return {
    context: {
      workspace: {
        registry: appHost.workspace.registry,
        editor,
      } as unknown as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    editor,
    appHost,
    selection,
    preview,
    previewRectRef,
  };
}

type MockCollection = string[] & {
  contains(entityId: string): boolean;
  replace(entityIds: readonly string[]): void;
};

type MockEditor = {
  state: Pick<EditorContract["state"], "collections" | "viewport">;
  actions: Pick<
    EditorContract["actions"],
    | "addToCollection"
    | "applyMoveOerationDraft"
    | "cancelMoveOperationDraft"
    | "clearCollection"
    | "createMoveOperationDraft"
    | "moveCollectionCenterPointTo"
    | "moveCollectionTo"
    | "replaceEntityDefinition"
    | "rotateCollection"
    | "rotateCollectionAroundCenterPoint"
    | "rotateCollectionAroundPivotCell"
  >;
  queries: Pick<
    EditorContract["queries"],
    | "findClientRectForGridCell"
    | "findEntityCollectionGridRect"
    | "findGridCellForClientPixelPoint"
    | "getEntityById"
  >;
};

function createCollection(entityIds: readonly string[]): MockCollection {
  const collection = [...entityIds] as MockCollection;
  collection.contains = (entityId: string) => collection.includes(entityId);
  collection.replace = (nextEntityIds: readonly string[]) => {
    collection.splice(0, collection.length, ...nextEntityIds);
  };
  return collection;
}

function entity(
  id: string,
  position: GridPoint,
  definitionId = "belt_straight_1x1",
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function mouseLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse-long-press-ready" as const,
    gestureId: "mouse-ready-1",
    button: 0,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

const MOVE_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

function tapLongPressReadyEvent(options: {
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "tap-long-press-ready" as const,
    gestureId: "tap-ready-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  position: GridPoint;
  pointerEntity: WorldEntity | null;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    startPosition: options.position,
    activeTouchCount: 1,
    longPress: true,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "touch dragmove" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    delta: { x: 1, y: -1 },
    activeTouchCount: 1,
    longPress: true,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(options: {
  button: number;
  longPress: boolean;
  modifiers?: Partial<ReturnType<typeof emptyModifiers>>;
}) {
  return {
    type: "mouse tap" as const,
    gestureId: "mouse-tap-1",
    button: options.button,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress: options.longPress,
    pointerEntity: null,
    modifiers: {
      ...emptyModifiers(),
      ...options.modifiers,
    },
    sourceEvent: null,
  };
}

function mouseMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 1, y: 1 },
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function keyDownEvent(options: {
  code: string | null;
  key: string | null;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: options.key === null ? null : options.key.toUpperCase().charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function onEnterActiveToolEvent(from: ActiveTool, to: ActiveTool) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position,
    startPosition: options.position,
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: emptyModifiers(),
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
