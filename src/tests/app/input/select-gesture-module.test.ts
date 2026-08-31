import { describe, expect, it, vi } from "vitest";
import { makeAutoObservable } from "mobx";

// AI-REMOVED 2026-08-03:
// Reason: 返回选择模式不再依赖 SHORTCUT_KEY.RETURN_SELECT。
// Trigger: ST2-RQ-002 禁止绑定 Escape。
// Evidence: select 手势直接匹配 Escape，测试断言 isShortcutFor 未被调用。
// Replacement: 本文件的 Escape 硬编码测试。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphSelectGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import { WorkbenchOverlapEntityMenuController } from "@/app/shell/state/overlap-entity-menu-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";
import type { WorldEntity } from "@/domain/document/world-document";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { EntityCollection } from "@/domain/editor/types/editor-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createRegistryContract } from "@/registry";

describe("createHypergryphSelectGestureModule", () => {
  it("opens the overlap entity menu before selecting an entity from a stacked cell", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      overlapEntityMenu,
    } = createOverlapSelectContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-overlap-1",
        button: 0,
        buttons: 0,
        position: { x: 0, y: 0 },
        longPress: false,
        pointerEntity: entity("top-entity", "pipe_straight_1x1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(overlapEntityMenu.visible).toBe(true);
    expect(overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "top-entity",
      "bottom-entity",
    ]);
    expect(addToCollection).not.toHaveBeenCalled();

    overlapEntityMenu.select("bottom-entity");

    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "bottom-entity",
    });
  });

  it("clears the selection collection before selecting a different clicked entity and syncs the right dock", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      setRightDockActiveTab,
      showCanvasFloatingToolbarForCollection,
      toggleRightDock,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(setRightDockActiveTab).toHaveBeenCalledWith("selection");
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it("clears the current selection when the clicked entity is the only selected entity", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, ["entity-1"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-keep-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).not.toHaveBeenCalled();
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("opens the inspector dialog on second click instead of clearing selection when the option is enabled", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      hideCanvasFloatingToolbar,
      openDialog,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, ["entity-1"], false, true, false, true);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-open-dialog-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).not.toHaveBeenCalled();
    expect(addToCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
    expect(openDialog).toHaveBeenCalledWith("inspector");
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("opens the right dock on second click instead of clearing selection when the option is enabled", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      openDialog,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, ["entity-1"], false, true, true, true);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-open-right-dock-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).not.toHaveBeenCalled();
    expect(addToCollection).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
    expect(setRightDockActiveTab).toHaveBeenCalledWith("selection");
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
  });

  it("switches to the selection tab without reopening the right dock when it is already open", () => {
    const {
      context,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, [], true);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-right-dock-open-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(setRightDockActiveTab).toHaveBeenCalledWith("selection");
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("closes the right dock when deselecting the only selected entity by clicking it again", () => {
    const {
      context,
      clearCollection,
      hideCanvasFloatingToolbar,
      toggleRightDock,
    } = createContext("select", true, ["entity-1"], true);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-clear-dock-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-open the right dock when selection sync is disabled", () => {
    const {
      context,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, [], false, false);
    const module = createHypergryphSelectGestureModule();

    const selectResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-no-sync-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(selectResult).toEqual({ status: "handled" });
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("does not auto-open the right dock on first selection when the option requires a second click", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      openDialog,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, [], false, true, true, true);
    const module = createHypergryphSelectGestureModule();

    const selectResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-reclick-first-pass-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(selectResult).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(openDialog).not.toHaveBeenCalled();
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("does not open or close the right dock when inspector panel mode is disabled", () => {
    const {
      context,
      setRightDockActiveTab,
      toggleRightDock,
    } = createContext("select", true, [], false, true, false);
    const module = createHypergryphSelectGestureModule();

    const selectResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-inspector-dialog-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(selectResult).toEqual({ status: "handled" });
    expect(setRightDockActiveTab).not.toHaveBeenCalled();
    expect(toggleRightDock).not.toHaveBeenCalled();
  });

  it("closes the right dock on deselect even when selection sync is disabled", () => {
    const {
      context,
      clearCollection,
      toggleRightDock,
    } = createContext("select", true, ["entity-1"], true, false);
    const module = createHypergryphSelectGestureModule();

    const clearResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-no-sync-clear-1",
        button: 2,
        buttons: 0,
        position: { x: 24, y: 16 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(clearResult).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(toggleRightDock).toHaveBeenCalledTimes(1);
  });

  it("keeps the current selection when the clicked entity is already part of a multi-selection", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
    } = createContext("select", true, ["entity-1", "entity-2"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-keep-multi-1",
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).not.toHaveBeenCalled();
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-1",
    });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("clears the selection collection before selecting a different tapped entity", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-1",
        primaryId: 3,
        position: { x: 72, y: 40 },
        longPress: false,
        pointerEntity: entity("entity-2"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.selection,
      entityId: "entity-2",
    });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it.each([
    "belt_straight_1x1",
    "pipe_turn_cw_1x1",
  ])("does not reopen a floating toolbar for strict logistics selections (%s)", (definitionId) => {
    const {
      context,
      showCanvasFloatingToolbarForCollection,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: `mouse-select-strict-${definitionId}`,
        button: 0,
        buttons: 0,
        position: { x: 48, y: 32 },
        longPress: false,
        pointerEntity: entity("entity-strict", definitionId),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
  });

  it("clears the selection collection on right click in select mode", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-clear-1",
        button: 2,
        buttons: 0,
        position: { x: 24, y: 16 },
        longPress: false,
        pointerEntity: entity("entity-3"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(addToCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("ignores select taps when no entity is under the pointer", () => {
    const {
      context,
      addToCollection,
      clearCollection,
      showCanvasFloatingToolbarForCollection,
      hideCanvasFloatingToolbar,
    } = createContext();
    const module = createHypergryphSelectGestureModule();

    const mouseResult = module.handle(
      {
        type: "mouse tap",
        gestureId: "mouse-select-ignored-1",
        button: 0,
        buttons: 0,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const touchResult = module.handle(
      {
        type: "touch tap",
        gestureId: "touch-select-ignored-1",
        primaryId: 4,
        position: { x: 12, y: 8 },
        longPress: false,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(mouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(addToCollection).not.toHaveBeenCalled();
    expect(clearCollection).not.toHaveBeenCalled();
    expect(showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();
    expect(hideCanvasFloatingToolbar).not.toHaveBeenCalled();
  });

  it("only responds while select mode and hypergryph mode are active", () => {
    const module = createHypergryphSelectGestureModule();
    const disabledContext = createContext("select", false).context;
    const moveContext = createContext("move").context;

    expect(module.when?.(disabledContext)).toBe(false);
    expect(
      module.handle(
        {
          type: "mouse tap",
          gestureId: "mouse-select-ignored-2",
          button: 0,
          buttons: 0,
          position: { x: 12, y: 8 },
          longPress: false,
          pointerEntity: entity("entity-4"),
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        moveContext,
      ),
    ).toEqual({ status: "ignored" });
  });

  it("switches back to select when the select tool button is tapped", () => {
    const { context, setActiveTool } = createContext("move");
    const module = createHypergryphSelectGestureModule();

    const mouseResult = module.handle(
      {
        type: "ui-button-mouse-tap",
        gestureId: "select-tool-button-mouse-1",
        button: 0,
        uiButtonId: "placement-tool-select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );
    const touchResult = module.handle(
      {
        type: "ui-button-touch-tap",
        gestureId: "select-tool-button-touch-1",
        uiButtonId: "placement-tool-select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(mouseResult).toEqual({ status: "handled" });
    expect(touchResult).toEqual({ status: "handled" });
    expect(setActiveTool).toHaveBeenNthCalledWith(1, "select");
    expect(setActiveTool).toHaveBeenNthCalledWith(2, "select");
  });

  it("ignores non-primary or unrelated select tool button taps", () => {
    const { context, setActiveTool } = createContext("move");
    const module = createHypergryphSelectGestureModule();

    expect(
      module.handle(
        {
          type: "ui-button-mouse-tap",
          gestureId: "select-tool-button-ignore-1",
          button: 2,
          uiButtonId: "placement-tool-select",
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        context,
      ),
    ).toEqual({ status: "ignored" });

    expect(
      module.handle(
        {
          type: "ui-button-touch-tap",
          gestureId: "select-tool-button-ignore-2",
          uiButtonId: "placement-tool-delete",
          modifiers: emptyModifiers(),
          sourceEvent: null,
        },
        context,
      ),
    ).toEqual({ status: "ignored" });

    expect(setActiveTool).not.toHaveBeenCalled();
  });

  it("returns to select mode when the hardcoded Escape key is pressed", () => {
    const { context, isShortcutFor, setActiveTool } = createContext("logistics-placement");
    const module = createHypergryphSelectGestureModule();

    const result = handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({
        code: "Escape",
        key: "Escape",
      }),
    });

    expect(result).toEqual({ status: "handled" });
    // AI-REMOVED 2026-08-03:
    // Reason: Escape 不再经过可配置快捷键匹配。
    // Trigger: ST2-RQ-002 禁止绑定 Escape。
    // Evidence: 结果 handled 且 isShortcutFor 未被调用。
    // Replacement: 下方 not.toHaveBeenCalled 断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(isShortcutFor).toHaveBeenCalledWith(
    //   SHORTCUT_KEY.RETURN_SELECT,
    //   "Escape",
    //   "Escape",
    //   { alt: false, ctrl: false, meta: false, shift: false },
    // );
    expect(isShortcutFor).not.toHaveBeenCalled();
    expect(setActiveTool).toHaveBeenCalledWith("select");
  });

  it("ignores non-matching return-select shortcut keys", () => {
    const { context, setActiveTool } = createContext("single-placement");
    const module = createHypergryphSelectGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent({ code: "KeyR", key: "r" }),
    })).toEqual({ status: "ignored" });
    expect(setActiveTool).not.toHaveBeenCalled();
  });

  it("clears any floating toolbar when another tool returns to select with a preserved selection", () => {
    const {
      appHost,
      hideCanvasFloatingToolbar,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: [entity("entity-1")],
    });
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-enter-active-tool",
        gestureId: "enter-select-tool-1",
        from: "move",
        to: "select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      createToolbarFallbackGestureContext(appHost),
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("still clears any floating toolbar when another tool returns to select with an empty selection", () => {
    const {
      appHost,
      hideCanvasFloatingToolbar,
    } = createToolbarFallbackContext({
      activeTool: "move",
      selectedEntities: [],
    });
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-enter-active-tool",
        gestureId: "enter-select-tool-empty-1",
        from: "move",
        to: "select",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      createToolbarFallbackGestureContext(appHost),
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("hides the select toolbar when leaving select mode", () => {
    const { context, hideCanvasFloatingToolbar } = createContext("select", true, ["entity-1"]);
    const module = createHypergryphSelectGestureModule();

    const result = module.handle(
      {
        type: "on-exit-active-tool",
        gestureId: "exit-select-tool-1",
        from: "select",
        to: "move",
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });
});

function createContext(
  activeTool: ActiveTool = "select",
  hypergryphOperationMode = true,
  selectedEntityIds: readonly string[] = [],
  rightDockOpen = false,
  selectionRightDockSync = true,
  useInspectorPanel = true,
  inspectorOpenOnSecondClick = false,
): {
  context: GestureActionContext<AppHost>;
  addToCollection: ReturnType<typeof vi.fn>;
  clearCollection: ReturnType<typeof vi.fn>;
  showCanvasFloatingToolbarForCollection: ReturnType<typeof vi.fn>;
  hideCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
  isDedicatedLogisticsDevice: ReturnType<typeof vi.fn>;
  isShortcutFor: ReturnType<typeof vi.fn>;
  openDialog: ReturnType<typeof vi.fn>;
  setActiveTool: ReturnType<typeof vi.fn>;
  setRightDockActiveTab: ReturnType<typeof vi.fn>;
  toggleRightDock: ReturnType<typeof vi.fn>;
} {
  const addToCollection = vi.fn();
  const clearCollection = vi.fn();
  const showCanvasFloatingToolbarForCollection = vi.fn(() => true);
  const hideCanvasFloatingToolbar = vi.fn();
  const setActiveTool = vi.fn();
  const setRightDockActiveTab = vi.fn();
  const toggleRightDock = vi.fn();
  const openDialog = vi.fn();
  // AI-REMOVED 2026-08-03:
  // Reason: select 手势不再通过可配置 RETURN_SELECT 快捷键匹配 Escape。
  // Trigger: ST2-RQ-002 禁止绑定 Escape。
  // Evidence: createHypergryphSelectGestureModule 直接判断 event.code / event.key。
  // Replacement: 下方只用于验证未调用的 mock。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const isShortcutFor = vi.fn((shortcutKeyId: string, code: string | null) => (
  //   shortcutKeyId === SHORTCUT_KEY.RETURN_SELECT && code === "Escape"
  // ));
  const isShortcutFor = vi.fn(() => false);
  const isDedicatedLogisticsDevice = vi.fn((definitionId: string) => [
    "belt_straight_1x1",
    "belt_turn_cw_1x1",
    "belt_turn_ccw_1x1",
    "pipe_straight_1x1",
    "pipe_turn_cw_1x1",
    "pipe_turn_ccw_1x1",
  ].includes(definitionId));

  return {
    context: {
      workspace: {
        registry: {
          queries: {
            isDedicatedLogisticsDevice,
            isGeneralLogisticsDevice: vi.fn(() => false),
          },
        },
        editor: {
          state: {
            collections: {
              selection: createSelectionCollection(selectedEntityIds),
            },
          },
          actions: {
            addToCollection,
            clearCollection,
          },
        },
      } as unknown as WorkspaceContract,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode,
            hypergryphSelectionRightDockSync: selectionRightDockSync,
            hypergryphInspectorOpenOnSecondClick: inspectorOpenOnSecondClick,
            gameUseInspectorPanel: useInspectorPanel,
          },
          workbench: {
            rightDockOpen,
          },
        },
        internalState: {
          activeTool,
          workbench: {
            rightDockOpen,
          },
        },
        internalActions: {
          isShortcutFor,
          openDialog,
          setActiveTool,
          setRightDockActiveTab,
          showCanvasFloatingToolbarForCollection,
          hideCanvasFloatingToolbar,
          toggleRightDock,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    addToCollection,
    clearCollection,
    showCanvasFloatingToolbarForCollection,
    hideCanvasFloatingToolbar,
    isDedicatedLogisticsDevice,
    isShortcutFor,
    openDialog,
    setActiveTool,
    setRightDockActiveTab,
    toggleRightDock,
  };
}

function createOverlapSelectContext(): {
  context: GestureActionContext<AppHost>;
  addToCollection: ReturnType<typeof vi.fn>;
  clearCollection: ReturnType<typeof vi.fn>;
  overlapEntityMenu: WorkbenchOverlapEntityMenuController;
} {
  const registry = createRegistryContract();
  const overlapEntityMenu = new WorkbenchOverlapEntityMenuController();
  const bottomEntity = entity("bottom-entity", "belt_straight_1x1");
  const topEntity = entity("top-entity", "pipe_straight_1x1");
  const entities = [bottomEntity, topEntity];
  const addToCollection = vi.fn();
  const clearCollection = vi.fn();
  const selection = createSelectionCollection([]);
  const editor = {
    state: {
      suppressBelts: false,
      suppressPipes: false,
      collections: {
        selection,
      },
    },
    queries: {
      listEntities: () => entities,
      getEntityById: (entityId: string) =>
        entities.find((candidate) => candidate.id === entityId) ?? null,
      findGridCellForClientPixelPoint: (point: { readonly x: number; readonly y: number }) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      }),
    },
    actions: {
      addToCollection,
      clearCollection,
    },
  };
  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
        hypergryphSelectionRightDockSync: true,
        hypergryphInspectorOpenOnSecondClick: false,
        gameUseInspectorPanel: true,
      },
      workbench: {
        rightDockOpen: true,
      },
    },
    internalState: {
      activeTool: "select",
      workbench: {
        rightDockOpen: true,
      },
    },
    internalActions: {
      openDialog: vi.fn(),
      setRightDockActiveTab: vi.fn(),
      hideCanvasFloatingToolbar: vi.fn(),
      toggleRightDock: vi.fn(),
    },
    overlapEntityMenu,
    workspace: {
      editor,
      registry,
    },
  } as unknown as AppHost;

  return {
    context: {
      workspace: appHost.workspace,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    } as unknown as GestureActionContext<AppHost>,
    addToCollection,
    clearCollection,
    overlapEntityMenu,
  };
}

function entity(id: string, definitionId = "not-strict-device"): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
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

function keyDownEvent(options: {
  code: string;
  key: string;
}) {
  return {
    type: "key down" as const,
    gestureId: "key-select-tool-shortcut-1",
    code: options.code,
    key: options.key,
    keyCode: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
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

function createToolbarFallbackContext(options: {
  activeTool: ActiveTool;
  selectedEntities: readonly WorldEntity[];
  hypergryphOperationMode?: boolean;
}): {
  appHost: AppHost;
  hideCanvasFloatingToolbar: ReturnType<typeof vi.fn>;
} {
  const hideCanvasFloatingToolbar = vi.fn();
  const selectedEntityMap = new Map(
    options.selectedEntities.map((selectedEntity) => [selectedEntity.id, selectedEntity]),
  );

  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: options.hypergryphOperationMode ?? true,
      },
    },
    internalState: new TestInternalState(options.activeTool),
    internalActions: {
      hideCanvasFloatingToolbar,
    },
    workspace: {
      editor: {
        state: {
          collections: {
            selection: createSelectionCollection(
              options.selectedEntities.map((selectedEntity) => selectedEntity.id),
            ),
          },
        },
        queries: {
          getEntityById: (entityId: string) => selectedEntityMap.get(entityId) ?? null,
        },
      },
      registry: {
        queries: {
          isDedicatedLogisticsDevice: (definitionId: string) => [
            "belt_straight_1x1",
            "belt_turn_cw_1x1",
            "belt_turn_ccw_1x1",
            "pipe_straight_1x1",
            "pipe_turn_cw_1x1",
            "pipe_turn_ccw_1x1",
          ].includes(definitionId),
        },
      },
    },
  } as unknown as AppHost;

  return {
    appHost,
    hideCanvasFloatingToolbar,
  };
}

function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
  const selection = [...entityIds] as string[] & EntityCollection;

  selection.contains = (entityId: string) => selection.includes(entityId);

  return selection;
}

function createToolbarFallbackGestureContext(appHost: AppHost): GestureActionContext<AppHost> {
  return {
    workspace: appHost.workspace,
    appHost,
    keyboard: emptyKeyboardSnapshot(),
  } as unknown as GestureActionContext<AppHost>;
}

class TestInternalState {
  public activeTool: ActiveTool;

  public constructor(activeTool: ActiveTool) {
    this.activeTool = activeTool;
    makeAutoObservable(this, {}, { autoBind: true });
  }
}
