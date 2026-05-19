import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import {
  SHORTCUT_KEY,
  type ShortcutKeyId,
} from "@/app/actions/keyboard-shortcut-manager";
import type {
  CanvasTopLeftCornerToolbarShowButtonId,
  PlacementGroup,
} from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import { runInAction } from "mobx";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

// 桥接变量：触发点（UI 按钮 / 快捷键）写入，on-enter-active-tool("single-placement") 读取后立即置 null。
// 用于在 setActiveTool 触发生命周期事件之前，将进入参数暂存在模块内部，
// 避免受 mobx action reaction 时序影响。
type PendingPlacementEnter = {
  deviceId: string;
  anchor: GridPoint;
  pointerMode: "mouse" | "touch";
};

let pendingPlacementEnter: PendingPlacementEnter | null = null;

// 2026-05-19 订正：将进入参数从 state.runtime 中收回，改为手势模块私有闭包变量。
// 触发点只写此变量 + setActiveTool，on-enter 执行业务（创建 draft / 同步 UI）。
export function setPendingSinglePlacementEnter(data: PendingPlacementEnter): void {
  pendingPlacementEnter = data;
}

export const PLACEMENT_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-rotate",
  "canvas-floating-toolbar-button-ok",
] as const;

const CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID =
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement";
const TOGGLE_CONTINUOUS_PLACEMENT_ON =
  `${CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID}-on`;
const TOGGLE_CONTINUOUS_PLACEMENT_OFF =
  `${CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID}-off`;

const PLACEMENT_MODE_EVENT_PREFIX = "ui-left-dock-placement-mode-";
const DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

const PLACEMENT_GROUP_SHORTCUTS: Readonly<Record<PlacementGroup, ShortcutKeyId>> = {
  beltLogistics: SHORTCUT_KEY.PLACE_CONVEYOR,
  pipeLogistics: SHORTCUT_KEY.PLACE_PIPE,
  resourcePower: SHORTCUT_KEY.RESOURCES_POWER,
  warehouse: SHORTCUT_KEY.WAREHOUSE,
  basicProduction: SHORTCUT_KEY.BASIC_PRODUCTION,
  advancedManufacturing: SHORTCUT_KEY.SYNTHESIS,
};

export function createHypergryphSinglePlacementGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-single-placement-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "single-placement" || event.to === "single-placement") {
          return { status: "ignored" };
        }

        pendingPlacementEnter = null;
        cleanupPlacementDraft(context.appHost);
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "single-placement") {
          return { status: "ignored" };
        }

        // 桥接变量路径：触发点已写入全部参数，在此创建 draft 并同步 UI
        if (pendingPlacementEnter !== null) {
          const { deviceId, anchor, pointerMode } = pendingPlacementEnter;
          pendingPlacementEnter = null;

          closeCompactLeftDockOnPlacementEnter(context.appHost);

          context.appHost.internalState.runtime.placementAnchor = anchor;
          context.appHost.internalState.runtime.singlePlacementPointerMode = pointerMode;

          const editor = context.workspace.editor;
          if (editor !== null) {
            try {
              editor.actions.createSinglePlacementDraft(deviceId, anchor);
              const previewRect = editor.queries.findEntityCollectionGridRect(
                EntityCollectionType.preview,
              );
              if (previewRect === null) {
                restoreFailedPlacementEnter(context.appHost, editor);
                return { status: "handled" };
              }
              runInAction(() => {
                context.appHost.internalState.runtime.singlePlacementDeviceId = deviceId;
              });
            } catch {
              restoreFailedPlacementEnter(context.appHost, editor);
              return { status: "handled" };
            }
          }

          syncPlacementEntryUi(context.appHost, pointerMode);
          return { status: "handled" };
        }

        // 兜底：无桥接变量时保持原有逻辑
        closeCompactLeftDockOnPlacementEnter(context.appHost);
        syncPlacementEntryUi(context.appHost);
        return { status: "handled" };
      }

      if (event.type === "mouse move") {
        lastMousePosition = event.position;
      }

      if (
        event.type === "key down"
        && context.appHost.internalState.activeTool === "select"
      ) {
        const groupResult = handleSelectPlacementGroupShortcut({
          appHost: context.appHost,
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        });

        if (groupResult.status !== "ignored") {
          return groupResult;
        }

        const editor = context.workspace.editor;
        if (editor === null) {
          return { status: "ignored" };
        }

        return handleSelectPlacementDeviceShortcut({
          appHost: context.appHost,
          editor,
          registry: context.workspace.registry,
          lastMousePosition,
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        });
      }

      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-touch-tap") {
        const deviceId = parsePlacementModeDeviceId(event.uiButtonId, "touch");
        if (deviceId !== null) {
          return handlePlacementEntryButtonTap({
            appHost: context.appHost,
            editor,
            deviceId,
            source: "touch",
            allowFromAnyTool: true,
          });
        }
      }

      if (event.type === "ui-button-mouse-tap" && event.button === 0) {
        const deviceId = parsePlacementModeDeviceId(event.uiButtonId, "mouse");
        if (deviceId !== null) {
          return handlePlacementEntryButtonTap({
            appHost: context.appHost,
            editor,
            deviceId,
            source: "mouse",
            allowFromAnyTool: true,
          });
        }
      }

      if (context.appHost.internalState.activeTool !== "single-placement") {
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

          rotatePlacementPreview(context.appHost, editor);
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
            cancelPlacementOperation(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && !event.longPress) {
            applyPlacementOperation(context.appHost, editor, {
              keepPlacement: event.modifiers.ctrl || event.modifiers.shift,
            });
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.appHost,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.appHost, editor, {
              keepPlacement: context.appHost.internalState.runtime.singlePlacementContinuous,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotatePlacementPreview(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelPlacementOperation(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.appHost,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.appHost, editor, {
              keepPlacement: context.appHost.internalState.runtime.singlePlacementContinuous,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotatePlacementPreview(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelPlacementOperation(context.appHost, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handlePlacementEntryButtonTap(options: {
  appHost: AppHost;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  allowFromAnyTool?: boolean;
}): GestureHandleResult {
  const previousTool = options.appHost.internalState.activeTool;

  if (previousTool === "single-placement") {
    if (
      options.appHost.internalState.runtime.singlePlacementDeviceId
      === options.deviceId
    ) {
      return { status: "handled" };
    }

    safelyCancelPlacementDraft(options.editor);
    clearPlacementUi(options.appHost);

    return finalizePlacementEnter({
      appHost: options.appHost,
      editor: options.editor,
      deviceId: options.deviceId,
      source: options.source,
      initialPlacementAnchor: options.initialPlacementAnchor,
      shouldSetActiveTool: false,
    });
  }

  if (previousTool !== "select" && !options.allowFromAnyTool) {
    return { status: "ignored" };
  }

  return finalizePlacementEnter({
    appHost: options.appHost,
    editor: options.editor,
    deviceId: options.deviceId,
    source: options.source,
    initialPlacementAnchor: options.initialPlacementAnchor,
    shouldSetActiveTool: true,
  });
}

function handleSelectPlacementGroupShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): GestureHandleResult {
  const group = resolvePlacementGroupByShortcut(options);
  if (group === null) {
    return { status: "ignored" };
  }

  options.appHost.internalState.runtime.selectingPlacementGroup = group;
  return { status: "handled" };
}

function handleSelectPlacementDeviceShortcut(options: {
  appHost: AppHost;
  editor: EditorContract;
  registry: RegistryContract;
  lastMousePosition: GesturePosition | null;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  };
}): GestureHandleResult {
  const shortcutIndex = resolveDeviceShortcutIndex(options);
  if (shortcutIndex === null) {
    return { status: "ignored" };
  }

  const selectingGroup = options.appHost.internalState.runtime.selectingPlacementGroup;
  if (selectingGroup === null) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.registry,
    group: selectingGroup,
    shortcutIndex,
  });
  if (deviceId === null) {
    return { status: "ignored" };
  }

  const initialPlacementAnchor = resolveGridPointFromGesturePosition(
    options.editor,
    options.lastMousePosition,
  );

  return handlePlacementEntryButtonTap({
    appHost: options.appHost,
    editor: options.editor,
    deviceId,
    source: "mouse",
    initialPlacementAnchor,
  });
}

function finalizePlacementEnter(options: {
  appHost: AppHost;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  shouldSetActiveTool: boolean;
}): GestureHandleResult {
  const placementAnchor = options.initialPlacementAnchor
    ?? resolveViewportCenterGridPoint(options.editor);

  if (placementAnchor === null) {
    return { status: "ignored" };
  }

  // 2026-05-19 订正：shouldSetActiveTool 路径改为写桥接变量 + setActiveTool，
  // draft 创建和 UI 同步交由 on-enter-active-tool 统一处理，
  // 彻底消除"先切工具 vs 先创建 draft"的时序问题。
  if (options.shouldSetActiveTool) {
    setPendingSinglePlacementEnter({
      deviceId: options.deviceId,
      anchor: placementAnchor,
      pointerMode: options.source,
    });
    options.appHost.internalActions.setActiveTool("single-placement");
    return { status: "handled" };
  }

  // shouldSetActiveTool: false 路径：已在 single-placement 中，不走生命周期，保持原位创建
  try {
    options.appHost.internalState.runtime.placementAnchor = placementAnchor;
    options.appHost.internalState.runtime.singlePlacementPointerMode = options.source;
    options.editor.actions.createSinglePlacementDraft(options.deviceId, placementAnchor);

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null) {
      restoreFailedPlacementEnter(options.appHost, options.editor);
      return { status: "ignored" };
    }

    runInAction(() => {
      options.appHost.internalState.runtime.singlePlacementDeviceId = options.deviceId;
    });

    if (!syncPlacementEntryUi(options.appHost)) {
        restoreFailedPlacementEnter(options.appHost, options.editor);
        return { status: "ignored" };
    }

    return { status: "handled" };
  } catch {
    restoreFailedPlacementEnter(options.appHost, options.editor);
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

export function primePlacementAnchorFromPreview(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    if (!isPreviewEntityAtClientPoint(options.editor, options.position)) {
      options.appHost.internalState.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.editor.queries.findGridCellForClientPixlePoint(
      options.position,
    );

    if (anchor === null) {
      options.appHost.internalState.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.appHost.internalState.runtime.placementAnchor = anchor;
    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

export function drivePlacementPreview(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    const placementAnchor = options.appHost.internalState.runtime.placementAnchor;
    if (placementAnchor === null) {
      return { status: "ignored" };
    }

    const nextGridPoint = options.editor.queries.findGridCellForClientPixlePoint(
      options.position,
    );

    if (nextGridPoint === null) {
      return { status: "ignored" };
    }

    if (areGridPointsEqual(placementAnchor, nextGridPoint)) {
      return { status: "handled" };
    }

    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (beforeRect === null) {
      options.appHost.internalState.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: placementAnchor,
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
        startGridPoint: placementAnchor,
        endGridPoint: nextGridPoint,
      })
    ) {
      options.appHost.internalState.runtime.placementAnchor = nextGridPoint;
      options.appHost.internalActions.alignCanvasFloatingToolbar();
    }

    return { status: "handled" };
  } catch {
    options.appHost.internalState.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

function applyPlacementOperation(
  appHost: AppHost,
  editor: EditorContract,
  options: {
    keepPlacement?: boolean;
  } = {},
): void {
  const continuation = options.keepPlacement
    ? capturePlacementContinuationSnapshot(appHost, editor)
    : null;

  try {
    editor.actions.applyPlacementDraft();

    if (continuation !== null && continuePlacementOperation(appHost, editor, continuation)) {
      return;
    }
  } catch {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(appHost);
  appHost.internalActions.setActiveTool("select");
}

function cancelPlacementOperation(appHost: AppHost, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    clearPlacementUi(appHost);
    appHost.internalActions.setActiveTool("select");
  }
}

export function rotatePlacementPreview(appHost: AppHost, editor: EditorContract): void {
  editor.actions.rotateCollection(EntityCollectionType.preview);
  appHost.internalActions.alignCanvasFloatingToolbar();
}

export function cleanupPlacementDraft(appHost: AppHost): void {
  const editor = appHost.workspace.editor;
  if (editor !== null) {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(appHost);
}

function clearPlacementUi(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.runtime.placementAnchor = null;
    appHost.internalState.runtime.singlePlacementDeviceId = null;
    appHost.internalState.runtime.singlePlacementPointerMode = null;
    appHost.internalState.runtime.singlePlacementContinuous = false;
  });
  appHost.internalActions.hideCanvasFloatingToolbar();
  appHost.internalActions.hideCanvasTopLeftCornerToolbar();
}

export function closeCompactLeftDockOnPlacementEnter(appHost: AppHost): void {
  const deviceClass = appHost.state.screenProfile.deviceClass;
  if (
    (deviceClass !== "mobile" && deviceClass !== "tablet")
    || !appHost.state.workbench.leftDockOpen
  ) {
    return;
  }

  appHost.internalActions.toggleLeftDock();
}

function restoreFailedPlacementEnter(appHost: AppHost, editor: EditorContract): void {
  pendingPlacementEnter = null;
  safelyCancelPlacementDraft(editor);
  clearPlacementUi(appHost);
  appHost.internalActions.setActiveTool("select");
}

function safelyCancelPlacementDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; placement should not leave UI half-entered.
  }
}

export function syncPlacementEntryUi(
  appHost: AppHost,
  pointerMode = appHost.internalState.runtime.singlePlacementPointerMode,
): boolean {
  if (pointerMode === null) {
    return true;
  }

  if (pointerMode !== "touch") {
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.hideCanvasTopLeftCornerToolbar();
    return true;
  }

  appHost.internalActions.showCanvasTopLeftCornerToolbar(
    resolveSinglePlacementTopLeftToolbarButtonIds(appHost),
  );

  return appHost.internalActions.showCanvasFloatingToolbarForCollection(
    PLACEMENT_TOOLBAR_BUTTON_IDS,
    EntityCollectionType.preview,
  );
}

function handleContinuousPlacementToggleTap(
  appHost: AppHost,
  uiButtonId: string,
): GestureHandleResult | null {
  if (appHost.internalState.activeTool !== "single-placement") {
    return null;
  }

  switch (uiButtonId) {
    case TOGGLE_CONTINUOUS_PLACEMENT_ON:
      appHost.internalState.runtime.singlePlacementContinuous = true;
      return { status: "handled" };

    case TOGGLE_CONTINUOUS_PLACEMENT_OFF:
      appHost.internalState.runtime.singlePlacementContinuous = false;
      return { status: "handled" };

    default:
      return null;
  }
}

function resolveSinglePlacementTopLeftToolbarButtonIds(
  appHost: AppHost,
): readonly CanvasTopLeftCornerToolbarShowButtonId[] {
  return appHost.internalState.runtime.singlePlacementContinuous
    ? [TOGGLE_CONTINUOUS_PLACEMENT_OFF]
    : [CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID];
}

function capturePlacementContinuationSnapshot(
  appHost: AppHost,
  editor: EditorContract,
): {
  anchor: GridPoint;
  deviceId: string;
  pointerMode: "mouse" | "touch";
  rotation: GridRotation;
} | null {
  const deviceId = appHost.internalState.runtime.singlePlacementDeviceId;
  const anchor = appHost.internalState.runtime.placementAnchor;
  const pointerMode = appHost.internalState.runtime.singlePlacementPointerMode;

  if (deviceId === null || anchor === null || pointerMode === null) {
    return null;
  }

  return {
    anchor: { ...anchor },
    deviceId,
    pointerMode,
    rotation: resolveSinglePlacementPreviewRotation(editor),
  };
}

function continuePlacementOperation(
  appHost: AppHost,
  editor: EditorContract,
  continuation: {
    anchor: GridPoint;
    deviceId: string;
    pointerMode: "mouse" | "touch";
    rotation: GridRotation;
  },
): boolean {
  const result = finalizePlacementEnter({
    appHost,
    editor,
    deviceId: continuation.deviceId,
    source: continuation.pointerMode,
    initialPlacementAnchor: continuation.anchor,
    shouldSetActiveTool: false,
  });

  if (result.status !== "handled") {
    return false;
  }

  restorePlacementPreviewRotation(appHost, editor, continuation.rotation);
  return true;
}

function resolveSinglePlacementPreviewRotation(editor: EditorContract): GridRotation {
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  if (previewEntityId === null) {
    return 0;
  }

  return editor.queries.getEntityById(previewEntityId)?.rotation ?? 0;
}

function restorePlacementPreviewRotation(
  appHost: AppHost,
  editor: EditorContract,
  rotation: GridRotation,
): void {
  const rotateCount = rotation / 90;
  for (let step = 0; step < rotateCount; step += 1) {
    editor.actions.rotateCollection(EntityCollectionType.preview);
  }

  if (rotateCount > 0 && appHost.internalState.runtime.singlePlacementPointerMode === "touch") {
    appHost.internalActions.alignCanvasFloatingToolbar();
  }
}

function parsePlacementModeDeviceId(
  uiButtonId: string,
  source: "mouse" | "touch",
): string | null {
  const suffix = source === "mouse" ? "-mouse-tap" : "-touch-tap";

  if (
    !uiButtonId.startsWith(PLACEMENT_MODE_EVENT_PREFIX)
    || !uiButtonId.endsWith(suffix)
  ) {
    return null;
  }

  const deviceId = uiButtonId.slice(
    PLACEMENT_MODE_EVENT_PREFIX.length,
    uiButtonId.length - suffix.length,
  );

  return deviceId.length > 0 ? deviceId : null;
}

export function resolveViewportCenterGridPoint(editor: EditorContract): GridPoint | null {
  const clientRect = editor.state.viewport.clientRect;

  return editor.queries.findGridCellForClientPixlePoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
}

function resolveGridPointFromGesturePosition(
  editor: EditorContract,
  position: GesturePosition | null,
): GridPoint | null {
  if (position === null) {
    return null;
  }

  return editor.queries.findGridCellForClientPixlePoint(position);
}

function isPreviewEntityAtClientPoint(
  editor: EditorContract,
  position: GesturePosition,
): boolean {
  const entity = editor.queries.findEntityAtClientPixelPoint(position);

  return (
    entity !== null
    && editor.state.collections[EntityCollectionType.preview].contains(entity.id)
  );
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

export function resolvePlacementGroupByShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}): PlacementGroup | null {
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return null;
  }

  for (const [group, shortcutKeyId] of Object.entries(PLACEMENT_GROUP_SHORTCUTS)) {
    if (options.appHost.internalActions.isShortcutFor(shortcutKeyId, options.code, options.key)) {
      return group as PlacementGroup;
    }
  }

  return null;
}

export function resolveDeviceShortcutIndex(options: {
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  };
}): number | null {
  if (
    options.modifiers.alt
    || options.modifiers.ctrl
    || options.modifiers.meta
    || options.modifiers.shift
  ) {
    return null;
  }

  const key = options.key?.trim() ?? "";
  const shortcut = DEVICE_SHORTCUT_KEYS.find((candidate) => candidate === key)
    ?? resolveDeviceShortcutFromCode(options.code);

  if (shortcut === undefined) {
    return null;
  }

  const index = DEVICE_SHORTCUT_KEYS.indexOf(shortcut);
  return index >= 0 ? index : null;
}

function resolveDeviceShortcutFromCode(code: string | null): typeof DEVICE_SHORTCUT_KEYS[number] | undefined {
  const match = code?.match(/^(?:Digit|Numpad)([0-9])$/);
  const digit = match?.[1];
  if (digit === undefined) {
    return undefined;
  }

  return DEVICE_SHORTCUT_KEYS.find((shortcut) => shortcut === digit);
}

export function resolveDeviceIdForPlacementGroupShortcut(options: {
  registry: RegistryContract;
  group: PlacementGroup;
  shortcutIndex: number;
}): string | null {
  const entities = options.registry.entityDefinitions
    .filter((definition) => definition.uiGroup === options.group)
    .sort((left, right) => left.id.localeCompare(right.id));

  return entities[options.shortcutIndex]?.id ?? null;
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
