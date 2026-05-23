import { describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphSinglePlacementGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type { ClientPixelRect } from "@/domain/shared/client-pixel";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";

describe("createHypergryphSinglePlacementGestureModule", () => {
  it("enters mouse single-placement from a placement device button at the viewport center", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("device-a"), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理，
    // 触发点只写桥接变量 + setActiveTool。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith("device-a", {
      x: 50,
      y: 40,
    });
    expect(editor.actions.moveCollectionTo).not.toHaveBeenCalled();
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 50, y: 40 });
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("device-a");
    expect(appHost.internalActions.hideCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("enters from a placement button even when the current tool is not select", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementMouseTapEvent("device-a"), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("marquee", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith("device-a", {
      x: 50,
      y: 40,
    });
  });

  it("still only enters from select when using a number shortcut", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "marquee",
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(keyDownEvent({ code: "Digit3", key: "3" }), context);

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(appHost.internalState.activeTool).toBe("marquee");
  });

  it("enters touch single-placement and shows the floating toolbar for preview", () => {
    const { context, appHost } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(placementTouchTapEvent("device-a"), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST,
    ]);
    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection).toHaveBeenCalledWith(
      PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST,
      EntityCollectionType.preview,
    );
  });

  it("toggles touch continuous placement from the top-left toolbar", () => {
    const { context, appHost } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-on`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.singlePlacementContinuous).toBe(true);

    expect(
      module.handle(
        uiButtonTouchTapEvent(`${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.singlePlacementContinuous).toBe(false);
  });

  it("closes the left dock when entering single-placement on mobile and tablet", () => {
    for (const deviceClass of ["mobile", "tablet"] as const) {
      const { context, appHost } = createContext({
        deviceClass,
        leftDockOpen: true,
      });
      const module = createHypergryphSinglePlacementGestureModule();

      const result = module.handle(placementMouseTapEvent("device-a"), context);

      expect(result).toEqual({ status: "handled" });
      expect(appHost.internalActions.toggleLeftDock).not.toHaveBeenCalled();

      expect(
        module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
      ).toEqual({ status: "handled" });
      expect(appHost.internalActions.toggleLeftDock).toHaveBeenCalledTimes(1);
      expect(appHost.state.workbench.leftDockOpen).toBe(false);
    }
  });

  it("selects a placement group from its configured shortcut while in select", () => {
    const { context, editor, appHost } = createContext();
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(keyDownEvent({ code: "KeyG", key: "g" }), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.runtime.selectingPlacementGroup).toBe("resourcePower");
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
  });

  it("enters single-placement from the active placement group number shortcut", () => {
    const { context, editor, appHost } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(keyDownEvent({ code: "Digit3", key: "3" }), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith(
      "item_port_unloader_1",
      { x: 50, y: 40 },
    );
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("item_port_unloader_1");
  });

  it("uses the last mouse position when entering placement from a number shortcut", () => {
    const { context, editor, appHost } = createContext({
      selectingPlacementGroup: "warehouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseMoveEvent({ position: { x: 7.8, y: 8.1 } }), context)).toEqual({
      status: "ignored",
    });

    const result = module.handle(keyDownEvent({ code: "Digit3", key: "3" }), context);

    expect(result).toEqual({ status: "handled" });
    expect(appHost.internalState.activeTool).toBe("single-placement");
    // 2026-05-19 订正：draft 创建已移至 on-enter-active-tool 统一处理。
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(
      module.handle(onEnterActiveToolEvent("select", "single-placement"), context),
    ).toEqual({ status: "handled" });
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith(
      "item_port_unloader_1",
      { x: 7, y: 8 },
    );
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 7, y: 8 });
  });

  it("ignores number shortcuts when the active placement group has no target device for that slot", () => {
    const { context, editor, appHost } = createContext({
      selectingPlacementGroup: "resourcePower",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const result = module.handle(keyDownEvent({ code: "Digit4", key: "4" }), context);

    expect(result).toEqual({ status: "ignored" });
    expect(editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();
    expect(appHost.internalState.activeTool).toBe("select");
  });

  it("ignores the same device while switching different devices without resetting activeTool", () => {
    const same = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
    });
    const different = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 50, y: 40 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(placementMouseTapEvent("device-a"), same.context)).toEqual({
      status: "handled",
    });
    expect(same.editor.actions.cancelPlacementDraft).not.toHaveBeenCalled();
    expect(same.editor.actions.createSinglePlacementDraft).not.toHaveBeenCalled();

    expect(module.handle(placementMouseTapEvent("device-b"), different.context)).toEqual({
      status: "handled",
    });
    expect(different.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    expect(different.editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith("device-b", {
      x: 50,
      y: 40,
    });
    expect(different.appHost.internalActions.setActiveTool).not.toHaveBeenCalled();
    expect(different.appHost.internalState.activeTool).toBe("single-placement");
    expect(different.appHost.internalState.runtime.singlePlacementDeviceId).toBe("device-b");
  });

  it("moves the placement preview by incremental grid vectors and aligns toolbar", () => {
    const { context, editor, appHost, previewRectRef } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

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

    const result = module.handle(touchDragMoveEvent({ position: { x: 6, y: 4 } }), context);

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 5, y: 5 },
      endGridPoint: { x: 6, y: 4 },
    });
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 6, y: 4 });
    expect(appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("lets touch drag fall through when it does not start from the preview", () => {
    const { context, appHost } = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
      previewRect: { x: 5, y: 5, width: 1, height: 1 },
    });
    const module = createHypergryphSinglePlacementGestureModule();

    const missResult = module.handle(touchDragStartEvent({ position: { x: 2, y: 2 } }), context);

    expect(missResult).toEqual({ status: "ignored" });
    expect(appHost.internalState.runtime.placementAnchor).toBeNull();
  });

  it("rotates from the R key and toolbar button while placing", () => {
    const keyboard = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
    });
    const toolbar = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(keyDownEvent({ code: "KeyR", key: "r" }), keyboard.context)).toEqual({
      status: "handled",
    });
    expect(keyboard.appHost.internalActions.isShortcutFor).toHaveBeenCalledWith(
      SHORTCUT_KEY.ROTATE,
      "KeyR",
      "r",
    );
    expect(keyboard.editor.actions.rotateCollection).toHaveBeenCalledWith(
      EntityCollectionType.preview,
    );
    expect(keyboard.appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-rotate"), toolbar.context),
    ).toEqual({ status: "handled" });
    expect(toolbar.editor.actions.rotateCollection).toHaveBeenCalledWith(
      EntityCollectionType.preview,
    );
    expect(toolbar.appHost.internalActions.alignCanvasFloatingToolbar).toHaveBeenCalledTimes(1);
  });

  it("keeps mouse placement active when apply uses ctrl", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      singlePlacementPointerMode: "mouse",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(
        mouseTapEvent({
          button: 0,
          longPress: false,
          modifiers: { ctrl: true },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith("device-a", {
      x: 5,
      y: 5,
    });
    expect(appHost.internalActions.setActiveTool).not.toHaveBeenCalled();
    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 5, y: 5 });
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("device-a");
  });

  it("keeps touch placement active and preserves rotation when continuous placement is enabled", () => {
    const { context, editor, appHost } = createContext({
      activeTool: "single-placement",
      initialPreview: true,
      placementAnchor: { x: 5, y: 5 },
      previewRotation: 180,
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "device-a",
      singlePlacementPointerMode: "touch",
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-ok"), context),
    ).toEqual({ status: "handled" });

    expect(editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(editor.actions.createSinglePlacementDraft).toHaveBeenCalledWith("device-a", {
      x: 5,
      y: 5,
    });
    expect(editor.actions.rotateCollection).toHaveBeenCalledTimes(2);
    expect(appHost.internalActions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      `${CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST}-off`,
    ]);
    expect(appHost.internalActions.setActiveTool).not.toHaveBeenCalled();
    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.singlePlacementContinuous).toBe(true);
  });

  it("applies with mouse left tap and cancels from the toolbar", () => {
    const apply = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementDeviceId: "device-a",
      singlePlacementPointerMode: "mouse",
      initialPreview: true,
    });
    const cancel = createContext({
      activeTool: "single-placement",
      placementAnchor: { x: 5, y: 5 },
      singlePlacementContinuous: true,
      singlePlacementDeviceId: "device-a",
      singlePlacementPointerMode: "touch",
      initialPreview: true,
    });
    const module = createHypergryphSinglePlacementGestureModule();

    expect(module.handle(mouseTapEvent({ button: 0, longPress: false }), apply.context)).toEqual({
      status: "handled",
    });
    expect(apply.editor.actions.applyPlacementDraft).toHaveBeenCalledTimes(1);
    expect(apply.appHost.internalState.activeTool).toBe("select");
    expect(apply.appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(apply.appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();

    expect(
      module.handle(uiButtonTouchTapEvent("canvas-floating-toolbar-button-cancel"), cancel.context),
    ).toEqual({ status: "handled" });
    expect(cancel.editor.actions.cancelPlacementDraft).toHaveBeenCalledTimes(1);
    expect(cancel.appHost.internalActions.hideCanvasTopLeftCornerToolbar).toHaveBeenCalledTimes(1);
    expect(cancel.appHost.internalState.activeTool).toBe("select");
    expect(cancel.appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(cancel.appHost.internalState.runtime.singlePlacementContinuous).toBe(false);
    expect(cancel.appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();
  });
});

function createContext(options: {
  activeTool?: "select" | "move" | "marquee" | "single-placement";
  placementAnchor?: GridPoint | null;
  previewRotation?: 0 | 90 | 180 | 270;
  singlePlacementContinuous?: boolean;
  singlePlacementDeviceId?: string | null;
  singlePlacementPointerMode?: "mouse" | "touch" | null;
  selectingPlacementGroup?: "beltLogistics" | "pipeLogistics" | "resourcePower" | "warehouse" | "basicProduction" | "advancedManufacturing" | null;
  initialPreview?: boolean;
  previewRect?: GridRect;
  deviceClass?: "desktop" | "tablet" | "mobile";
  leftDockOpen?: boolean;
} = {}): {
  context: GestureActionContext<AppHost>;
  editor: MockEditor;
  appHost: AppHost;
  preview: MockCollection;
  previewRectRef: { current: GridRect };
} {
  const selection = createCollection([]);
  const marquee = createCollection([]);
  const reverseMarquee = createCollection([]);
  const preview = createCollection(options.initialPreview ? ["preview-entity"] : []);
  const ghost = createCollection([]);
  const previewRectRef = {
    current: options.previewRect ?? {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  };
  const previewEntity = entity("preview-entity", {
    x: previewRectRef.current.x,
    y: previewRectRef.current.y,
  }, options.previewRotation ?? 0);
  const viewportClientRect: ClientPixelRect = {
    left: 0,
    top: 0,
    width: 100,
    height: 80,
  };
  const editor: MockEditor = {
    state: {
      viewport: {
        center: { x: 0, y: 0 },
        clientRect: viewportClientRect,
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
      getEntityById: vi.fn((entityId) => (entityId === previewEntity.id ? previewEntity : null)),
      findEntityAtClientPixelPoint: vi.fn((point) => {
        const gridCell = {
          x: Math.floor(point.x),
          y: Math.floor(point.y),
        };

        if (
          preview.contains(previewEntity.id)
          && gridCell.x >= previewRectRef.current.x
          && gridCell.x < previewRectRef.current.x + previewRectRef.current.width
          && gridCell.y >= previewRectRef.current.y
          && gridCell.y < previewRectRef.current.y + previewRectRef.current.height
        ) {
          return previewEntity;
        }

        return null;
      }),
      findEntityCollectionGridRect: vi.fn((collectionType) =>
        collectionType === EntityCollectionType.preview && preview.length > 0
          ? previewRectRef.current
          : null,
      ),
      findGridCellForClientPixlePoint: vi.fn((point) => ({
        x: Math.floor(point.x),
        y: Math.floor(point.y),
      })),
      findClientRectForGridCell: vi.fn((cell) => ({
        left: cell.x,
        top: cell.y,
        width: 1,
        height: 1,
      })),
    },
    actions: {
      createSinglePlacementDraft: vi.fn(
        (deviceDefinitionId: string, centerGridPoint: GridPoint) => {
          previewEntity.definitionId = deviceDefinitionId;
          previewEntity.position = { ...centerGridPoint };
          previewEntity.rotation = 0;
          previewRectRef.current = {
            x: centerGridPoint.x,
            y: centerGridPoint.y,
            width: 1,
            height: 1,
          };
          preview.replace(["preview-entity"]);
        },
      ),
      cancelPlacementDraft: vi.fn(() => {
        preview.replace([]);
      }),
      applyPlacementDraft: vi.fn(() => {
        preview.replace([]);
        return true;
      }),
      moveCollectionTo: vi.fn(({
        startGridPoint,
        endGridPoint,
      }) => {
        const vector = {
          x: endGridPoint.x - startGridPoint.x,
          y: endGridPoint.y - startGridPoint.y,
        };
        previewRectRef.current = {
          ...previewRectRef.current,
          x: previewRectRef.current.x + vector.x,
          y: previewRectRef.current.y + vector.y,
        };
        previewEntity.position = {
          x: previewEntity.position.x + vector.x,
          y: previewEntity.position.y + vector.y,
        };
      }),
      rotateCollection: vi.fn(() => {
        previewEntity.rotation = rotateClockwise(previewEntity.rotation);
      }),
    },
  };
  const shortcuts: Record<string, string> = {
    "shortcut-place-conveyor": "E",
    "shortcut-place-pipe": "Q",
    "shortcut-resources-power": "G",
    "shortcut-warehouse": "C",
    "shortcut-basic-production": "V",
    "shortcut-synthesis": "B",
    "shortcut-rotate": "R",
  };
  const workbenchState = {
    leftDockOpen: options.leftDockOpen ?? true,
  };

  const appHost = {
    state: {
      settings: {
        hypergryphOperationMode: true,
      },
      activeTool: options.activeTool ?? "select",
      screenProfile: {
        deviceClass: options.deviceClass ?? "desktop",
      },
      workbench: workbenchState,
    },
    internalState: {
      activeTool: options.activeTool ?? "select",
      workbench: workbenchState,
      runtime: {
        placementAnchor: options.placementAnchor ?? null,
        singlePlacementContinuous: options.singlePlacementContinuous ?? false,
        singlePlacementDeviceId: options.singlePlacementDeviceId ?? null,
        singlePlacementPointerMode: options.singlePlacementPointerMode ?? null,
        selectingPlacementGroup: options.selectingPlacementGroup ?? null,
        canvasFloatingToolbar: {
          visible: false,
          buttonIds: [],
          anchor: null,
          attachedCollection: null,
          measuredSize: null,
        },
        canvasTopLeftCornerToolbar: {
          visible: false,
          buttonIds: [],
          initialOffButtonIds: [],
        },
      },
    },
    internalActions: {
      setActiveTool: vi.fn((activeTool) => {
        appHost.internalState.activeTool = activeTool;
      }),
      toggleLeftDock: vi.fn(() => {
        appHost.internalState.workbench.leftDockOpen = !appHost.internalState.workbench.leftDockOpen;
      }),
      showCanvasFloatingToolbarForCollection: vi.fn((buttonIds, collectionType) => {
        if (editor.queries.findEntityCollectionGridRect(collectionType) === null) {
          return false;
        }

        appHost.internalState.runtime.canvasFloatingToolbar.visible = true;
        appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [...buttonIds];
        appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = collectionType;
        return true;
      }),
      hideCanvasFloatingToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasFloatingToolbar.visible = false;
        appHost.internalState.runtime.canvasFloatingToolbar.buttonIds = [];
        appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection = null;
      }),
      showCanvasTopLeftCornerToolbar: vi.fn((buttonIds) => {
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [...buttonIds];
      }),
      hideCanvasTopLeftCornerToolbar: vi.fn(() => {
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
        appHost.internalState.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds = [];
      }),
      alignCanvasFloatingToolbar: vi.fn(() => true),
      getKeyboardShortcutFor: vi.fn((key: string) => shortcuts[key] ?? ""),
      isShortcutFor: vi.fn((key: string, code: string | null, eventKey?: string | null) => {
        const shortcut = (shortcuts[key] ?? "").trim().toLowerCase();
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
        editor,
        registry: createRegistryContract(),
      } as unknown as WorkspaceContract,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    editor,
    appHost,
    preview,
    previewRectRef,
  };
}

const PLACEMENT_TOOLBAR_BUTTON_IDS_FOR_TEST = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const CONTINUOUS_PLACEMENT_BUTTON_ID_FOR_TEST =
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement";

type MockCollection = string[] & {
  contains(entityId: string): boolean;
  replace(entityIds: readonly string[]): void;
};

type MockEditor = {
  state: Pick<EditorContract["state"], "collections" | "viewport">;
  actions: Pick<
    EditorContract["actions"],
    | "applyPlacementDraft"
    | "cancelPlacementDraft"
    | "createSinglePlacementDraft"
    | "moveCollectionTo"
    | "rotateCollection"
  >;
  queries: Pick<
    EditorContract["queries"],
    | "getEntityById"
    | "findClientRectForGridCell"
    | "findEntityAtClientPixelPoint"
    | "findEntityCollectionGridRect"
    | "findGridCellForClientPixlePoint"
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

function entity(id: string, position: GridPoint, rotation: 0 | 90 | 180 | 270): WorldEntity {
  return {
    id,
    definitionId: "device-a",
    position,
    rotation,
    config: {},
    tags: [],
  };
}

function placementMouseTapEvent(deviceId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "placement-mouse-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-mouse-tap`,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function placementTouchTapEvent(deviceId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "placement-touch-tap-1",
    uiButtonId: `ui-left-dock-placement-mode-${deviceId}-touch-tap`,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: { position: GridPoint }) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position,
    startPosition: options.position,
    activeTouchCount: 1,
    longPress: true,
    pointerEntity: null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragMoveEvent(options: { position: GridPoint }) {
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

function mouseMoveEvent(options: { position: { x: number; y: number } }) {
  return {
    type: "mouse move" as const,
    gestureId: "mouse-move-1",
    buttons: 0,
    position: options.position,
    delta: { x: 0, y: 0 },
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

function onEnterActiveToolEvent(
  from: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
  to: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
) {
  return {
    type: "on-enter-active-tool" as const,
    gestureId: "enter-active-tool-1",
    from,
    to,
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

function rotateClockwise(rotation: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  switch (rotation) {
    case 0:
      return 90;
    case 90:
      return 180;
    case 180:
      return 270;
    case 270:
      return 0;
  }
}
