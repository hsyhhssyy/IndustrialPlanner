// @vitest-environment jsdom

import { CanvasPanel } from "@/app-shell/components/canvas-panel/canvas-panel";
import { TOUCH_MARQUEE_LONG_PRESS_DURATION_MS } from "@/app-shell/components/canvas-panel/canvas-panel-touch-marquee-gesture";
import { createAppHost } from "@/app/app-host";
import { getStage1EntityDefinition } from "@/domain/registry/stage1-registry";
import {
  getManagedMarqueeDraft,
  getManagedMoveDraft,
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import {
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import { createWorkbenchController as createWorkbenchControllerBase } from "@/workbench/controller/workbench-controller";
import { asLegacyWorkbenchController } from "@/tests/helpers/legacy-workbench-controller";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createWorkbenchController = (
  ...args: Parameters<typeof createWorkbenchControllerBase>
) => asLegacyWorkbenchController(createWorkbenchControllerBase(...args));

vi.mock("@/renderer/host/renderer-host", () => ({
  RendererHost: () => null,
}));

class MockResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    this.#callback(
      [
        {
          target,
          contentRect: {
            width: 640,
            height: 360,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver;
const OriginalPointerEvent = globalThis.PointerEvent;
const OriginalRequestAnimationFrame = globalThis.requestAnimationFrame;
const OriginalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const OriginalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const OriginalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
const OriginalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;

async function renderCanvasPanel(
  controller: ReturnType<typeof createWorkbenchController>,
): Promise<{
  container: HTMLDivElement;
  root: Root;
  appHost: ReturnType<typeof createAppHost>;
}> {
  const appHost = createAppHost(controller);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(CanvasPanel, {
        controller,
        workspaceDerivedStore: appHost.workspaceDerivedStore,
      }),
    );
  });

  return {
    container,
    root,
    appHost,
  };
}

async function disposeCanvasPanel(options: {
  root: Root;
  appHost: ReturnType<typeof createAppHost>;
  controller: ReturnType<typeof createWorkbenchController>;
}) {
  await act(async () => {
    options.root.unmount();
  });
  options.appHost.dispose();
  options.controller.dispose();
}

function dispatchTouchPointerEvent(
  viewport: Element | null,
  type: string,
  pointerId: number,
  point: { x: number; y: number },
) {
  viewport?.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      pointerType: "touch",
    }),
  );
}

function dispatchPointerTap(
  viewport: Element | null,
  point: { x: number; y: number },
  pointerId: number,
) {
  viewport?.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      pointerType: "mouse",
    }),
  );
  viewport?.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      pointerType: "mouse",
    }),
  );
}

function toScreenPointForEntity(
  controller: ReturnType<typeof createWorkbenchController>,
  entityId: string,
) {
  const document = controller.documentStore.getSnapshot();
  const canvasView = controller.canvasViewStore.getSnapshot();
  const entity = document.entities[entityId];

  if (!entity) {
    throw new Error(`Missing entity ${entityId}`);
  }

  return {
    x:
      (entity.position.x * document.documentSettings.gridSize - canvasView.offset.x + 1) *
      canvasView.zoom,
    y:
      (entity.position.y * document.documentSettings.gridSize - canvasView.offset.y + 1) *
      canvasView.zoom,
  };
}

function toScreenPointForGrid(
  controller: ReturnType<typeof createWorkbenchController>,
  gridPoint: { x: number; y: number },
) {
  const document = controller.documentStore.getSnapshot();
  const canvasView = controller.canvasViewStore.getSnapshot();

  return {
    x:
      (gridPoint.x * document.documentSettings.gridSize - canvasView.offset.x + 1) *
      canvasView.zoom,
    y:
      (gridPoint.y * document.documentSettings.gridSize - canvasView.offset.y + 1) *
      canvasView.zoom,
  };
}

function resolveEntityBounds(
  controller: ReturnType<typeof createWorkbenchController>,
  entityIds: string[],
) {
  const document = controller.documentStore.getSnapshot();

  const bounds = getGridBoundingBox(
    entityIds.map((entityId) => {
      const entity = document.entities[entityId];

      if (!entity) {
        throw new Error(`Missing entity ${entityId}`);
      }

      const definition = getStage1EntityDefinition(
        controller.registry,
        entity.definitionId,
      );

      if (!definition) {
        throw new Error(`Missing definition ${entity.definitionId}`);
      }

      return {
        position: entity.position,
        footprint: getRotatedGridFootprint(
          definition.footprint,
          entity.rotation,
        ),
      };
    }),
  );

  if (!bounds) {
    throw new Error("Missing selection bounds");
  }

  return bounds;
}

async function flushCanvasActions() {
  await Promise.resolve();
  await Promise.resolve();
}

function getPlacementMode(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  const currentMode = controller.editorStore.getSnapshot().session.currentMode;

  return isPlacementInteractionMode(currentMode) ? currentMode : null;
}

function getMoveMode(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  const currentMode = controller.editorStore.getSnapshot().session.currentMode;

  return isMoveInteractionMode(currentMode) ? currentMode : null;
}

function getSelection(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  return getSelectedEntityIds(controller.editorStore.getSnapshot().session);
}

function getPlacementPreview(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  return getManagedPlacementPreview(controller.editorStore.getSnapshot().session);
}

function getMoveDraft(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  return getManagedMoveDraft(
    controller.editorStore.getSnapshot().session,
    controller.documentStore.getSnapshot(),
  );
}

function getMarqueeDraft(
  controller: ReturnType<typeof createWorkbenchController>,
) {
  return getManagedMarqueeDraft(controller.editorStore.getSnapshot().session);
}

describe("CanvasPanel placement actions", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
      writable: true,
    });
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: MockPointerEvent,
      writable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      writable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => {},
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => {},
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: OriginalResizeObserver,
      writable: true,
    });
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: OriginalPointerEvent,
      writable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: OriginalRequestAnimationFrame,
      writable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: OriginalCancelAnimationFrame,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: OriginalSetPointerCapture,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: OriginalReleasePointerCapture,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: OriginalHasPointerCapture,
      writable: true,
    });
  });

  it("rotates armed pointer placement on R and cancels it on right click", async () => {
    const controller = createWorkbenchController();
    controller.armPlacement("belt_straight_1x1", "belt");
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const stage = container.querySelector(".canvas-stage");
    const viewport = container.querySelector(".canvas-viewport-surface");

    expect(stage).not.toBeNull();
    expect(viewport).not.toBeNull();

    await act(async () => {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "r",
        }),
      );
    });

    expect(getPlacementMode(controller)?.rotation).toBe(90);

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      viewport?.dispatchEvent(contextMenuEvent);
    });

    expect(contextMenuEvent.defaultPrevented).toBe(true);

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: 40,
          clientY: 24,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
    });

    expect(controller.editorStore.getSnapshot().session.displayTool).toBe("select");
    expect(getPlacementMode(controller)).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("renders touch placement toolbar rotate/cancel actions next to confirm", async () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });
    controller.armPlacement("item_port_unloader_1", "place", "touch");
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".placement-action-toolbar .canvas-action-button",
      ),
    );
    const buttonLabels = buttons.map((button) => button.getAttribute("aria-label"));
    const cancelButton = buttons.find(
      (button) => button.getAttribute("aria-label") === "取消",
    );
    const rotateButton = buttons.find(
      (button) => button.getAttribute("aria-label") === "旋转",
    );

    expect(buttonLabels).toEqual(["取消", "旋转", "确认放置"]);
    expect(container.querySelector(".placement-affordance-hint")).toBeNull();

    const beforePreview = getPlacementPreview(controller);

    expect(beforePreview).toMatchObject({
      definitionId: "item_port_unloader_1",
      interactionMode: "touch",
      rotation: 0,
    });

    await act(async () => {
      rotateButton?.click();
    });

    expect(getPlacementPreview(controller)).toMatchObject({
      interactionMode: "touch",
      gridPoint: {
        x: (beforePreview?.gridPoint.x ?? 0) + 1,
        y: (beforePreview?.gridPoint.y ?? 0) - 1,
      },
      rotation: 90,
    });

    await act(async () => {
      cancelButton?.click();
    });

    expect(controller.editorStore.getSnapshot().session.displayTool).toBe("select");
    expect(container.querySelector(".placement-action-toolbar")).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("marks pointer selection and supports rotate/delete keyboard actions", async () => {
    const controller = createWorkbenchController();
    const beforeEntity = controller.documentStore.getSnapshot().entities["filler-1"];
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const stage = container.querySelector(".canvas-stage");
    const viewport = container.querySelector(".canvas-viewport-surface");
    const fillerPoint = toScreenPointForEntity(controller, "filler-1");

    expect(stage).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(beforeEntity).toBeTruthy();

    await act(async () => {
      dispatchPointerTap(viewport, fillerPoint, 41);
      await flushCanvasActions();
    });

    expect(getSelection(controller)).toEqual(["filler-1"]);
    expect(controller.editorStore.getSnapshot().session.selectionInputMode).toBe(
      "pointer",
    );

    await act(async () => {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "r",
        }),
      );
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toMatchObject({
      position: { x: 17, y: 7 },
      rotation: 180,
    });

    await act(async () => {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Delete",
        }),
      );
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toBeUndefined();
    expect(getSelection(controller)).toEqual([]);
    expect(controller.editorStore.getSnapshot().session.selectionInputMode).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("renders touch selection toolbar with shared rotate/delete actions", async () => {
    const controller = createWorkbenchController();
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const fillerPoint = toScreenPointForEntity(controller, "filler-1");

    expect(viewport).not.toBeNull();

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 51, fillerPoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 51, fillerPoint);
      await flushCanvasActions();
    });

    expect(getSelection(controller)).toEqual(["filler-1"]);
    expect(controller.editorStore.getSnapshot().session.selectionInputMode).toBe(
      "touch",
    );

    const toolbar = container.querySelector(
      ".selection-action-toolbar.canvas-action-toolbar",
    );
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".selection-action-toolbar .canvas-action-button",
      ),
    );
    const rotateButton = buttons.find(
      (button) => button.getAttribute("aria-label") === "旋转",
    );
    const deleteButton = buttons.find(
      (button) => button.getAttribute("aria-label") === "删除选中",
    );

    expect(toolbar).not.toBeNull();
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "旋转",
      "删除选中",
    ]);

    await act(async () => {
      rotateButton?.click();
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toMatchObject({
      position: { x: 17, y: 7 },
      rotation: 180,
    });

    await act(async () => {
      deleteButton?.click();
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toBeUndefined();
    expect(container.querySelector(".selection-action-toolbar")).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("promotes a blank touch hold into marquee selection and keeps touch actions anchored to the resulting bounds", async () => {
    vi.useFakeTimers();

    const controller = createWorkbenchController();
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const marqueeBounds = resolveEntityBounds(controller, ["reactor-1", "filler-1"]);
    const holdPoint = toScreenPointForGrid(controller, {
      x: marqueeBounds.left - 1,
      y: marqueeBounds.top - 1,
    });
    const dragPoint = toScreenPointForGrid(controller, {
      x: marqueeBounds.left + marqueeBounds.width - 1,
      y: marqueeBounds.top + marqueeBounds.height - 1,
    });

    expect(viewport).not.toBeNull();

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 56, holdPoint);
    });

    expect(container.querySelector(".canvas-touch-hold-indicator")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOUCH_MARQUEE_LONG_PRESS_DURATION_MS);
      await flushCanvasActions();
    });

    expect(container.querySelector(".canvas-touch-hold-indicator")).toBeNull();
    expect(getMarqueeDraft(controller)).toMatchObject({
      interactionMode: "touch",
      selectionMode: "replace",
    });

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointermove", 56, dragPoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 56, dragPoint);
      await flushCanvasActions();
    });

    expect(getSelection(controller)).toEqual([
      "reactor-1",
      "filler-1",
    ]);
    expect(controller.editorStore.getSnapshot().session.selectionInputMode).toBe(
      "touch",
    );
    expect(container.querySelector(".selection-action-toolbar")).not.toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("auto-confirms pointer move drags from the selected entity", async () => {
    const controller = createWorkbenchController();
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const sourcePoint = toScreenPointForEntity(controller, "reactor-1");
    const destinationPoint = toScreenPointForGrid(controller, { x: 20, y: 10 });

    expect(viewport).not.toBeNull();

    await act(async () => {
      dispatchPointerTap(viewport, sourcePoint, 61);
      await flushCanvasActions();
    });

    expect(getSelection(controller)).toEqual([
      "reactor-1",
    ]);

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: sourcePoint.x,
          clientY: sourcePoint.y,
          pointerId: 62,
          pointerType: "mouse",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: destinationPoint.x,
          clientY: destinationPoint.y,
          pointerId: 62,
          pointerType: "mouse",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: destinationPoint.x,
          clientY: destinationPoint.y,
          pointerId: 62,
          pointerType: "mouse",
        }),
      );
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["reactor-1"]).toMatchObject({
      position: { x: 20, y: 10 },
    });
    expect(getMoveMode(controller)).toBeNull();
    expect(container.querySelector(".move-action-toolbar")).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("keeps touch move drafts pending for toolbar confirmation", async () => {
    const controller = createWorkbenchController();
    const before = controller.documentStore.getSnapshot().entities["reactor-1"];
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const sourcePoint = toScreenPointForEntity(controller, "reactor-1");
    const destinationPoint = toScreenPointForGrid(controller, { x: 20, y: 10 });

    expect(viewport).not.toBeNull();
    expect(before).toBeTruthy();

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 71, sourcePoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 71, sourcePoint);
      await flushCanvasActions();
    });

    expect(getSelection(controller)).toEqual([
      "reactor-1",
    ]);
    expect(controller.editorStore.getSnapshot().session.selectionInputMode).toBe(
      "touch",
    );

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 72, sourcePoint);
      dispatchTouchPointerEvent(viewport, "pointermove", 72, destinationPoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 72, destinationPoint);
      await flushCanvasActions();
    });

    expect(getMoveMode(controller)).toMatchObject({
      entityId: "reactor-1",
      inputMode: "touch",
    });
    expect(getMoveDraft(controller)).toMatchObject({
      gridPoint: { x: 20, y: 10 },
      valid: true,
    });
    expect(controller.documentStore.getSnapshot().entities["reactor-1"]).toEqual(before);

    const moveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".move-action-toolbar .canvas-action-button",
      ),
    );
    const confirmButton = moveButtons.find(
      (button) => button.getAttribute("aria-label") === "确认移动",
    );

    expect(moveButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "取消移动",
      "旋转",
      "确认移动",
    ]);

    await act(async () => {
      confirmButton?.click();
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["reactor-1"]).toMatchObject({
      position: { x: 20, y: 10 },
    });
    expect(getMoveMode(controller)).toBeNull();
    expect(container.querySelector(".move-action-toolbar")).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("rotates pointer move drafts before auto-confirming the move", async () => {
    const controller = createWorkbenchController();
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const fillerPoint = toScreenPointForEntity(controller, "filler-1");
    const destinationPoint = toScreenPointForGrid(controller, { x: 20, y: 10 });

    expect(viewport).not.toBeNull();

    await act(async () => {
      dispatchPointerTap(viewport, fillerPoint, 81);
      await flushCanvasActions();
    });

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: fillerPoint.x,
          clientY: fillerPoint.y,
          pointerId: 82,
          pointerType: "mouse",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: destinationPoint.x,
          clientY: destinationPoint.y,
          pointerId: 82,
          pointerType: "mouse",
        }),
      );
      await flushCanvasActions();
    });

    await act(async () => {
      await flushCanvasActions();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      controller.rotateMoveClockwise();
      await flushCanvasActions();
    });

    const rotatedPointerDraft = getMoveDraft(controller);

    expect(rotatedPointerDraft).toMatchObject({
      entityId: "filler-1",
      rotation: 180,
      valid: true,
    });

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: destinationPoint.x,
          clientY: destinationPoint.y,
          pointerId: 82,
          pointerType: "mouse",
        }),
      );
      await flushCanvasActions();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toMatchObject({
      position: rotatedPointerDraft?.gridPoint,
      rotation: rotatedPointerDraft?.rotation,
    });
    expect(getMoveMode(controller)).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("rotates touch move drafts before confirming", async () => {
    const controller = createWorkbenchController();
    const before = controller.documentStore.getSnapshot().entities["filler-1"];
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const sourcePoint = toScreenPointForEntity(controller, "filler-1");
    const destinationPoint = toScreenPointForGrid(controller, { x: 20, y: 10 });

    expect(viewport).not.toBeNull();
    expect(before).toBeTruthy();

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 91, sourcePoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 91, sourcePoint);
      await flushCanvasActions();
    });

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 92, sourcePoint);
      dispatchTouchPointerEvent(viewport, "pointermove", 92, destinationPoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 92, destinationPoint);
      await flushCanvasActions();
    });

    await act(async () => {
      await flushCanvasActions();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      controller.rotateMoveClockwise();
      await flushCanvasActions();
    });

    const rotatedTouchDraft = getMoveDraft(controller);

    expect(rotatedTouchDraft).toMatchObject({
      entityId: "filler-1",
      rotation: 180,
      valid: true,
    });
    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toEqual(before);

    await act(async () => {
      await controller.confirmMovePreview();
    });

    expect(controller.documentStore.getSnapshot().entities["filler-1"]).toMatchObject({
      position: rotatedTouchDraft?.gridPoint,
      rotation: rotatedTouchDraft?.rotation,
    });
    expect(getMoveMode(controller)).toBeNull();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("only drags touch placement when the gesture starts on the preview", async () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });
    controller.armPlacement("belt_straight_1x1", "belt", "touch");
    const panCanvasBySpy = vi.spyOn(controller, "panCanvasBy");
    const updatePlacementPreviewSpy = vi.spyOn(
      controller,
      "updatePlacementPreviewFromScreenPoint",
    );
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const screenBox = appHost.workspaceDerivedStore.render.anchoredPlacementScreenBox;

    expect(viewport).not.toBeNull();
    expect(screenBox).not.toBeNull();

    const outsideStartPoint = {
      x: Math.max(12, (screenBox?.left ?? 0) - 40),
      y: Math.max(12, (screenBox?.top ?? 0) - 40),
    };
    const insideStartPoint = {
      x: (screenBox?.left ?? 0) + (screenBox?.width ?? 0) / 2,
      y: (screenBox?.top ?? 0) + (screenBox?.height ?? 0) / 2,
    };

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: outsideStartPoint.x,
          clientY: outsideStartPoint.y,
          pointerId: 21,
          pointerType: "touch",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: outsideStartPoint.x + 48,
          clientY: outsideStartPoint.y + 30,
          pointerId: 21,
          pointerType: "touch",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: outsideStartPoint.x + 48,
          clientY: outsideStartPoint.y + 30,
          pointerId: 21,
          pointerType: "touch",
        }),
      );
    });

    expect(panCanvasBySpy).toHaveBeenCalledWith({ x: 48, y: 30 });
    expect(updatePlacementPreviewSpy).not.toHaveBeenCalled();

    panCanvasBySpy.mockClear();
    updatePlacementPreviewSpy.mockClear();

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: insideStartPoint.x,
          clientY: insideStartPoint.y,
          pointerId: 22,
          pointerType: "touch",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: insideStartPoint.x + 84,
          clientY: insideStartPoint.y,
          pointerId: 22,
          pointerType: "touch",
        }),
      );
      viewport?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: insideStartPoint.x + 84,
          clientY: insideStartPoint.y,
          pointerId: 22,
          pointerType: "touch",
        }),
      );
    });

    expect(updatePlacementPreviewSpy).toHaveBeenCalledWith({
      x: insideStartPoint.x + 84,
      y: insideStartPoint.y,
    });
    expect(panCanvasBySpy).not.toHaveBeenCalled();

    await disposeCanvasPanel({ root, appHost, controller });
  });

  it("uses shared pinch and pan when a second touch enters touch placement", async () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });
    controller.armPlacement("belt_straight_1x1", "belt", "touch");
    const panCanvasBySpy = vi.spyOn(controller, "panCanvasBy");
    const zoomCanvasAtSpy = vi.spyOn(controller, "zoomCanvasAt");
    const updatePlacementPreviewSpy = vi.spyOn(
      controller,
      "updatePlacementPreviewFromScreenPoint",
    );
    const { container, root, appHost } = await renderCanvasPanel(controller);
    const viewport = container.querySelector(".canvas-viewport-surface");
    const screenBox = appHost.workspaceDerivedStore.render.anchoredPlacementScreenBox;

    expect(viewport).not.toBeNull();
    expect(screenBox).not.toBeNull();

    const firstTouchPoint = {
      x: (screenBox?.left ?? 0) + (screenBox?.width ?? 0) / 2,
      y: (screenBox?.top ?? 0) + (screenBox?.height ?? 0) / 2,
    };
    const secondTouchStartPoint = {
      x: firstTouchPoint.x + 60,
      y: firstTouchPoint.y,
    };
    const secondTouchMovePoint = {
      x: firstTouchPoint.x + 100,
      y: firstTouchPoint.y + 20,
    };

    panCanvasBySpy.mockClear();
    zoomCanvasAtSpy.mockClear();
    updatePlacementPreviewSpy.mockClear();

    await act(async () => {
      dispatchTouchPointerEvent(viewport, "pointerdown", 31, firstTouchPoint);
      dispatchTouchPointerEvent(viewport, "pointerdown", 32, secondTouchStartPoint);
      dispatchTouchPointerEvent(viewport, "pointermove", 32, secondTouchMovePoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 32, secondTouchMovePoint);
      dispatchTouchPointerEvent(viewport, "pointerup", 31, firstTouchPoint);
    });

    expect(updatePlacementPreviewSpy).not.toHaveBeenCalled();
    expect(zoomCanvasAtSpy).toHaveBeenCalledWith(
      {
        x: firstTouchPoint.x + 30,
        y: firstTouchPoint.y,
      },
      Math.hypot(100, 20) / 60,
    );
    expect(panCanvasBySpy).toHaveBeenCalledWith({ x: 20, y: 10 });
    expect(getPlacementMode(controller)?.definitionId).toBe("belt_straight_1x1");
    expect(getPlacementMode(controller)?.inputMode).toBe("touch");

    await disposeCanvasPanel({ root, appHost, controller });
  });
});
