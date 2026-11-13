// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";
import { CanvasInteractionController } from "@/app/canvas";
import { createEditableCanvasScene } from "@/app/canvas/editable-canvas-scene";
import { attachCanvasInput } from "@/app/input";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import { createAppTestWorkspace } from "@/tests/helpers/app-test-workspace";

const releases: Array<() => void> = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });

function setup() {
  const { app } = createAppTestWorkspace();
  releases.push(() => app.dispose());
  const disabled = new Set<CanvasOperationId>();
  const policy = {
    getOperationAvailability: (operation: CanvasOperationId) => ({ supported: operation !== "copy", enabled: !disabled.has(operation), reason: null }),
    resolvePlacementAreaIds: () => ["canvas"], validateTransition: () => [],
  };
  const bounds = { minX: null, maxX: null, minY: null, maxY: null };
  const session = app.sceneFactories.createMemorySession({ id: "input-session",
    initialDocument: createWorldDocument({ baseId: "draft_box" }), initialIntent: null,
    reduceIntent: value => value, policy,
    space: { areas: [{ id: "canvas", bounds, outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] },
  });
  releases.push(() => session.dispose());
  const createCanvas = (id: string, preparePlacement?: () => Promise<void>) => {
    const view = app.sceneFactories.createView({ id,
      initialViewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
      bounds: { kind: "space", bounds, padding: 0 }, getOperationAvailability: policy.getOperationAvailability });
    view.actions.setViewportClientRect({ left: 20, top: 30, width: 800, height: 600 });
    releases.push(() => view.dispose());
    const canvas = new CanvasInteractionController({ view, registry: app.workspace.registry,
      readEditor: () => session.editor, readWorkbench: () => app, preparePlacement });
    releases.push(attachCanvasInput(canvas));
    return canvas;
  };
  return { app, session, disabled, createCanvas };
}

describe("canvas input ownership", () => {
  it("蓝图样式编辑画布实时继承名称与网格设置，不修改工作台风格且不启动仿真", () => {
    const { app, session } = setup();
    runInAction(() => {
      app.internalState.settings.gameShowDeviceNames = true;
      app.internalState.settings.gameAlwaysShowGridLines = true;
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
    });
    const owner = createEditableCanvasScene({ appHost: app, session, readPalette: () => [], readOverlay: () => null });
    releases.push(() => owner.dispose());
    const settings = () => owner.scene.input.presentation.getSnapshot().settings;
    expect(settings().gameShowDeviceNames).toBe(true);
    expect(settings().gameAlwaysShowGridLines).toBe(true);
    expect(settings().gameUseBlueprintStyleDeviceImages).toBe(true);
    expect(owner.scene.input.simulation).toBeNull();
    runInAction(() => {
      app.internalState.settings.gameShowDeviceNames = false;
      app.internalState.settings.gameAlwaysShowGridLines = false;
    });
    expect(settings().gameShowDeviceNames).toBe(false);
    expect(settings().gameAlwaysShowGridLines).toBe(false);
    expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
  });

  it.each(["ctrlKey", "shiftKey"] as const)("鼠标 %s 连续放置等待动态清单后保留虚影", async modifier => {
    const { createCanvas, session } = setup();
    let ready!: () => void;
    const pending = new Promise<void>(resolve => { ready = resolve; });
    const canvas = createCanvas("async-mouse-palette", () => pending);
    canvas.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "ui-left-dock-placement-mode-storager_1-mouse-tap", button: 0,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    });
    const pointer = { pointerId: 1, pointerType: "mouse", clientX: 420, clientY: 330,
      button: 0, buttons: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, [modifier]: true };
    canvas.gestureAdapter.handlePointerMove(pointer);
    canvas.gestureAdapter.handlePointerDown({ ...pointer, buttons: 1 });
    canvas.gestureAdapter.handlePointerUp(pointer);
    expect(session.editor.document.getSnapshot().entityOrder).toHaveLength(1);
    expect(session.editor.state.collections.preview).toHaveLength(0);
    expect(canvas.state.runtime.singlePlacementContinuous).toBe(false);
    ready();
    await expect.poll(() => session.editor.state.collections.preview.length).toBe(1);
    expect(canvas.state.activeTool).toBe("single-placement");
  });

  it.each(["continue", "cancel", "dispose"] as const)("动态清单等待期间 %s 不丢失已提交实体，也不恢复已取消的虚影", async outcome => {
    const { createCanvas, session } = setup();
    let ready!: () => void;
    const pending = new Promise<void>(resolve => { ready = resolve; });
    const canvas = createCanvas("async-palette", () => pending);
    const tap = (uiButtonId: string) => canvas.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    });
    tap("ui-left-dock-placement-mode-storager_1-touch-tap");
    tap("canvas-top-left-corner-toolbar-button-toggle-continuous-placement-on");
    tap("canvas-floating-toolbar-button-ok");
    expect(session.editor.document.getSnapshot().entityOrder).toHaveLength(1);
    expect(session.editor.state.collections.preview).toHaveLength(0);
    expect(canvas.state.activeTool).toBe("single-placement");
    await Promise.resolve();
    if (outcome === "cancel") tap("canvas-floating-toolbar-button-cancel");
    if (outcome === "dispose") canvas.dispose();
    ready();
    if (outcome === "continue") {
      await expect.poll(() => session.editor.state.collections.preview.length).toBe(1);
      expect(session.editor.state.collections.preview[0]).not.toBe(session.editor.document.getSnapshot().entityOrder[0]);
    } else {
      await pending; await Promise.resolve(); await Promise.resolve();
      expect(session.editor.state.collections.preview).toHaveLength(0);
      expect(canvas.state.activeTool).toBe("select");
    }
    expect(session.editor.document.getSnapshot().entityOrder).toHaveLength(1);
  });

  it.each(["mobile", "tablet", "desktop"] as const)("%s 放置面板只由所属画布收起，取消后恢复且不污染主工作台", deviceClass => {
    const { app, createCanvas, session } = setup();
    runInAction(() => { app.internalState.screenProfile = { ...app.state.screenProfile, deviceClass }; });
    const canvas = createCanvas("manual-panel");
    app.mainCanvas.setPlacementPanelSuppressed(true);
    const tap = (uiButtonId: string) => canvas.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    });
    tap("ui-left-dock-placement-mode-storager_1-touch-tap");
    expect(session.editor.state.collections.preview.length).toBe(1);
    expect(canvas.state.placementPanelSuppressed).toBe(deviceClass !== "desktop");
    expect(app.internalState.workbench.leftDockSuppressed).toBe(true);
    tap("canvas-floating-toolbar-button-cancel");
    expect(canvas.state.placementPanelSuppressed).toBe(false);
    expect(session.editor.state.collections.preview.length).toBe(0);
    expect(app.internalState.workbench.leftDockSuppressed).toBe(true);
    app.mainCanvas.setPlacementPanelSuppressed(false);
    expect(app.internalState.workbench.leftDockSuppressed).toBe(false);
  });

  it.each(["mouse", "touch", "keyboard"] as const)("keeps focused Inspector %s commands while its background is suspended", (source) => {
    const { app, session } = setup();
    app.workspace.editor = session.editor;
    const canvas = app.mainCanvas;
    canvas.view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
    session.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "selected", centerGridPoint: { x: 5, y: 5 } });
    expect(session.editor.actions.applyPlacementDraft()).toBe(true);
    session.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "selected" });
    app.internalActions.openDialog("inspector");
    const resume = canvas.suspend("inspector");
    releases.push(resume);
    expect(canvas.isInputSuspended).toBe(true);
    expect(canvas.isCommandInputSuspended).toBe(false);
    expect(canvas.getFloatingButtonAvailability("canvas-floating-toolbar-button-delete").enabled).toBe(true);
    const before = { ...canvas.view.state.center };
    canvas.gestureAdapter.handleKeyDown({ code: "ArrowRight", key: "ArrowRight", keyCode: 39, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    canvas.gestureActionRouter.advanceFrame(1000);
    canvas.gestureActionRouter.advanceFrame(1100);
    expect(canvas.view.state.center).toEqual(before);
    const tap = { uiButtonId: "canvas-floating-toolbar-button-delete", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    const remove = () => {
      if (source === "keyboard") canvas.gestureAdapter.handleKeyDown({ code: "KeyF", key: "f", keyCode: 70, ...tap });
      else if (source === "touch") canvas.gestureAdapter.handleUiButtonTouchTap(tap);
      else canvas.gestureAdapter.handleUiButtonMouseTap({ ...tap, button: 0 });
    };
    app.internalActions.openDialog("settings");
    const closeNested = canvas.suspend("slot-config");
    expect(canvas.isCommandInputSuspended).toBe(true);
    remove();
    expect(session.editor.document.getSnapshot().entities.selected).toBeDefined();
    app.internalActions.closeDialog("settings");
    expect(canvas.isCommandInputSuspended).toBe(true);
    closeNested();
    remove();
    expect(session.editor.document.getSnapshot().entityOrder).toEqual([]);
    expect(canvas.isInputSuspended).toBe(true);
  });

  it("cancels transient editing on suspension and waits for every lease before accepting input", () => {
    const { createCanvas, session } = setup();
    const canvas = createCanvas("left");
    canvas.acquireInput();
    canvas.actions.setActiveTool("single-placement");
    session.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "draft", centerGridPoint: { x: 5, y: 5 } });
    expect(session.editor.state.collections.preview.length).toBe(1);
    const releaseFirst = canvas.suspend();
    const releaseSecond = canvas.suspend();
    expect(canvas.state.activeTool).toBe("select");
    expect(session.editor.state.collections.preview.length).toBe(0);
    expect(canvas.isOperationEnabled("move")).toBe(false);
    releaseFirst(); releaseFirst();
    expect(canvas.isInputSuspended).toBe(true);
    releaseSecond();
    expect(canvas.isOperationEnabled("move")).toBe(true);
    expect(session.editor.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("retains cross-dialog endpoint selection while suspending input, then cancels it on ownership transfer", () => {
    const { createCanvas } = setup();
    const first = createCanvas("source"), second = createCanvas("target");
    first.acquireInput();
    runInAction(() => {
      first.state.toolInfo.darkPipeLink = {
        sourceBaseId: "draft_box", sourceEntityId: "inlet", sourceRole: "inlet",
        candidateEntityIds: ["outlet"], returnTool: "select",
      };
    });
    first.actions.setActiveTool("dark-pipe-link");
    const original = first.state.toolInfo.darkPipeLink;
    const resume = first.suspend("base-select");
    expect(first.state.activeTool).toBe("dark-pipe-link");
    expect(first.state.toolInfo.darkPipeLink).toBe(original);
    expect(first.isInputSuspended).toBe(true);
    expect(first.isCommandInputSuspended).toBe(true);
    resume();
    expect(first.state.toolInfo.darkPipeLink).toBe(original);
    second.acquireInput();
    expect(first.state.activeTool).toBe("select");
    expect(first.state.toolInfo.darkPipeLink).toBeNull();
  });

  it("transfers editing ownership across two cameras without sharing their viewport", () => {
    const { createCanvas, session } = setup();
    const first = createCanvas("first"), second = createCanvas("second");
    first.acquireInput(); first.actions.setActiveTool("single-placement");
    session.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", centerGridPoint: { x: 5, y: 5 } });
    second.acquireInput();
    expect(first.state.activeTool).toBe("select");
    expect(session.editor.state.collections.preview.length).toBe(0);
    first.view.actions.zoom(6);
    expect(first.view.state.gridSize).toBe(2);
    expect(second.view.state.gridSize).toBe(1);
  });

  it("rejects disabled keyboard routes and direct Editor commits using the same policy", () => {
    const { createCanvas, session, disabled } = setup();
    const canvas = createCanvas("policy");
    session.editor.actions.createSinglePlacementDraft({ definitionId: "storager_1", entityId: "placed", centerGridPoint: { x: 5, y: 5 } });
    expect(session.editor.actions.applyPlacementDraft()).toBe(true);
    session.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "placed" });
    disabled.add("delete");
    expect(canvas.isOperationEnabled("delete")).toBe(false);
    const event = { code: "KeyF", key: "f", keyCode: 70, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    canvas.gestureAdapter.handleKeyDown(event);
    session.editor.actions.deleteCollection(EntityCollectionType.selection);
    expect(session.editor.document.getSnapshot().entityOrder).toEqual(["placed"]);
    disabled.delete("delete");
    canvas.gestureAdapter.handleKeyDown(event);
    expect(session.editor.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("disposal is idempotent and an old suspension release cannot re-enable the canvas", () => {
    const { createCanvas } = setup();
    const canvas = createCanvas("disposed");
    const release = canvas.suspend();
    canvas.dispose(); canvas.dispose(); release();
    expect(canvas.isInputSuspended).toBe(true);
    expect(canvas.isOperationEnabled("select")).toBe(false);
    expect(() => canvas.suspend()()).not.toThrow();
  });
});
