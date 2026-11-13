import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { createSelectionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import { canPlaceBlueprintDocumentInCurrentBase } from "@/app/placement-zone-availability";
import { allowsFreeProtocolCorePlacement } from "@/shared/protocol-core";
import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

import type { GestureActionContext, GestureHandleResult, GestureMappingModule } from "../types";
// AI-REMOVED 2026-09-27:
// Reason: 复制、剪切和粘贴选区统一只在框选工具生效，不再需要全工具作用域常量。
// Trigger: 用户要求 Ctrl+C、Ctrl+X、Ctrl+V 仅在批量选择模式生效。
// Evidence: 下方三个临时蓝图 Shortcut Route 的 activeTools 均为 marquee。
// Replacement: shortcutRoutes[temp-blueprint.copy/temp-blueprint.cut/temp-blueprint.paste] in this file
// Risk: Low
// Human Review: Required
//
// Original code:
// import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";
// AI-CORRECTION 2026-09-27: 用户确认 Ctrl+V 必须覆盖全部画布工具；上方删除记录已失效，恢复该导入。
import { ALL_SHORTCUT_ACTIVE_TOOLS } from "../shortcut-route-matching";
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
import { enterMarqueeMode } from "./hypergryph-marquee-gesture-module";
import { TOUCH_PREVIEW_HIT_SLOP_PX } from "./mobile-preview-bounds";
import {
  closeCompactLeftDockOnPlacementEnter,
  driveMousePlacementPreview,
  drivePlacementPreview,
  primePlacementAnchorFromPreview,
  PLACEMENT_TOOLBAR_BUTTON_IDS,
  resolveViewportCenterGridPoint,
  rotatePlacementPreview,
  syncPlacementEntryUi,
} from "./hypergryph-single-placement-gesture-module";

const BLUEPRINT_PREVIEW_PLACE_BUTTON_ID = "blueprint-preview-place-button";
const RIGHT_DOCK_COPY_BUTTON_ID = "canvas-right-dock-toolbar-button-copy";
const CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID =
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement";
const TOGGLE_CONTINUOUS_PLACEMENT_ON =
  `${CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID}-on`;
const TOGGLE_CONTINUOUS_PLACEMENT_OFF =
  `${CONTINUOUS_PLACEMENT_TOGGLE_BUTTON_ID}-off`;
const TEMP_BLUEPRINT_NAME = "Temp Blueprint";

const BLUEPRINT_RIGHT_DOCK_TOOLBAR_ITEMS = [
  { operationId: "pan-viewport", presentation: "shortcut" },
  { operationId: "zoom-viewport", presentation: "shortcut" },
  { operationId: "rotate-placement", presentation: "shortcut" },
  { operationId: "confirm-placement", presentation: "shortcut" },
  { operationId: "cancel-placement", presentation: "shortcut" },
] as const satisfies readonly CanvasRightDockToolbarItemRequest[];

const BLUEPRINT_PLACEMENT_UI_OPTIONS = {
  floatingToolbarButtonIds: PLACEMENT_TOOLBAR_BUTTON_IDS,
  rightDockToolbarItems: BLUEPRINT_RIGHT_DOCK_TOOLBAR_ITEMS,
} as const;

export function createHypergryphBlueprintPlacementGestureModule(): GestureMappingModule<AppHost> {
  let lastTempBlueprint: BlueprintLibraryRecord | null = null;
  let lastMousePosition: GesturePosition | null = null;

  return {
    id: "hypergryph-blueprint-placement-gesture",
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
      {
        id: "temp-blueprint.copy",
        operation: "copy",
        actionId: SHORTCUT_KEY.COPY_SELECTION,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.COPY_SELECTION },
        scope: { inputLayers: ["canvas"], activeTools: ["marquee"] },
        triggerPolicy: { kind: "exact" },
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          const result = copySelectionAsTempBlueprint({
            context,
            editor,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });
          if (result.status === "handled") {
            lastTempBlueprint = context.canvas.state.runtime.blueprintPlacementRecord;
          }
          return result;
        },
      },
      {
        id: "temp-blueprint.cut",
        operation: "cut",
        actionId: SHORTCUT_KEY.CUT_SELECTION,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.CUT_SELECTION },
        scope: { inputLayers: ["canvas"], activeTools: ["marquee"] },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };

          const selectionIds = [...editor.state.collections.selection];
          const currentDocument = editor.document.getSnapshot();
          if (
            selectionIds.length === 0
            || editor.actions.createBlueprintPlacementDraft === undefined
            || selectionIds.some((entityId) => {
              const entity = currentDocument.entities[entityId];
              return entity === undefined
                || (context.canvas.registry.queries.isProtocolCore(entity.definitionId)
                  && !allowsFreeProtocolCorePlacement(currentDocument.baseId, context.canvas.registry.baseDefinitions));
            })
          ) {
            return { status: "ignored" };
          }

          const record = createTempBlueprintRecord(context);
          const placementAnchor = resolveViewportCenterGridPoint(context.canvas.view);
          if (
            record === null
            || record.entityOrder.length !== selectionIds.length
            || selectionIds.some((entityId) => record.entities[entityId] === undefined)
            || !canPlaceBlueprintDocumentInCurrentBase(context.canvas, record)
            || placementAnchor === null
          ) {
            return { status: "ignored" };
          }

          editor.actions.deleteCollection(EntityCollectionType.selection);
          if (selectionIds.some((entityId) => editor.document.getSnapshot().entities[entityId] !== undefined)) {
            return { status: "ignored" };
          }

          lastTempBlueprint = record;
          return enterBlueprintPlacement({
            canvas: context.canvas,
            editor,
            record,
            source: "mouse",
            initialMousePosition: lastMousePosition,
            placementAnchor,
          });
        },
      },
      {
        id: "temp-blueprint.paste",
        operation: "paste",
        actionId: SHORTCUT_KEY.PASTE_SELECTION,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.PASTE_SELECTION },
        scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
        triggerPolicy: { kind: "exact" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null || lastTempBlueprint === null) return { status: "ignored" };
          return enterBlueprintPlacement({
            canvas: context.canvas,
            editor,
            record: lastTempBlueprint,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });
        },
      },
      {
        id: "current-operation.rotate-blueprint",
        operation: "rotate-placement",
        actionId: SHORTCUT_KEY.ROTATE,
        binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.ROTATE },
        scope: { inputLayers: ["canvas"], activeTools: ["blueprint-placement"] },
        triggerPolicy: { kind: "allow-any-additional-modifiers" },
        claimsBrowserDefault: true,
        handle(_event, context) {
          const editor = context.canvas.editor;
          if (editor === null) return { status: "ignored" };
          rotateBlueprintPlacementPreview(context.canvas, editor, lastMousePosition);
          return { status: "handled" };
        },
      },
    ],
    handle(event, context) {
      if (
        event.type === "mouse move"
        || event.type === "mouse dragstart"
        || event.type === "mouse dragmove"
      ) {
        lastMousePosition = event.position;
      }

      // AI-REMOVED 2026-08-30:
      // Reason: 临时蓝图复制/粘贴快捷键已拆为带正式作用域的可执行 Route。
      // Trigger: ST2-RQ-020 输入层和 Action Route 统一。
      // Evidence: temp-blueprint.copy 仅覆盖 marquee；temp-blueprint.paste 覆盖画布全工具。
      // AI-CORRECTION 2026-09-27: 用户明确 Ctrl+V 保持画布全工具生效；新增的 temp-blueprint.cut 仅覆盖 marquee。
      // Replacement: shortcutRoutes[temp-blueprint.copy/temp-blueprint.paste] in this module
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      /*
      if (event.type === "key down") {
        const shortcut = resolveTempBlueprintShortcut({
          appHost: context.appHost,
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        });

        if (shortcut !== null) {
          if (isEditableKeyboardTarget(event.sourceEvent)) {
            return { status: "ignored" };
          }

          const editor = context.workspace.editor;
          if (editor === null) {
            return { status: "ignored" };
          }

          if (shortcut === "copy") {
            const result = copySelectionAsTempBlueprint({
              context,
              editor,
              source: "mouse",
              initialMousePosition: lastMousePosition,
            });
            if (result.status === "handled") {
              lastTempBlueprint = context.appHost.internalState.runtime.blueprintPlacementRecord;
            }
            return result;
          }

          if (lastTempBlueprint === null) {
            return { status: "ignored" };
          }

          return enterBlueprintPlacement({
            appHost: context.appHost,
            editor,
            record: lastTempBlueprint,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });
        }
      }
      */

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "blueprint-placement" || event.to === "blueprint-placement") {
          return { status: "ignored" };
        }

        if (context.canvas.state.runtime.blueprintPlacementFromCopy && event.to !== "marquee") {
          context.canvas.editor?.actions.clearCollection(EntityCollectionType.selection);
        }
        cleanupBlueprintPlacement(context.canvas, context.canvas.editor);
        if (event.to === "select") {
          context.canvas.setPlacementPanelSuppressed(false);
        }
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "blueprint-placement") {
          return { status: "ignored" };
        }

        closeCompactLeftDockOnPlacementEnter(context.canvas);
        syncPlacementEntryUi(
          context.canvas,
          context.canvas.state.runtime.blueprintPlacementPointerMode,
          context.canvas.state.runtime.blueprintPlacementContinuous,
          BLUEPRINT_PLACEMENT_UI_OPTIONS,
        );
        return { status: "handled" };
      }

      const editor = context.canvas.editor;

      if (
        event.type === "ui-button-touch-tap"
        && event.uiButtonId === RIGHT_DOCK_COPY_BUTTON_ID
      ) {
        if (editor === null) {
          return { status: "ignored" };
        }

        const result = copySelectionAsTempBlueprint({
          context,
          editor,
          source: "touch",
          initialMousePosition: null,
        });
        if (result.status === "handled") {
          lastTempBlueprint = context.canvas.state.runtime.blueprintPlacementRecord;
        }
        return result;
      }

      if (
        event.type === "ui-button-mouse-tap"
        && event.button === 0
        && event.uiButtonId === RIGHT_DOCK_COPY_BUTTON_ID
      ) {
        if (editor === null) {
          return { status: "ignored" };
        }

        const result = copySelectionAsTempBlueprint({
          context,
          editor,
          source: "mouse",
          initialMousePosition: lastMousePosition,
        });
        if (result.status === "handled") {
          lastTempBlueprint = context.canvas.state.runtime.blueprintPlacementRecord;
        }
        return result;
      }

      if (
        event.type === "ui-button-touch-tap"
        && event.uiButtonId === BLUEPRINT_PREVIEW_PLACE_BUTTON_ID
      ) {
        return editor === null
          ? { status: "ignored" }
          : enterBlueprintPlacement({
            canvas: context.canvas,
            editor,
            source: "touch",
            initialMousePosition: null,
          });
      }

      if (
        event.type === "ui-button-mouse-tap"
        && event.button === 0
        && event.uiButtonId === BLUEPRINT_PREVIEW_PLACE_BUTTON_ID
      ) {
        return editor === null
          ? { status: "ignored" }
          : enterBlueprintPlacement({
            canvas: context.canvas,
            editor,
            source: "mouse",
            initialMousePosition: lastMousePosition,
          });
      }

      if (editor === null || context.canvas.state.activeTool !== "blueprint-placement") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse-long-press-ready":
        case "tap-long-press-ready":
          return { status: "handled" };

        // AI-REMOVED 2026-08-30:
        // Reason: 蓝图放置旋转已由 current-operation.rotate-blueprint Route 接管。
        // Trigger: ST2-RQ-020 修复操作 Action 自定义 modifier 后无法触发。
        // Evidence: Route 使用 allow-any-additional-modifiers，但仍要求用户绑定自身 modifier。
        // Replacement: shortcutRoutes[current-operation.rotate-blueprint] in this module
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        /*
        case "key down":
          if (!isRotatePlacementShortcut({
            appHost: context.appHost,
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          })) {
            return { status: "ignored" };
          }

          rotateBlueprintPlacementPreview(context.appHost, editor, lastMousePosition);
          return { status: "handled" };
        */

        case "mouse dragstart":
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
          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragmove":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }

          return driveMousePlacementPreview({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "touch dragmove":
          return drivePlacementPreview({
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
            cancelBlueprintPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          if (event.button === 0 && !event.longPress) {
            applyBlueprintPlacement(context.canvas, editor, lastMousePosition, {
              continuous: context.canvas.state.runtime.blueprintPlacementContinuous
                || event.modifiers.shift || event.modifiers.ctrl,
            });
            return { status: "handled" };
          }

          return { status: "handled" };

        case "ui-button-touch-tap":
          if (event.uiButtonId === TOGGLE_CONTINUOUS_PLACEMENT_ON) {
            context.canvas.state.runtime.blueprintPlacementContinuous = true;
            return { status: "handled" };
          }

          if (event.uiButtonId === TOGGLE_CONTINUOUS_PLACEMENT_OFF) {
            context.canvas.state.runtime.blueprintPlacementContinuous = false;
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyBlueprintPlacement(context.canvas, editor, null, {
              continuous:
                context.canvas.state.runtime.blueprintPlacementContinuous,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.canvas, editor, null);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelBlueprintPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.uiButtonId === TOGGLE_CONTINUOUS_PLACEMENT_ON) {
            context.canvas.state.runtime.blueprintPlacementContinuous = true;
            return { status: "handled" };
          }

          if (event.uiButtonId === TOGGLE_CONTINUOUS_PLACEMENT_OFF) {
            context.canvas.state.runtime.blueprintPlacementContinuous = false;
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyBlueprintPlacement(context.canvas, editor, lastMousePosition, {
              continuous:
                context.canvas.state.runtime.blueprintPlacementContinuous,
            });
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-rotate") {
            rotateBlueprintPlacementPreview(context.canvas, editor, lastMousePosition);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelBlueprintPlacement(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

export function enterBlueprintPlacement(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  record?: BlueprintLibraryRecord;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
  placementAnchor?: GridPoint;
  fromCopy?: boolean;
}): GestureHandleResult {
  const record = options.record ?? options.canvas.workbench.blueprintPreview.record;

  if (record === null || options.editor.actions.createBlueprintPlacementDraft === undefined) {
    return { status: "ignored" };
  }

  if (!canPlaceBlueprintDocumentInCurrentBase(options.canvas, record)) {
    return { status: "ignored" };
  }

  const previousTool = options.canvas.state.activeTool;
  const reenteringBlueprintPlacement = previousTool === "blueprint-placement";

  if (!options.fromCopy && !reenteringBlueprintPlacement && previousTool !== "select") {
    options.canvas.actions.setActiveTool("select");
  }

  if (reenteringBlueprintPlacement) {
    if (options.canvas.state.runtime.blueprintPlacementFromCopy) {
      options.editor.actions.clearCollection(EntityCollectionType.selection);
    }
    safelyCancelPlacementDraft(options.editor);
    clearBlueprintPlacementUi(options.canvas);
  }

  const placementAnchor = options.placementAnchor
    ?? resolveViewportCenterGridPoint(options.canvas.view);

  if (placementAnchor === null) {
    return { status: "ignored" };
  }

  try {
    options.canvas.state.runtime.placementAnchor = placementAnchor;
    options.canvas.state.runtime.blueprintPlacementRecord = record;
    options.canvas.state.runtime.blueprintPlacementPointerMode = options.source;
    options.canvas.state.runtime.blueprintPlacementRotationSteps = 0;
    options.canvas.state.runtime.blueprintPlacementContinuous =
      options.canvas.workbench.state.settings.blueprintPlacementDefaultContinuous;
    options.canvas.state.runtime.blueprintPlacementFromCopy = options.fromCopy === true;
    options.editor.actions.createBlueprintPlacementDraft(record, placementAnchor);

    const previewRect = options.editor.queries.findEntityCollectionGridRect(
      EntityCollectionType.preview,
    );

    if (previewRect === null) {
      restoreFailedBlueprintPlacementEnter(options.canvas, options.editor);
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
    }

    options.canvas.workbench.blueprintPreview.close();

    if (reenteringBlueprintPlacement) {
      if (!syncPlacementEntryUi(
        options.canvas,
        options.source,
        options.canvas.state.runtime.blueprintPlacementContinuous,
        BLUEPRINT_PLACEMENT_UI_OPTIONS,
      )) {
        restoreFailedBlueprintPlacementEnter(options.canvas, options.editor);
        return { status: "ignored" };
      }

      return { status: "handled" };
    }

    options.canvas.actions.setActiveTool("blueprint-placement");
    return { status: "handled" };
  } catch {
    restoreFailedBlueprintPlacementEnter(options.canvas, options.editor);
    return { status: "ignored" };
  }
}

export function placeBlueprintFromMoveAndContinue(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  record: BlueprintLibraryRecord;
  source: "mouse" | "touch";
  placementAnchor: GridPoint;
  currentMousePosition: GesturePosition | null;
}): GestureHandleResult {
  const enterResult = enterBlueprintPlacement({
    canvas: options.canvas,
    editor: options.editor,
    record: options.record,
    source: options.source,
    initialMousePosition: null,
    placementAnchor: options.placementAnchor,
  });
  if (enterResult.status !== "handled") {
    return enterResult;
  }

  applyBlueprintPlacement(
    options.canvas,
    options.editor,
    options.currentMousePosition,
    { continuous: true },
  );
  return { status: "handled" };
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

function applyBlueprintPlacement(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
  options: { continuous: boolean },
): void {
  const record = canvas.state.runtime.blueprintPlacementRecord;
  const placementAnchor = canvas.state.runtime.placementAnchor;
  const pointerMode = canvas.state.runtime.blueprintPlacementPointerMode;
  const rotationSteps = normalizeRotationSteps(
    canvas.state.runtime.blueprintPlacementRotationSteps,
  );

  if (
    record === null
    || placementAnchor === null
    || pointerMode === null
    || editor.actions.createBlueprintPlacementDraft === undefined
  ) {
    cancelBlueprintPlacement(canvas, editor);
    return;
  }

  try {
    const applied = editor.actions.applyPlacementDraft();
    if (!applied) {
      return;
    }

    if (options.continuous) {
      canvas.state.runtime.placementAnchor = placementAnchor;
      editor.actions.createBlueprintPlacementDraft(record, placementAnchor);

      for (let index = 0; index < rotationSteps; index += 1) {
        editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
      }

      if (
        pointerMode === "mouse"
        && currentMousePosition !== null
        && isClientPointInsideViewport(canvas.view, currentMousePosition)
      ) {
        editor.actions.moveCollectionCenterPointTo(
          EntityCollectionType.preview,
          currentMousePosition, canvas.view.state,
        );
      }

      const previewRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);

      if (
        previewRect === null
        || !syncPlacementEntryUi(
          canvas,
          pointerMode,
          canvas.state.runtime.blueprintPlacementContinuous,
          BLUEPRINT_PLACEMENT_UI_OPTIONS,
        )
      ) {
        throw new Error("failed to re-arm blueprint placement preview");
      }

      return;
    }
  } catch {
    safelyCancelPlacementDraft(editor);
  }

  // 非连续放置 或 异常 → 回到 select
  // AI-CORRECTION 2026-09-27: 复制会话结束直接返回多选并保留原选区；其他入口返回 select。
  // AI-REMOVED 2026-09-27:
  // Reason: 蓝图结束行为统一到共享出口，复制需要直接返回多选。
  // Trigger: 用户要求复制结束保留最初选区。
  // Evidence: 原出口固定切换 select，丢失复制会话返回语义。
  // Replacement: finishBlueprintPlacement in this file
  // Risk: Low；其他蓝图入口仍返回 select。
  // Human Review: Required
  // Original code:
  // clearBlueprintPlacementUi(appHost);
  // appHost.internalActions.setActiveTool("select");
  // appHost.internalActions.setActivePanel("placement");
  finishBlueprintPlacement(canvas, editor);
}

export function cancelBlueprintPlacement(canvas: CanvasInteractionController, editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } finally {
    // AI-REMOVED 2026-09-27:
    // Reason: 蓝图结束行为统一到共享出口，复制需要直接返回多选。
    // Trigger: 用户要求复制结束保留最初选区。
    // Evidence: 原出口固定切换 select，丢失复制会话返回语义。
    // Replacement: finishBlueprintPlacement in this file
    // Risk: Low；其他蓝图入口仍返回 select。
    // Human Review: Required
    // Original code:
    // clearBlueprintPlacementUi(appHost);
    // appHost.internalActions.setActiveTool("select");
    // appHost.internalActions.setActivePanel("placement");
    finishBlueprintPlacement(canvas, editor);
  }
}

function rotateBlueprintPlacementPreview(
  canvas: CanvasInteractionController,
  editor: EditorContract,
  currentMousePosition: GesturePosition | null,
): void {
  rotatePlacementPreview(canvas, editor, {
    pointerMode: canvas.state.runtime.blueprintPlacementPointerMode,
    currentMousePosition,
  });
  canvas.state.runtime.blueprintPlacementRotationSteps = normalizeRotationSteps(
    canvas.state.runtime.blueprintPlacementRotationSteps + 1,
  );
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

function cleanupBlueprintPlacement(canvas: CanvasInteractionController, editor: EditorContract | null): void {
  if (editor !== null) {
    safelyCancelPlacementDraft(editor);
  }

  clearBlueprintPlacementUi(canvas);
}

function clearBlueprintPlacementUi(canvas: CanvasInteractionController): void {
  canvas.state.runtime.placementAnchor = null;
  canvas.state.runtime.blueprintPlacementRecord = null;
  canvas.state.runtime.blueprintPlacementPointerMode = null;
  canvas.state.runtime.blueprintPlacementRotationSteps = 0;
  canvas.state.runtime.blueprintPlacementContinuous = false;
  canvas.state.runtime.blueprintPlacementFromCopy = false;
  canvas.actions.hideCanvasFloatingToolbar();
  canvas.actions.hideCanvasTopLeftCornerToolbar();
  canvas.actions.hideCanvasRightDockToolbar();
}

function restoreFailedBlueprintPlacementEnter(canvas: CanvasInteractionController, editor: EditorContract): void {
  safelyCancelPlacementDraft(editor);
  // AI-REMOVED 2026-09-27:
  // Reason: 蓝图结束行为统一到共享出口，复制需要直接返回多选。
  // Trigger: 用户要求复制结束保留最初选区。
  // Evidence: 原出口固定切换 select，丢失复制会话返回语义。
  // Replacement: finishBlueprintPlacement in this file
  // Risk: Low；其他蓝图入口仍返回 select。
  // Human Review: Required
  // Original code:
  // clearBlueprintPlacementUi(appHost);
  // appHost.internalActions.setActiveTool("select");
  // appHost.internalActions.setActivePanel("placement");
  finishBlueprintPlacement(canvas, editor);
}

function finishBlueprintPlacement(canvas: CanvasInteractionController, editor: EditorContract): void {
  const fromCopy = canvas.state.runtime.blueprintPlacementFromCopy
    && canvas.state.runtime.blueprintPlacementRecord?.baseId === editor.document.getSnapshot().baseId;
  const source = canvas.state.runtime.blueprintPlacementPointerMode ?? "mouse";
  clearBlueprintPlacementUi(canvas);
  if (fromCopy) {
    enterMarqueeMode({ canvas, editor, source });
  } else {
    canvas.actions.setActiveTool("select");
  }
  canvas.workbench.internalActions.setActivePanel("placement");
}

function safelyCancelPlacementDraft(editor: EditorContract): void {
  try {
    editor.actions.cancelPlacementDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; placement should not leave UI half-entered.
  }
}

function normalizeRotationSteps(rotationSteps: number): number {
  return ((Math.trunc(rotationSteps) % 4) + 4) % 4;
}

// AI-REMOVED 2026-08-30:
// Reason: 蓝图旋转的按键匹配由 current-operation.rotate-blueprint Route 负责。
// Trigger: ST2-RQ-020 修复自定义 modifier 绑定无法触发。
// Evidence: Route 的 allow-any-additional-modifiers 策略同时表达必需绑定 modifier 和额外 modifier。
// Replacement: shortcutRoutes[current-operation.rotate-blueprint] in this module
// Risk: Low
// Human Review: Required
//
// Original code:
// function isRotatePlacementShortcut(options: {
//   appHost: AppHost;
//   code: string | null;
//   key: string | null;
//   modifiers: {
//     alt: boolean;
//     ctrl: boolean;
//     meta: boolean;
//   };
// }): boolean {
//   return options.appHost.internalActions.isShortcutFor(
//     SHORTCUT_KEY.ROTATE,
//     options.code,
//     options.key,
//   );
// }

function createTempBlueprintRecord(
  context: GestureActionContext<AppHost>,
): BlueprintLibraryRecord | null {
  const blueprintDocument = createSelectionBlueprintDocument({
    workspace: context.canvas.workbench.workspace,
    name: TEMP_BLUEPRINT_NAME,
  });

  if (blueprintDocument === null) {
    return null;
  }

  return {
    ...blueprintDocument,
    parentFolderId: null,
  };
}

function copySelectionAsTempBlueprint(options: {
  context: GestureActionContext<AppHost>;
  editor: EditorContract;
  source: "mouse" | "touch";
  initialMousePosition: GesturePosition | null;
}): GestureHandleResult {
  if (options.context.canvas.state.activeTool !== "marquee") {
    return { status: "ignored" };
  }

  const record = createTempBlueprintRecord(options.context);
  if (record === null) {
    return { status: "ignored" };
  }

  return enterBlueprintPlacement({
    canvas: options.context.canvas,
    editor: options.editor,
    record,
    source: options.source,
    initialMousePosition: options.initialMousePosition,
    fromCopy: true,
  });
}

// AI-REMOVED 2026-08-30:
// Reason: 复制和粘贴已是两条独立可执行 Route，不再需要先反查快捷键种类。
// Trigger: ST2-RQ-020 Action Route 统一。
// Evidence: temp-blueprint.copy/temp-blueprint.paste 直接持有对应 Action ID 与 handler。
// Replacement: shortcutRoutes in createHypergryphBlueprintPlacementGestureModule
// Risk: Low
// Human Review: Required
//
// Original code:
// type TempBlueprintShortcut = "copy" | "paste";
// function resolveTempBlueprintShortcut(options: {
//   appHost: AppHost;
//   code: string | null;
//   key: string | null;
//   modifiers: {
//     alt: boolean;
//     ctrl: boolean;
//     meta: boolean;
//     shift: boolean;
//   };
// }): TempBlueprintShortcut | null {
//   if (options.appHost.internalActions.isShortcutFor(
//     SHORTCUT_KEY.COPY_SELECTION,
//     options.code,
//     options.key,
//     options.modifiers,
//   )) {
//     return "copy";
//   }
//   if (options.appHost.internalActions.isShortcutFor(
//     SHORTCUT_KEY.PASTE_SELECTION,
//     options.code,
//     options.key,
//     options.modifiers,
//   )) {
//     return "paste";
//   }
//   return null;
// }

// AI-REMOVED 2026-08-03:
// Reason: 临时蓝图复制/粘贴已统一通过 KeyboardShortcutManager 匹配，不再需要本地硬编码键名比较。
// Trigger: ST2-RQ-002 要求 COPY_SELECTION / PASTE_SELECTION 修改后立即影响蓝图放置模式。
// Evidence: resolveTempBlueprintShortcut 已调用 appHost.internalActions.isShortcutFor。
// Replacement: resolveTempBlueprintShortcut in this file。
// Risk: Low
// Human Review: Required
//
// Original code:
// function matchesKeyboardKey(
//   options: {
//     code: string | null;
//     key: string | null;
//   },
//   code: string,
//   key: string,
// ): boolean {
//   return options.code === code || options.key?.toLowerCase() === key;
// }

// AI-REMOVED 2026-08-30:
// Reason: 可编辑目标由统一 DOM 输入层在事件进入 GestureAdapter 前阻断，业务模块不再重复判断 DOM。
// Trigger: ST2-RQ-020 输入层统一。
// Evidence: Workbench 键盘入口的 isEditableKeyboardTarget 与 Route inputLayers 共同限定可达性。
// Replacement: workbench-app.tsx isEditableKeyboardTarget and Shortcut Route scope
// Risk: Low
// Human Review: Required
//
// Original code:
// function isEditableKeyboardTarget(sourceEvent: unknown): boolean {
//   const target = (sourceEvent as { target?: unknown } | null)?.target;
//   if (!isElementLikeTarget(target)) return false;
//   const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
//   if (tagName === "input" || tagName === "textarea") return true;
//   if (target.isContentEditable === true) return true;
//   if (typeof target.closest === "function") {
//     return target.closest(
//       "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
//     ) !== null;
//   }
//   return false;
// }
// function isElementLikeTarget(target: unknown): target is {
//   readonly tagName?: string;
//   readonly isContentEditable?: boolean;
//   readonly closest?: (selector: string) => unknown;
// } {
//   return typeof target === "object" && target !== null;
// }
