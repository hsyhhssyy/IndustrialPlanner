import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import {
  canPlaceEntityDefinitionInCurrentBase,
  hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import {
  SHORTCUT_KEY,
  type ShortcutKeyId,
} from "@/app/actions/keyboard-shortcut-manager";
import type {
  CanvasFloatingToolbarButtonId,
  CanvasRightDockToolbarItemRequest,
  CanvasTopLeftCornerToolbarShowButtonId,
  PlacementGroup,
} from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { collapseEntityVariantDefinitions } from "@/shared/entity-variants";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import { runInAction } from "mobx";

import type { GestureHandleResult, GestureMappingModule, ShortcutActionRoute } from "../types";
// AI-REMOVED 2026-09-10:
// Reason: 操作模式总开关已废弃，不再保留关闭分支
// Trigger: 用户要求彻底移除 hypergryphOperationMode。
// Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
// Replacement: gesture-action-router.ts 的默认启用语义
// Risk: 历史 false 设置统一使用当前操作行为。
// Human Review: Required
//
// Original code:
// import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  didPreviewRectChange,
  isPreviewBoundingBoxAtClientPoint,
  resolveTouchDragAnchorAfterPreviewMove,
  TOUCH_PREVIEW_HIT_SLOP_PX,
} from "./mobile-preview-bounds";

// 桥接变量：触发点（UI 按钮 / 快捷键）写入，on-enter-active-tool("single-placement") 读取后立即置 null。
// 用于在 setActiveTool 触发生命周期事件之前，将进入参数暂存在模块内部，
// 避免受 mobx action reaction 时序影响。
type PendingPlacementEnter = {
  deviceId: string;
  anchor: GridPoint;
  pointerMode: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
};

// AI-REMOVED 2026-11-12:
// Reason: 模块全局桥接值会串扰多张画布。
// Trigger: REQ-048 画布交互隔离。
// Evidence: 两个 Router 共用此模块作用域。
// Replacement: CanvasInteractionController.pendingPlacementEnter
// Risk: 需验证连续放置及工具切换顺序。
// Human Review: Required
// Original code:
// let pendingPlacementEnter: PendingPlacementEnter | null = null;


// 2026-05-19 订正：将进入参数从 state.runtime 中收回，改为手势模块私有闭包变量。
// 触发点只写此变量 + setActiveTool，on-enter 执行业务（创建 draft / 同步 UI）。
export function setPendingSinglePlacementEnter(canvas: CanvasInteractionController, data: PendingPlacementEnter): void {
  canvas.pendingPlacementEnter = data;
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
export const PLACEMENT_DEVICE_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "switch-device-variant", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "continuous-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const PLACEMENT_GROUP_SHORTCUTS = {
  beltLogistics: SHORTCUT_KEY.PLACE_CONVEYOR,
  pipeLogistics: SHORTCUT_KEY.PLACE_PIPE,
  resourcePower: SHORTCUT_KEY.RESOURCES_POWER,
  warehouse: SHORTCUT_KEY.WAREHOUSE,
  basicProduction: SHORTCUT_KEY.BASIC_PRODUCTION,
  advancedManufacturing: SHORTCUT_KEY.SYNTHESIS,
  cheat: SHORTCUT_KEY.CHEAT,
} as const satisfies Partial<Record<PlacementGroup, ShortcutKeyId>>;

export function createHypergryphSinglePlacementGestureModule(): GestureMappingModule<AppHost> {
  let lastMousePosition: GesturePosition | null = null;

  // AI-DIAG 2026-05-21: placement preview 性能统计
  let perfCallCount = 0
  let perfTotalMs = 0
  let perfFindGridMs = 0
  let perfBeforeRectMs = 0
  let perfMoveCollectionMs = 0
  let perfAfterRectMs = 0
  let perfAlignToolbarMs = 0
  let perfSkippedCount = 0
  const PERF_WINDOW_CALLS = 100

  const flushPlacementPreviewPerf = (activeToolName: string) => {
    if (perfCallCount >= PERF_WINDOW_CALLS) {
      console.debug("[placement-preview-perf] " + JSON.stringify({
        calls: perfCallCount,
        skipped: perfSkippedCount,
        activeTool: activeToolName,
        avgTotalMs: Math.round((perfTotalMs / perfCallCount) * 100) / 100,
        avgFindGridMs: Math.round((perfFindGridMs / perfCallCount) * 100) / 100,
        avgBeforeRectMs: Math.round((perfBeforeRectMs / perfCallCount) * 100) / 100,
        avgMoveCollectionMs: Math.round((perfMoveCollectionMs / perfCallCount) * 100) / 100,
        avgAfterRectMs: Math.round((perfAfterRectMs / perfCallCount) * 100) / 100,
        avgAlignToolbarMs: Math.round((perfAlignToolbarMs / perfCallCount) * 100) / 100,
      }))
      perfCallCount = 0
      perfTotalMs = 0
      perfFindGridMs = 0
      perfBeforeRectMs = 0
      perfMoveCollectionMs = 0
      perfAfterRectMs = 0
      perfAlignToolbarMs = 0
      perfSkippedCount = 0
    }
  }

  const drivePlacementPreviewWithPerf = (options: {
    canvas: CanvasInteractionController;
    editor: EditorContract;
    position: GesturePosition;
  }): GestureHandleResult => {
    const placementAnchor = options.canvas.state.runtime.placementAnchor;
    if (placementAnchor === null) {
      return { status: "ignored" };
    }

    const debugOn = options.canvas.workbench.internalState.settings?.debugMode === true

    const startedAtMs = debugOn ? performance.now() : 0
    const t0 = debugOn ? performance.now() : 0
    const nextGridPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
    if (debugOn) perfFindGridMs += performance.now() - t0

    if (nextGridPoint === null) {
      if (debugOn) {
        perfTotalMs += performance.now() - startedAtMs
        perfCallCount += 1
        perfSkippedCount += 1
      }
      return { status: "ignored" };
    }

    if (areGridPointsEqual(placementAnchor, nextGridPoint)) {
      if (debugOn) {
        perfTotalMs += performance.now() - startedAtMs
        perfCallCount += 1
        perfSkippedCount += 1
      }
      return { status: "handled" };
    }

    const t1 = debugOn ? performance.now() : 0
    const beforeRect = options.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (debugOn) perfBeforeRectMs += performance.now() - t1

    if (beforeRect === null) {
      if (debugOn) {
        perfTotalMs += performance.now() - startedAtMs
        perfCallCount += 1
      }
      return { status: "ignored" };
    }

    // 非跳过路径: drivePlacementPreview 核心逻辑
    const t2 = debugOn ? performance.now() : 0
    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: placementAnchor,
      endGridPoint: nextGridPoint,
    });
    if (debugOn) perfMoveCollectionMs += performance.now() - t2

    const t3 = debugOn ? performance.now() : 0
    const movedRect = options.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (movedRect !== null && didPreviewRectChange(beforeRect, movedRect)) {
      rotatePlacementPreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        pointerMode: options.canvas.state.runtime.singlePlacementPointerMode,
        currentMousePosition: null,
      });
    }
    const afterRect = options.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (debugOn) perfAfterRectMs += performance.now() - t3

    if (afterRect !== null) {
      options.canvas.state.runtime.placementAnchor = resolveTouchDragAnchorAfterPreviewMove({
        beforeRect,
        afterRect,
        startGridPoint: placementAnchor,
        endGridPoint: nextGridPoint,
      });

      if (didPreviewRectChange(beforeRect, afterRect)) {
        const t4 = debugOn ? performance.now() : 0
        options.canvas.actions.alignCanvasFloatingToolbar();
        if (debugOn) perfAlignToolbarMs += performance.now() - t4
      }
    }

    if (debugOn) {
      perfTotalMs += performance.now() - startedAtMs
      perfCallCount += 1
    }
    return { status: "handled" };
  }

  return {
    id: "hypergryph-single-placement-gesture",
    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: gesture-action-router.ts 的默认启用语义
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // when: isHypergryphGestureEnabled,
    shortcutRoutes: [
      ...(Object.entries(PLACEMENT_GROUP_SHORTCUTS) as Array<[PlacementGroup, ShortcutKeyId]>)
        .filter(([group]) => group !== "beltLogistics" && group !== "pipeLogistics")
        .map<ShortcutActionRoute<AppHost>>(([group, shortcutId]) => ({
          id: `placement-group.${group}`,
          operation: "confirm-placement",
          actionId: shortcutId,
          binding: { kind: "configurable" as const, shortcutId },
          scope: { inputLayers: ["canvas"] as const, activeTools: ["select"] as const },
          triggerPolicy: {
            kind: "allow-additional-modifiers" as const,
            modifiers: ["shift"] as const,
          },
          handle: (_event, context) => handleSelectPlacementGroup(context.canvas, group),
        })),
      ...PLACEMENT_DEVICE_SHORTCUT_KEYS.map<ShortcutActionRoute<AppHost>>((shortcut, shortcutIndex) => ({
        id: `placement-device.${shortcutIndex}`,
        operation: "confirm-placement",
        actionId: `fixed.placement-device.${shortcutIndex}`,
        binding: { kind: "fixed" as const, value: shortcut },
        scope: { inputLayers: ["canvas"] as const, activeTools: ["select"] as const },
        triggerPolicy: { kind: "exact" as const },
        handle: (_event, context) => handleSelectPlacementDeviceShortcutIndex({
          canvas: context.canvas,
          editor: context.canvas.editor,
          registry: context.canvas.registry,
          lastMousePosition,
          shortcutIndex,
        }),
      })),
      {
        id: "single-placement.switch-device-mode",
        operation: "switch-device-variant",
        actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
        scope: { inputLayers: ["canvas"], activeTools: ["single-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        handle(_event, context) {
          const editor = context.canvas.editor;
          return editor === null
            ? { status: "ignored" }
            : switchPlacementPreviewVariant(context.canvas, editor, lastMousePosition);
        },
      },
      {
        id: "current-operation.rotate-single-placement",
        operation: "rotate-placement",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["single-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          rotatePlacementPreview(context.canvas, editor, {
            pointerMode: context.canvas.state.runtime.singlePlacementPointerMode,
            currentMousePosition: lastMousePosition,
          });
          return { status: "handled" };
        },
      },
    ],
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "single-placement" || event.to === "single-placement") {
          return { status: "ignored" };
        }

        context.canvas.pendingPlacementEnter = null;
        cleanupPlacementDraft(context.canvas);
        if (event.to === "select") {
          context.canvas.setPlacementPanelSuppressed(false);
        }
        flushPlacementPreviewPerf("on-exit-single-placement")
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "single-placement") {
          return { status: "ignored" };
        }

        // 桥接变量路径：触发点已写入全部参数，在此创建 draft 并同步 UI
        if (context.canvas.pendingPlacementEnter !== null) {
          const { deviceId, anchor, pointerMode, initialMousePosition } = context.canvas.pendingPlacementEnter;
          context.canvas.pendingPlacementEnter = null;

          closeCompactLeftDockOnPlacementEnter(context.canvas);

          const editor = context.canvas.editor;

          // 2026-06-23 订正：mouse 模式延迟创建 draft，鼠标滑入 canvas 时才出现。
          // 但如果鼠标在点击时已位于 viewport 内（如快捷键触发），则立即创建。
          if (pointerMode === "mouse") {
            context.canvas.state.runtime.singlePlacementPointerMode = pointerMode;
            runInAction(() => {
              context.canvas.state.runtime.singlePlacementDeviceId = deviceId;
            });

            if (
              editor !== null
              && initialMousePosition !== null
              && isClientPointInsideViewport(context.canvas.view, initialMousePosition)
            ) {
              const gridPoint = context.canvas.view.queries.findGridCellForClientPixelPoint(initialMousePosition);
              if (gridPoint !== null) {
                try {
                  context.canvas.createPlacementDraft({ definitionId: deviceId, centerGridPoint: gridPoint });
                  context.canvas.state.runtime.placementAnchor = gridPoint;
                } catch {
                  restoreFailedPlacementEnter(context.canvas, editor);
                  return { status: "handled" };
                }
              } else {
                context.canvas.state.runtime.placementAnchor = null;
              }
            } else {
              context.canvas.state.runtime.placementAnchor = null;
            }

            syncPlacementEntryUi(context.canvas, pointerMode);
            return { status: "handled" };
          }

          // touch 模式保持原有逻辑：立即创建 draft
          context.canvas.state.runtime.placementAnchor = anchor;
          context.canvas.state.runtime.singlePlacementPointerMode = pointerMode;

          if (editor !== null) {
            try {
              context.canvas.createPlacementDraft({ definitionId: deviceId, centerGridPoint: anchor });
              const previewRect = editor.queries.findEntityCollectionGridRect(
                EntityCollectionType.preview,
              );
              if (previewRect === null) {
                restoreFailedPlacementEnter(context.canvas, editor);
                return { status: "handled" };
              }
              runInAction(() => {
                context.canvas.state.runtime.singlePlacementDeviceId = deviceId;
              });
            } catch {
              restoreFailedPlacementEnter(context.canvas, editor);
              return { status: "handled" };
            }
          }

          syncPlacementEntryUi(context.canvas, pointerMode);
          return { status: "handled" };
        }

        // 兜底：无桥接变量时保持原有逻辑
        closeCompactLeftDockOnPlacementEnter(context.canvas);
        syncPlacementEntryUi(context.canvas);
        return { status: "handled" };
      }

      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }

      // AI-REMOVED 2026-08-30:
      // Reason: select 下的 7 个放置分组与 10 个固定数字键已迁入独立 Route。
      // Trigger: ST2-RQ-020 要求固定 Action 与可配置 Action 一起参与输入层关系。
      // Evidence: placement-group.* 与 placement-device.* Route 均限定 canvas/select。
      // Replacement: shortcutRoutes in createHypergryphSinglePlacementGestureModule
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      /*
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
      */

      const editor = context.canvas.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-touch-tap") {
        const deviceId = parsePlacementModeDeviceId(event.uiButtonId, "touch");
        if (deviceId !== null) {
          return handlePlacementEntryButtonTap({
            canvas: context.canvas,
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
            canvas: context.canvas,
            editor,
            deviceId,
            source: "mouse",
            allowFromAnyTool: true,
            initialMousePosition: lastMousePosition,
          });
        }
      }

      if (context.canvas.state.activeTool !== "single-placement") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          return { status: "handled" };

        // AI-REMOVED 2026-08-30:
        // Reason: 单体放置的 Tab 与 R 已迁入同 Action 的模式 Route。
        // Trigger: ST2-RQ-020 操作模式 modifier 语义统一。
        // Evidence: single-placement.switch-device-mode/current-operation.rotate-single-placement。
        // Replacement: shortcutRoutes in createHypergryphSinglePlacementGestureModule
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
            return switchPlacementPreviewVariant(context.appHost, editor, lastMousePosition);
          }

          if (!isRotatePlacementShortcut({
            appHost: context.appHost,
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          })) {
            return { status: "ignored" };
          }

          rotatePlacementPreview(context.appHost, editor, {
            pointerMode: context.appHost.internalState.runtime.singlePlacementPointerMode,
            currentMousePosition: lastMousePosition,
          });
          return { status: "handled" };
        */

        case "mouse dragstart":
          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return handlePlacementMouseDragStart({
            canvas: context.canvas,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          return primePlacementAnchorFromPreview({
            canvas: context.canvas,
            editor,
            position: event.startPosition,
            hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
          });

        case "mouse move":
          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragmove":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          if (!ensurePlacementDraftForMouse(context.canvas, editor, event.position)) {
            return { status: "handled" };
          }
          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "touch dragmove":
          return drivePlacementPreviewWithPerf({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragend":
          return (
            event.originButton === 0
            && context.canvas.state.runtime.placementAnchor !== null
          )
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return context.canvas.state.runtime.placementAnchor !== null
            ? { status: "handled" }
            : { status: "ignored" };

        case "mouse tap":
          if (event.button === 2) {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && !event.longPress) {
            applyPlacementOperation(context.canvas, editor, {
              keepPlacement: event.modifiers.ctrl || event.modifiers.shift,
              currentMousePosition: event.position,
            });
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.canvas,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
            return switchPlacementPreviewVariant(context.canvas, editor, null);
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.canvas, editor, {
              keepPlacement: context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: null,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotatePlacementPreview(context.canvas, editor, {
              pointerMode: "touch",
              currentMousePosition: null,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          {
            const toggleResult = handleContinuousPlacementToggleTap(
              context.canvas,
              event.uiButtonId,
            );
            if (toggleResult !== null) {
              return toggleResult;
            }
          }

          if (event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID) {
            return switchPlacementPreviewVariant(context.canvas, editor, lastMousePosition);
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyPlacementOperation(context.canvas, editor, {
              keepPlacement: context.canvas.state.runtime.singlePlacementContinuous,
              currentMousePosition: lastMousePosition,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotatePlacementPreview(context.canvas, editor, {
              pointerMode: "mouse",
              currentMousePosition: lastMousePosition,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelPlacementOperation(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          flushPlacementPreviewPerf(context.canvas.state.activeTool)
          return { status: "ignored" };
      }
    },
  };
}

function handlePlacementEntryButtonTap(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  initialMousePosition?: GesturePosition | null;
  allowFromAnyTool?: boolean;
}): GestureHandleResult {
  const previousTool = options.canvas.state.activeTool;
  const definition = options.canvas.registry.entityDefinitions.find((entry) => entry.id === options.deviceId);
  if (definition !== undefined && !canPlaceEntityDefinitionInCurrentBase(options.canvas, definition)) {
    return { status: "ignored" };
  }

  if (previousTool === "single-placement") {
    if (
      options.canvas.state.runtime.singlePlacementDeviceId
      === options.deviceId
    ) {
      return { status: "handled" };
    }

    safelyCancelPlacementDraft(options.editor);
    clearPlacementUi(options.canvas);

    return finalizePlacementEnter({
      canvas: options.canvas,
      editor: options.editor,
      deviceId: options.deviceId,
      source: options.source,
      initialPlacementAnchor: options.initialPlacementAnchor,
      initialMousePosition: options.initialMousePosition ?? null,
      shouldSetActiveTool: false,
    });
  }

  if (previousTool !== "select" && !options.allowFromAnyTool) {
    return { status: "ignored" };
  }

  return finalizePlacementEnter({
    canvas: options.canvas,
    editor: options.editor,
    deviceId: options.deviceId,
    source: options.source,
    initialPlacementAnchor: options.initialPlacementAnchor,
    initialMousePosition: options.initialMousePosition ?? null,
    shouldSetActiveTool: true,
  });
}

// AI-REMOVED 2026-08-30:
// Reason: Route 已确定放置分组，handler 不再重复解析按键。
// Trigger: ST2-RQ-020 可执行 Route 单一事实源。
// Evidence: placement-group.* Route 直接把 group 传入替代函数。
// Replacement: handleSelectPlacementGroup in this file
// Risk: Low
// Human Review: Required
//
// Original code:
// function handleSelectPlacementGroupShortcut(options: {
//   appHost: AppHost;
//   code: string | null;
//   key: string | null;
//   modifiers: { alt: boolean; ctrl: boolean; meta: boolean };
// }): GestureHandleResult {
//   const group = resolvePlacementGroupByShortcut(options);
//   if (group === null) return { status: "ignored" };
//   if (!hasPlaceableEntityDefinitionInCurrentBase(options.appHost, group)) {
//     return { status: "ignored" };
//   }
//   options.appHost.internalState.runtime.selectingPlacementGroup = group;
//   return { status: "handled" };
// }
function handleSelectPlacementGroup(canvas: CanvasInteractionController, group: PlacementGroup): GestureHandleResult {
  if (!canvas.canUseWorkbenchActions || !canvas.isOperationEnabled("confirm-placement")
    || !hasPlaceableEntityDefinitionInCurrentBase(canvas, group)) {
    return { status: "ignored" };
  }

  canvas.state.runtime.selectingPlacementGroup = group;
  return { status: "handled" };
}

// AI-REMOVED 2026-08-30:
// Reason: 固定数字键 Route 已解析 shortcutIndex，handler 不再重复解析键盘事件。
// Trigger: ST2-RQ-020 固定 Action 路由统一。
// Evidence: placement-device.* Route 直接携带 shortcutIndex。
// Replacement: handleSelectPlacementDeviceShortcutIndex below
// Risk: Low
// Human Review: Required
//
// Original code:
// function handleSelectPlacementDeviceShortcut(options: {
//   appHost: AppHost;
//   editor: EditorContract;
//   registry: RegistryContract;
//   lastMousePosition: GesturePosition | null;
//   code: string | null;
//   key: string | null;
//   modifiers: {
//     alt: boolean;
//     ctrl: boolean;
//     meta: boolean;
//     shift: boolean;
//   };
// }): GestureHandleResult {
//   const shortcutIndex = resolveDeviceShortcutIndex(options);
//   if (shortcutIndex === null) {
//     return { status: "ignored" };
//   }
function handleSelectPlacementDeviceShortcutIndex(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  registry: RegistryContract;
  lastMousePosition: GesturePosition | null;
  shortcutIndex: number;
}): GestureHandleResult {
  if (options.editor === null || !options.canvas.canUseWorkbenchActions
    || !options.canvas.isOperationEnabled("confirm-placement")) {
    return { status: "ignored" };
  }

  const selectingGroup = options.canvas.state.runtime.selectingPlacementGroup;
  if (selectingGroup === null) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.registry,
    group: selectingGroup,
    shortcutIndex: options.shortcutIndex,
    collapseDeviceModes: options.canvas.workbench.state.settings.collapseDeviceModes,
    selectedVariantNameByCraftGroup:
      options.canvas.workbench.state.workbench.selectedPlacementVariantByCraftGroup,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInCurrentBase(
      options.canvas,
      definition,
    ),
  });
  if (deviceId === null) {
    return { status: "ignored" };
  }

  const initialPlacementAnchor = resolveGridPointFromGesturePosition(
    options.canvas.view,
    options.lastMousePosition,
  );

  return handlePlacementEntryButtonTap({
    canvas: options.canvas,
    editor: options.editor,
    deviceId,
    source: "mouse",
    initialPlacementAnchor,
    initialMousePosition: options.lastMousePosition,
  });
}

function finalizePlacementEnter(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  deviceId: string;
  source: "mouse" | "touch";
  initialPlacementAnchor?: GridPoint | null;
  initialMousePosition: GesturePosition | null;
  shouldSetActiveTool: boolean;
}): GestureHandleResult {
  const placementAnchor = options.initialPlacementAnchor
    ?? resolveViewportCenterGridPoint(options.canvas.view);

  if (placementAnchor === null) {
    return { status: "ignored" };
  }

  // 2026-05-19 订正：shouldSetActiveTool 路径改为写桥接变量 + setActiveTool，
  // draft 创建和 UI 同步交由 on-enter-active-tool 统一处理，
  // 彻底消除"先切工具 vs 先创建 draft"的时序问题。
  if (options.shouldSetActiveTool) {
    setPendingSinglePlacementEnter(options.canvas, {
      deviceId: options.deviceId,
      anchor: placementAnchor,
      pointerMode: options.source,
      initialMousePosition: options.initialMousePosition,
    });
    options.canvas.actions.setActiveTool("single-placement");
    return { status: "handled" };
  }

  // shouldSetActiveTool: false 路径：已在 single-placement 中，不走生命周期，保持原位创建
  try {
    // 2026-06-23 订正：mouse 模式延迟创建 draft。
    // 仅当鼠标不在 viewport 内且为全新入口（无 initialPlacementAnchor）时才延迟。
    // 有 initialPlacementAnchor 时（如快捷键、continuation）说明鼠标在 canvas 内，立即创建。
    const isFreshMouseEntry =
      options.initialPlacementAnchor === undefined
      && options.source === "mouse"
      && (options.initialMousePosition === null
          || !isClientPointInsideViewport(options.canvas.view, options.initialMousePosition));

    if (isFreshMouseEntry) {
      options.canvas.state.runtime.placementAnchor = null;
      options.canvas.state.runtime.singlePlacementPointerMode = options.source;
      runInAction(() => {
        options.canvas.state.runtime.singlePlacementDeviceId = options.deviceId;
      });
      syncPlacementEntryUi(options.canvas);
      return { status: "handled" };
    }

    options.canvas.state.runtime.placementAnchor = placementAnchor;
    options.canvas.state.runtime.singlePlacementPointerMode = options.source;
    options.canvas.createPlacementDraft({ definitionId: options.deviceId, centerGridPoint: placementAnchor });

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null) {
      restoreFailedPlacementEnter(options.canvas, options.editor);
      return { status: "ignored" };
    }

    if (
      options.source === "mouse"
      && options.initialMousePosition !== null
      && isClientPointInsideViewport(options.canvas.view, options.initialMousePosition)
    ) {
      options.editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.initialMousePosition, options.canvas.view.state,
      );
      const movedRect = options.editor.queries.findEntityCollectionGridRect(
        EntityCollectionType.preview,
      );
      if (movedRect !== null && didPreviewRectChange(previewRect, movedRect)) {
        rotatePlacementPreviewToBuildingSnap({
          canvas: options.canvas,
          editor: options.editor,
          trigger: "after-move",
          pointerMode: "mouse",
          currentMousePosition: options.initialMousePosition,
        });
      }
    }

    runInAction(() => {
      options.canvas.state.runtime.singlePlacementDeviceId = options.deviceId;
    });

    if (!syncPlacementEntryUi(options.canvas)) {
        restoreFailedPlacementEnter(options.canvas, options.editor);
        return { status: "ignored" };
    }

    return { status: "handled" };
  } catch {
    restoreFailedPlacementEnter(options.canvas, options.editor);
    return { status: "ignored" };
  }
}

function handlePlacementMouseDragStart(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton !== 0) {
    return { status: "ignored" };
  }

  if (options.canvas.state.runtime.placementAnchor !== null) {
    return { status: "handled" };
  }

  return primePlacementAnchorFromPreview({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
  });
}

export function primePlacementAnchorFromPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  hitSlopPx?: number;
}): GestureHandleResult {
  try {
    if (!isPreviewEntityAtClientPoint(
      options.editor, options.canvas.view,
      options.position,
      options.hitSlopPx,
    )) {
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(
      options.position,
    );

    if (anchor === null) {
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.canvas.state.runtime.placementAnchor = anchor;
    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

export function drivePlacementPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    const placementAnchor = options.canvas.state.runtime.placementAnchor;
    if (placementAnchor === null) {
      return { status: "ignored" };
    }

    const nextGridPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(
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
      options.canvas.state.runtime.placementAnchor = null;
      return { status: "ignored" };
    }

    options.editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: placementAnchor,
      endGridPoint: nextGridPoint,
    });

    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && didPreviewRectChange(beforeRect, movedRect)) {
      rotatePlacementPreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        pointerMode: options.canvas.state.runtime.singlePlacementPointerMode,
        currentMousePosition: null,
      });
    }

    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (afterRect !== null) {
      options.canvas.state.runtime.placementAnchor = resolveTouchDragAnchorAfterPreviewMove({
        beforeRect,
        afterRect,
        startGridPoint: placementAnchor,
        endGridPoint: nextGridPoint,
      });

      if (didPreviewRectChange(beforeRect, afterRect)) {
        options.canvas.actions.alignCanvasFloatingToolbar();
      }
    }

    return { status: "handled" };
  } catch {
    options.canvas.state.runtime.placementAnchor = null;
    return { status: "ignored" };
  }
}

export function driveMousePlacementPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  try {
    const beforeRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (beforeRect === null) {
      return { status: "ignored" };
    }

    options.editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      options.position, options.canvas.view.state,
    );
    const movedRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );
    if (movedRect !== null && !areGridRectsEqual(beforeRect, movedRect)) {
      rotatePlacementPreviewToBuildingSnap({
        canvas: options.canvas,
        editor: options.editor,
        trigger: "after-move",
        pointerMode: "mouse",
        currentMousePosition: options.position,
      });
    }
    const afterRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    const currentGridPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
    if (currentGridPoint !== null) {
      options.canvas.state.runtime.placementAnchor = currentGridPoint;
    }

    if (afterRect !== null && !areGridRectsEqual(beforeRect, afterRect)) {
      options.canvas.actions.alignCanvasFloatingToolbar();
    }

    return { status: "handled" };
  } catch {
    return { status: "ignored" };
  }
}

function applyPlacementOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  options: {
    keepPlacement?: boolean;
    currentMousePosition?: GesturePosition | null;
  } = {},
): void {
  const continuation = options.keepPlacement && canvas.isOperationEnabled("continuous-placement")
    ? capturePlacementContinuationSnapshot(canvas, editor)
    : null;

  try {
    const applied = editor.actions.applyPlacementDraft();
    if (!applied) {
      return;
    }

    if (continuation !== null && canvas.deferPlacementContinuation(
      () => (continuation.pointerMode === "mouse" || canvas.state.runtime.singlePlacementContinuous)
        && continuePlacementOperation(canvas, editor, continuation, options.currentMousePosition ?? null),
      () => { clearPlacementUi(canvas); canvas.actions.setActiveTool("select"); },
    )) return;

    if (continuation !== null && continuePlacementOperation(
      canvas,
      editor,
      continuation,
      options.currentMousePosition ?? null,
    )) {
      return;
    }
  } catch {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(canvas);
  canvas.actions.setActiveTool("select");
}

function cancelPlacementOperation(canvas: CanvasInteractionController, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    clearPlacementUi(canvas);
    canvas.actions.setActiveTool("select");
  }
}

export function rotatePlacementPreview(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  options: {
    pointerMode: "mouse" | "touch" | null;
    currentMousePosition: GesturePosition | null;
  } = {
    pointerMode: canvas.state.runtime.singlePlacementPointerMode,
    currentMousePosition: null,
  },
): void {
  if (rotatePlacementPreviewToBuildingSnap({
    canvas,
    editor,
    trigger: "before-rotate",
    pointerMode: options.pointerMode,
    currentMousePosition: options.currentMousePosition,
  })) {
    canvas.actions.alignCanvasFloatingToolbar();
    return;
  }

  if (options.pointerMode === "mouse") {
    editor.actions.rotateCollectionAroundCenterPoint(EntityCollectionType.preview, 90);
    if (
      options.currentMousePosition !== null
      && isClientPointInsideViewport(canvas.view, options.currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        options.currentMousePosition, canvas.view.state,
      );
    }
    canvas.actions.alignCanvasFloatingToolbar();
    return;
  }

  editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  canvas.actions.alignCanvasFloatingToolbar();
}

function rotatePlacementPreviewToBuildingSnap(options: {
  readonly canvas: CanvasInteractionController;
  readonly editor: EditorContract;
  readonly trigger: "after-move" | "before-rotate";
  readonly pointerMode: "mouse" | "touch" | null;
  readonly currentMousePosition: GesturePosition | null;
}): boolean {
  const isMouse = options.pointerMode === "mouse";
  const clientPixelPoint = isMouse
    && options.currentMousePosition !== null
    && isClientPointInsideViewport(options.canvas.view, options.currentMousePosition)
    ? options.currentMousePosition
    : null;

  return options.editor.actions.rotateCollectionToSnapOnBuilding({
    collectionType: EntityCollectionType.preview,
    trigger: options.trigger,
    pivotMode: isMouse ? "center" : "pivot-cell",
    clientPixelPoint, viewport: options.canvas.view.state,
  });
}

export function cleanupPlacementDraft(canvas: CanvasInteractionController): void {
  const editor = canvas.editor;
  if (editor !== null) {
    safelyCancelPlacementDraft(editor);
  }

  clearPlacementUi(canvas);
}

function clearPlacementUi(canvas: CanvasInteractionController): void {
  runInAction(() => {
    canvas.state.runtime.placementAnchor = null;
    canvas.state.runtime.singlePlacementDeviceId = null;
    canvas.state.runtime.singlePlacementPointerMode = null;
    canvas.state.runtime.singlePlacementContinuous = false;
  });
  canvas.actions.hideCanvasFloatingToolbar();
  canvas.actions.hideCanvasTopLeftCornerToolbar();
  canvas.actions.hideCanvasRightDockToolbar();
}

export function closeCompactLeftDockOnPlacementEnter(canvas: CanvasInteractionController): void {
  const deviceClass = canvas.workbench.state.screenProfile.deviceClass;
  if (deviceClass !== "mobile" && deviceClass !== "tablet") {
    return;
  }

  canvas.setPlacementPanelSuppressed(true);
}

function restoreFailedPlacementEnter(canvas: CanvasInteractionController, editor: EditorContract): void {
  canvas.pendingPlacementEnter = null;
  safelyCancelPlacementDraft(editor);
  clearPlacementUi(canvas);
  canvas.actions.setActiveTool("select");
}

function safelyCancelPlacementDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; placement should not leave UI half-entered.
  }
}

export function syncPlacementEntryUi(
  canvas: CanvasInteractionController,
  pointerMode = canvas.state.runtime.singlePlacementPointerMode,
  continuous = canvas.state.runtime.singlePlacementContinuous,
  options: {
    readonly floatingToolbarButtonIds?: readonly CanvasFloatingToolbarButtonId[];
    readonly rightDockToolbarItems?: readonly CanvasRightDockToolbarItemRequest[];
  } = {},
): boolean {
  if (pointerMode === null) {
    canvas.actions.hideCanvasRightDockToolbar();
    return true;
  }

  if (pointerMode !== "touch") {
    canvas.actions.hideCanvasFloatingToolbar();
    canvas.actions.hideCanvasTopLeftCornerToolbar();
    canvas.actions.showCanvasRightDockToolbar(
      options.rightDockToolbarItems ?? resolvePlacementRightDockToolbarItems(canvas),
    );
    return true;
  }

  canvas.actions.hideCanvasRightDockToolbar();
  canvas.actions.showCanvasTopLeftCornerToolbar(
    resolveSinglePlacementTopLeftToolbarButtonIds(canvas, continuous),
  );

  return canvas.actions.showCanvasFloatingToolbarForCollection(
    options.floatingToolbarButtonIds ?? resolvePlacementToolbarButtonIds(canvas),
    EntityCollectionType.preview,
  );
}

function resolvePlacementRightDockToolbarItems(
  canvas: CanvasInteractionController,
): readonly CanvasRightDockToolbarItemRequest[] {
  const deviceId = canvas.state.runtime.singlePlacementDeviceId;
  if (
    deviceId === null
    || !canSwitchEntityVariantDefinition({ canvas, definitionId: deviceId })
  ) {
    return PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS;
  }

  return PLACEMENT_RIGHT_DOCK_TOOLBAR_ITEMS_WITH_VARIANT;
}

function handleContinuousPlacementToggleTap(
  canvas: CanvasInteractionController,
  uiButtonId: string,
): GestureHandleResult | null {
  if (canvas.state.activeTool !== "single-placement") {
    return null;
  }

  switch (uiButtonId) {
    case TOGGLE_CONTINUOUS_PLACEMENT_ON:
      if (!canvas.isOperationEnabled("continuous-placement")) return { status: "ignored" };
      canvas.state.runtime.singlePlacementContinuous = true;
      return { status: "handled" };

    case TOGGLE_CONTINUOUS_PLACEMENT_OFF:
      canvas.state.runtime.singlePlacementContinuous = false;
      return { status: "handled" };

    default:
      return null;
  }
}

function resolveSinglePlacementTopLeftToolbarButtonIds(
  canvas: CanvasInteractionController,
  continuous = canvas.state.runtime.singlePlacementContinuous,
): readonly CanvasTopLeftCornerToolbarShowButtonId[] {
  return resolveContinuousPlacementTopLeftToolbarButtonIds(continuous);
}

function resolveContinuousPlacementTopLeftToolbarButtonIds(
  continuous: boolean,
): readonly CanvasTopLeftCornerToolbarShowButtonId[] {
  return continuous
    ? [TOGGLE_CONTINUOUS_PLACEMENT_OFF]
    : [CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID];
}

function resolvePlacementToolbarButtonIds(
  canvas: CanvasInteractionController,
): readonly CanvasFloatingToolbarButtonId[] {
  const deviceId = canvas.state.runtime.singlePlacementDeviceId;
  if (
    deviceId === null
    || !canSwitchEntityVariantDefinition({ canvas, definitionId: deviceId })
  ) {
    return PLACEMENT_TOOLBAR_BUTTON_IDS;
  }

  return [
    "canvas-floating-toolbar-button-cancel",
    SWITCH_DEVICE_MODE_BUTTON_ID,
    "canvas-floating-toolbar-button-rotate",
    "canvas-floating-toolbar-button-ok",
  ];
}

function switchPlacementPreviewVariant(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): GestureHandleResult {
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  if (previewEntityId === null) {
    return { status: "ignored" };
  }

  const previewEntity = editor.queries.getEntityById(previewEntityId);
  if (previewEntity === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    canvas,
    definitionId: previewEntity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  if (!editor.actions.replaceEntityDefinition(previewEntity.id, nextDefinitionId)) {
    return { status: "ignored" };
  }

  runInAction(() => {
    canvas.state.runtime.singlePlacementDeviceId = nextDefinitionId;
  });
  if (canvas.state.runtime.singlePlacementPointerMode === "mouse") {
    if (
      currentMousePosition !== null
      && isClientPointInsideViewport(canvas.view, currentMousePosition)
    ) {
      editor.actions.moveCollectionCenterPointTo(
        EntityCollectionType.preview,
        currentMousePosition, canvas.view.state,
      );
    }
    canvas.actions.alignCanvasFloatingToolbar();
  } else {
    recenterPlacementPreviewAtAnchor(canvas, editor);
  }
  syncPlacementEntryUi(canvas);
  return { status: "handled" };
}

function recenterPlacementPreviewAtAnchor(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): void {
  const placementAnchor = canvas.state.runtime.placementAnchor;
  if (placementAnchor === null) {
    return;
  }

  const previewRect = editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (previewRect === null) {
    return;
  }

  const nextTopLeft = {
    x: placementAnchor.x - Math.floor((previewRect.width - 1) / 2),
    y: placementAnchor.y - Math.floor((previewRect.height - 1) / 2),
  };
  if (previewRect.x !== nextTopLeft.x || previewRect.y !== nextTopLeft.y) {
    editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: {
        x: previewRect.x,
        y: previewRect.y,
      },
      endGridPoint: nextTopLeft,
    });
  }

  canvas.actions.alignCanvasFloatingToolbar();
}

function capturePlacementContinuationSnapshot(
  canvas: CanvasInteractionController,
  editor: EditorContract,
): {
  anchor: GridPoint;
  deviceId: string;
  pointerMode: "mouse" | "touch";
  position: GridPoint;
  rotation: GridRotation;
} | null {
  const deviceId = canvas.state.runtime.singlePlacementDeviceId;
  const anchor = canvas.state.runtime.placementAnchor;
  const pointerMode = canvas.state.runtime.singlePlacementPointerMode;
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  const previewEntity = previewEntityId === null
    ? null
    : editor.queries.getEntityById(previewEntityId);

  if (deviceId === null || anchor === null || pointerMode === null || previewEntity === null) {
    return null;
  }

  return {
    anchor: { ...anchor },
    deviceId,
    pointerMode,
    position: { ...previewEntity.position },
    rotation: resolveSinglePlacementPreviewRotation(editor),
  };
}

function continuePlacementOperation(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  continuation: {
    anchor: GridPoint;
    deviceId: string;
    pointerMode: "mouse" | "touch";
    position: GridPoint;
    rotation: GridRotation;
  },
  currentMousePosition: GesturePosition | null,
): boolean {
  const result = finalizePlacementEnter({
    canvas,
    editor,
    deviceId: continuation.deviceId,
    source: continuation.pointerMode,
    initialPlacementAnchor: continuation.anchor,
    initialMousePosition: null,
    shouldSetActiveTool: false,
  });

  if (result.status !== "handled") {
    return false;
  }

  restorePlacementPreviewRotation(canvas, editor, continuation.rotation);
  const previewEntityId = editor.state.collections.preview[0] ?? null;
  const previewEntity = previewEntityId === null
    ? null
    : editor.queries.getEntityById(previewEntityId);
  if (previewEntity === null) {
    return false;
  }

  // 连续放置复用刚提交的实际位置；鼠标移动后 placementAnchor 仍是首次创建 draft 的锚点。
  // AI-CORRECTION 2026-09-23: 鼠标移动现同步 placementAnchor；鼠标连续放置用绝对指针位置回正，原位置仅供触控或无画布指针时恢复。
  if (
    continuation.pointerMode === "mouse"
    && currentMousePosition !== null
    && isClientPointInsideViewport(canvas.view, currentMousePosition)
  ) {
    editor.actions.moveCollectionCenterPointTo(
      EntityCollectionType.preview,
      currentMousePosition, canvas.view.state,
    );
  } else {
    editor.actions.moveCollectionTo({
      collectionType: EntityCollectionType.preview,
      startGridPoint: previewEntity.position,
      endGridPoint: continuation.position,
    });
  }
  if (continuation.pointerMode === "touch") {
    canvas.actions.alignCanvasFloatingToolbar();
  }
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
  canvas: CanvasInteractionController,
  editor: EditorContract,
  rotation: GridRotation,
): void {
  const rotateCount = rotation / 90;
  for (let step = 0; step < rotateCount; step += 1) {
    editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
  }

  if (rotateCount > 0 && canvas.state.runtime.singlePlacementPointerMode === "touch") {
    canvas.actions.alignCanvasFloatingToolbar();
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

export function resolveViewportCenterGridPoint(view: EditorViewContract): GridPoint | null {
  const clientRect = view.state.clientRect;

  return view.queries.findGridCellForClientPixelPoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
}

function resolveGridPointFromGesturePosition(
  view: EditorViewContract,
  position: GesturePosition | null,
): GridPoint | null {
  if (position === null) {
    return null;
  }

  return view.queries.findGridCellForClientPixelPoint(position);
}

function isPreviewEntityAtClientPoint(
  editor: EditorContract, view: EditorViewContract,
  position: GesturePosition,
  hitSlopPx?: number,
): boolean {
  return isPreviewBoundingBoxAtClientPoint({
    editor,
    position,
    hitSlopPx, view: view,
  });
}

function isClientPointInsideViewport(
  view: EditorViewContract,
  position: GesturePosition,
): boolean {
  const clientRect = view.state.clientRect;

  return position.x >= clientRect.left
    && position.x <= clientRect.left + clientRect.width
    && position.y >= clientRect.top
    && position.y <= clientRect.top + clientRect.height;
}

// 2026-06-23: mouse 模式延迟创建 placement draft。
// 鼠标滑入 canvas 时才首次创建 draft，而非点击按钮时立即出现。
function ensurePlacementDraftForMouse(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  position: GesturePosition,
): boolean {
  const runtime = canvas.state.runtime;
  // 已有 draft 或 anchor 已设定，无需再创建
  if (runtime.placementAnchor !== null) return true;
  // 非 mouse 模式，不在此处理
  if (runtime.singlePlacementPointerMode !== "mouse") return true;
  // 无设备 id，不处理
  if (runtime.singlePlacementDeviceId === null) return false;

  // 鼠标不在 canvas 内，暂不创建
  if (!isClientPointInsideViewport(canvas.view, position)) return false;

  const gridPoint = canvas.view.queries.findGridCellForClientPixelPoint(position);
  if (gridPoint === null) return false;

  try {
    canvas.createPlacementDraft({ definitionId: runtime.singlePlacementDeviceId, centerGridPoint: gridPoint });
    const previewRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
    if (previewRect === null) {
      restoreFailedPlacementEnter(canvas, editor);
      return false;
    }
    runtime.placementAnchor = gridPoint;
    return true;
  } catch {
    restoreFailedPlacementEnter(canvas, editor);
    return false;
  }
}

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

// AI-REMOVED 2026-08-30:
// Reason: 旧辅助函数自行解释 modifier 和模式，形成与可执行 Shortcut Route 并列的第二套作用域真相。
// Trigger: ST2-RQ-020 要求运行时执行与设置冲突判定共用同一条 Action Route。
// Evidence: 全仓调用检索仅命中这些定义；实际键盘入口已迁移到本模块 shortcutRoutes。
// Replacement: createHypergryphSinglePlacementGestureModule().shortcutRoutes
// Risk: 若仓库外部曾直接导入两个 export helper，需要同步改为查询 GestureActionRouter。
// Human Review: Required
//
// Original code:
/*
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
  // AI-REMOVED 2026-08-02:
  // Reason: 放置模式快捷键不再拒绝修饰键组合
  // Trigger: Ctrl 连续放置时按 R 误触 Ctrl+R 旋转画布；用户要求放置/移动模式快捷键可与任意 modifier 组合
  // Evidence: 事件路由按注册顺序分发，本模块消费 key down 后 viewport-rotation 模块不再收到
  // Replacement: 移除 modifier 检查，isShortcutFor 未传 modifiers 时仅匹配主键
  // Risk: 放置模式下 Ctrl+R 不再旋转画布（预期）；浏览器级组合键可能同时触发系统行为（如 Ctrl+F 查找）
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
  // Reason: 放置模式快捷键不再拒绝修饰键组合
  // Trigger: Ctrl 连续放置时按快捷键无响应；用户要求放置/移动模式快捷键可与任意 modifier 组合
  // Evidence: 事件路由按注册顺序分发，本模块消费 key down 后后续模块不再收到
  // Replacement: 移除 modifier 检查，isShortcutFor 未传 modifiers 时仅匹配主键
  // Risk: 放置模式下 Ctrl+Tab 同时触发切换设备变体与浏览器标签行为（浏览器组合键无法被 JS 完全拦截）
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

export function resolvePlacementGroupByShortcut(options: {
  appHost: AppHost;
  code: string | null;
  key: string | null;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
  // 2026-08-02 新增：放置模式调用方传 true 以允许修饰键组合；select 模式默认仍拒绝。
  allowModifierKeys?: boolean;
}): PlacementGroup | null {
  // AI-CORRECTION 2026-08-02:
  // 原逻辑：带 alt/ctrl/meta 一律拒绝。
  // 新行为：allowModifierKeys=true（物流放置模式）时不再拒绝；select 模式默认仍拒绝。
  if (
    options.allowModifierKeys !== true
    && (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta)
  ) {
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
  // 2026-08-02 新增：放置模式调用方传 true 以允许修饰键组合；select 模式默认仍拒绝。
  allowModifierKeys?: boolean;
}): number | null {
  // AI-CORRECTION 2026-08-02:
  // 原逻辑：带 alt/ctrl/meta/shift 一律拒绝。
  // 新行为：allowModifierKeys=true（物流放置模式）时不再拒绝；select 模式默认仍拒绝。
  if (
    options.allowModifierKeys !== true
    && (
      options.modifiers.alt
      || options.modifiers.ctrl
      || options.modifiers.meta
      || options.modifiers.shift
    )
  ) {
    return null;
  }

  const key = options.key?.trim() ?? "";
  const shortcut = PLACEMENT_DEVICE_SHORTCUT_KEYS.find((candidate) => candidate === key)
    ?? resolveDeviceShortcutFromCode(options.code);

  if (shortcut === undefined) {
    return null;
  }

  const index = PLACEMENT_DEVICE_SHORTCUT_KEYS.indexOf(shortcut);
  return index >= 0 ? index : null;
}

function resolveDeviceShortcutFromCode(code: string | null): typeof PLACEMENT_DEVICE_SHORTCUT_KEYS[number] | undefined {
  const match = code?.match(/^(?:Digit|Numpad)([0-9])$/);
  const digit = match?.[1];
  if (digit === undefined) {
    return undefined;
  }

  return PLACEMENT_DEVICE_SHORTCUT_KEYS.find((shortcut) => shortcut === digit);
}
*/

export function resolveDeviceIdForPlacementGroupShortcut(options: {
  registry: RegistryContract;
  group: PlacementGroup;
  shortcutIndex: number;
  collapseDeviceModes?: boolean;
  selectedVariantNameByCraftGroup?: Readonly<Record<string, string>>;
  canUseDefinition?: (definition: EntityDefinition) => boolean;
}): string | null {
  const entities = options.registry.entityDefinitions
    .filter(
      (definition) =>
        definition.uiGroup === options.group
        && !definition.tags.includes("不可摆放"),
    )
    .filter((definition) => options.canUseDefinition?.(definition) ?? true)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));

  const visibleEntities = options.collapseDeviceModes
    ? collapseEntityVariantDefinitions({
        definitions: entities,
        selectedVariantNameByCraftGroup: options.selectedVariantNameByCraftGroup ?? {},
      })
    : entities;

  return visibleEntities[options.shortcutIndex]?.id ?? null;
}

// AI-REMOVED 2026-07-11:
// Reason: 触控拖动吸附设备时，footprint 可能只在某个轴跟随手指，另一个轴被吸附锁定；旧函数的全量匹配会阻止 anchor 局部更新并放大后续位移。
// Trigger: 用户反馈移动端净水节点吸附后，手指只移动一小截设备就飞出屏幕。
// Evidence: drivePlacementPreviewWithPerf / drivePlacementPreview 已改用 resolveTouchDragAnchorAfterPreviewMove 按轴更新 anchor。
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
