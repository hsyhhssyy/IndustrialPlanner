import type { CanvasInteractionController } from "@/app/canvas";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { hasPlaceableEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import {
  EntityCollectionType,
  type MarqueeCollectionType,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { collectConnectedStrictLogisticsEntityIds } from "@/shared/transport-component";

import type { GestureHandleResult, GestureMappingModule } from "../types";
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
import { openOverlapEntityMenuIfNeeded } from "./overlap-entity-candidates";

const MARQUEE_RIGHT_DOCK_OPERATION_IDS = [
  "save-blueprint",
  "copy",
  "move",
  "delete",
  "toggle-marquee-selection",
  "marquee-select",
  "marquee-deselect",
  "exit-marquee",
] as const;

const EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS = [
  "toggle-marquee-selection",
  "marquee-select",
  "marquee-deselect",
  "exit-marquee",
] as const;

// AI-REMOVED 2026-08-22:
// Reason: 框选手势现在声明功能与本次 presentation，不再直接声明按钮 ID。
// Trigger: 用户要求呼起方只决定展示按钮、快捷键或两者。
// Evidence: showMarqueeRightDockToolbar 将 operationIds 映射为逐项请求。
// Replacement: MARQUEE_RIGHT_DOCK_OPERATION_IDS 与 EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS。
// Risk: Low
// Human Review: Required
//
// Original code:
// const MARQUEE_RIGHT_DOCK_BUTTON_IDS = [
//   "canvas-right-dock-toolbar-button-exit",
//   "canvas-right-dock-toolbar-button-move",
//   "canvas-right-dock-toolbar-button-copy",
//   "canvas-right-dock-toolbar-button-save-blueprint",
//   "canvas-right-dock-toolbar-button-delete",
// ] as const;
//
// const EMPTY_MARQUEE_RIGHT_DOCK_BUTTON_IDS = [
//   "canvas-right-dock-toolbar-button-exit",
// ] as const;

const MARQUEE_TOP_LEFT_BUTTON_IDS = [
  "canvas-top-left-corner-toolbar-button-toggle-pipe",
  "canvas-top-left-corner-toolbar-button-toggle-belt",
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
] as const;

const TOGGLE_REVERSE_MARQUEE_ON =
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on";
const TOGGLE_REVERSE_MARQUEE_OFF =
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-off";
const TOGGLE_PIPE_ON = "canvas-top-left-corner-toolbar-button-toggle-pipe-on";
const TOGGLE_PIPE_OFF = "canvas-top-left-corner-toolbar-button-toggle-pipe-off";
const TOGGLE_BELT_ON = "canvas-top-left-corner-toolbar-button-toggle-belt-on";
const TOGGLE_BELT_OFF = "canvas-top-left-corner-toolbar-button-toggle-belt-off";

export function createHypergryphMarqueeGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-marquee-gesture",
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
    shortcutRoutes: [{
      id: "marquee.toggle",
      operation: "marquee-select",
      actionId: SHORTCUT_KEY.MARQUEE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.MARQUEE },
      scope: { inputLayers: ["canvas"], activeTools: ALL_SHORTCUT_ACTIVE_TOOLS },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const editor = context.canvas.editor;
        if (context.canvas.state.activeTool === "marquee") {
          exitMarqueeToSelect(context.canvas);
          return { status: "handled" };
        }

        enterMarqueeMode({ canvas: context.canvas, editor, source: "mouse" });
        return { status: "handled" };
      },
    }],
    acceptsLongPress(context, gridHasEntity) {
      const tool = context.canvas.state.activeTool;
      if (tool === "marquee") {
        return true;
      }

      if (
        tool === "select"
        && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
        && !gridHasEntity
      ) {
        return true;
      }

      return false;
    },
    handle(event, context) {
      const editor = context.canvas.editor;

      switch (event.type) {
        case "on-enter-active-tool":
          if (event.to !== "marquee") {
            return { status: "ignored" };
          }

          closeCompactLeftDockOnMarqueeEnter(context.canvas);
          return { status: "handled" };

        case "on-exit-active-tool":
          if (event.from !== "marquee" || event.to === "marquee") {
            return { status: "ignored" };
          }

          cleanupMarquee(context.canvas, editor, event.to === "move"
            || (event.to === "blueprint-placement"
              && context.canvas.state.runtime.blueprintPlacementFromCopy));
          if (event.to !== "logistics-placement") {
            context.canvas.actions.hideCanvasTopLeftCornerToolbar();
          }
          if (event.to === "select") {
            context.canvas.setPlacementPanelSuppressed(false);
          }
          return { status: "handled" };

        // AI-REMOVED 2026-08-30:
        // Reason: X 由 marquee.toggle Route 执行；Escape 由更高优先级的固定取消 Route 执行。
        // Trigger: ST2-RQ-020 固定与可配置键盘 Action 统一。
        // Evidence: marquee.toggle 声明 canvas 全工具作用域；active-tool.cancel-to-select 声明取消工具域。
        // Replacement: marquee.toggle and active-tool.cancel-to-select Shortcut Routes
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        /*
        case "key down":
          if (event.code === "Escape" && context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (!context.appHost.internalActions.isShortcutFor(
            SHORTCUT_KEY.MARQUEE,
            event.code,
            event.key,
            event.modifiers,
          )) {
            return { status: "ignored" };
          }

          if (context.appHost.internalState.activeTool === "marquee") {
            exitMarqueeToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          enterMarqueeMode({
            appHost: context.appHost,
            editor,
            source: "mouse",
          });
          return { status: "handled" };
        */

        case "ui-button-touch-tap":
          return handleUiButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "touch",
          });

        case "ui-button-mouse-tap":
          if (event.button !== 0) {
            return { status: "ignored" };
          }

          return handleUiButtonTap({
            canvas: context.canvas,
            editor,
            uiButtonId: event.uiButtonId,
            source: "mouse",
          });

        case "mouse move":
          if (editor !== null) {
            editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          }
          return { status: "handled", consume: false };

        case "mouse tap":
          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (event.button === 2) {
            exitMarqueeToSelect(context.canvas);
            return { status: "handled" };
          }

          if (event.button === 0 && editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                canvas: context.canvas,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    canvas: context.canvas,
                    editor,
                    entity,
                  });
                  showMarqueeRightDockToolbar(context.canvas, editor);
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              canvas: context.canvas,
              editor,
              entity: event.pointerEntity,
            });
            showMarqueeRightDockToolbar(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "touch tap":
          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          if (editor !== null && event.pointerEntity !== null) {
            if (
              openOverlapEntityMenuIfNeeded({
                canvas: context.canvas,
                editor,
                position: event.position,
                pointerEntity: event.pointerEntity,
                onSelect: (entity) => {
                  toggleEntityOrStrictLogisticsSegmentInSelection({
                    canvas: context.canvas,
                    editor,
                    entity,
                  });
                  showMarqueeRightDockToolbar(context.canvas, editor);
                },
              })
            ) {
              return { status: "handled" };
            }

            toggleEntityOrStrictLogisticsSegmentInSelection({
              canvas: context.canvas,
              editor,
              entity: event.pointerEntity,
            });
            showMarqueeRightDockToolbar(context.canvas, editor);
            return { status: "handled" };
          }

          return { status: "ignored" };

        case "mouse dragstart":
          if (editor === null) {
            return { status: "ignored" };
          }

          if (
            context.canvas.state.activeTool === "select"
            && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
            && event.originButton !== 1
          ) {
            enterMarqueeMode({
              canvas: context.canvas,
              editor,
              source: "mouse",
            });
          }

          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          editor.actions.clearHoverPoint();
          return startMouseMarqueeDrag({
            canvas: context.canvas,
            editor,
            originButton: event.originButton,
            position: event.position,
          });

        case "touch dragstart":
          if (
            editor === null
            || !event.longPress
          ) {
            return { status: "ignored" };
          }

          if (
            context.canvas.state.activeTool === "select"
            && context.canvas.workbench.state.settings.hypergryphImmediateMarquee
            && event.pointerEntity === null
          ) {
            enterMarqueeMode({
              canvas: context.canvas,
              editor,
              source: "touch",
            });
          }

          if (context.canvas.state.activeTool !== "marquee") {
            return { status: "ignored" };
          }

          return startMarqueeDrag({
            canvas: context.canvas,
            editor,
            position: event.position,
            marqueeType: context.canvas.state.toolInfo.marqueeType,
          });

        case "mouse dragmove":
        case "touch dragmove":
          if (
            editor === null
            || context.canvas.state.activeTool !== "marquee"
            || context.canvas.state.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          return updateMarqueeRange({
            canvas: context.canvas,
            editor,
            position: event.position,
          });

        case "mouse dragend":
        case "touch dragend":
          if (
            editor === null
            || context.canvas.state.activeTool !== "marquee"
            || context.canvas.state.runtime.marqueeAnchor === null
          ) {
            return { status: "ignored" };
          }

          editor.actions.applyMarquee();
          context.canvas.state.runtime.marqueeAnchor = null;
          editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          showMarqueeRightDockToolbar(context.canvas, editor);
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function handleUiButtonTap(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  uiButtonId: string;
  source: "mouse" | "touch";
}): GestureHandleResult {
  switch (options.uiButtonId) {
    case "placement-tool-marquee":
      enterMarqueeMode({
        canvas: options.canvas,
        editor: options.editor,
        source: options.source,
      });
      return { status: "handled" };

    case "canvas-right-dock-toolbar-button-exit":
      if (options.canvas.state.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      exitMarqueeToSelect(options.canvas);
      return { status: "handled" };

    case TOGGLE_REVERSE_MARQUEE_ON:
      if (options.canvas.state.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      options.canvas.state.toolInfo.marqueeType = EntityCollectionType.reverseMarquee;
      return { status: "handled" };

    case TOGGLE_REVERSE_MARQUEE_OFF:
      if (options.canvas.state.activeTool !== "marquee") {
        return { status: "ignored" };
      }

      options.canvas.state.toolInfo.marqueeType = EntityCollectionType.marquee;
      return { status: "handled" };

    case TOGGLE_PIPE_ON:
      options.canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, true);
      return { status: "handled" };

    case TOGGLE_PIPE_OFF:
      options.canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
      return { status: "handled" };

    case TOGGLE_BELT_ON:
      options.canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, true);
      return { status: "handled" };

    case TOGGLE_BELT_OFF:
      options.canvas.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
      return { status: "handled" };

    default:
      return { status: "ignored" };
  }
}

export function enterMarqueeMode(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract | null;
  source: "mouse" | "touch";
}): void {
  const wasMarquee = options.canvas.state.activeTool === "marquee";
  options.canvas.actions.setActiveTool("marquee");
  // options.appHost.workspace.editor?.actions.clearCollection(EntityCollectionType.selection);
  if (!wasMarquee) {
    resetMarqueeLogisticsSuppression(options.editor);
  }

  if (options.source === "touch") {
    showMarqueeRightDockToolbar(options.canvas, options.editor, "button");
    if (options.canvas.workbench.internalState.workbench.rightDockOpen) {
      options.canvas.workbench.internalActions.toggleRightDock();
    }
  } else {
    showMarqueeRightDockToolbar(options.canvas, options.editor, "shortcut");
  }
  options.canvas.actions.showCanvasTopLeftCornerToolbar(
    resolveMarqueeTopLeftButtonIds(options.canvas),
  );
}

function resolveMarqueeTopLeftButtonIds(canvas: CanvasInteractionController) {
  return MARQUEE_TOP_LEFT_BUTTON_IDS.filter((buttonId) => {
    if (buttonId === "canvas-top-left-corner-toolbar-button-toggle-pipe") {
      return hasPlaceableEntityDefinitionInCurrentBase(canvas, "pipeLogistics");
    }
    return true;
  });
}

function closeCompactLeftDockOnMarqueeEnter(canvas: CanvasInteractionController): void {
  const deviceClass = canvas.workbench.state.screenProfile.deviceClass;
  if (deviceClass !== "mobile" && deviceClass !== "tablet") {
    return;
  }

  canvas.setPlacementPanelSuppressed(true);
}

function startMouseMarqueeDrag(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  originButton: number;
  position: GesturePosition;
}): GestureHandleResult {
  if (options.originButton === 1) {
    return { status: "ignored" };
  }

  if (options.originButton !== 0 && options.originButton !== 2) {
    return { status: "ignored" };
  }

  return startMarqueeDrag({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
    marqueeType: options.originButton === 2
      ? EntityCollectionType.reverseMarquee
      : EntityCollectionType.marquee,
  });
}

function startMarqueeDrag(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  marqueeType: MarqueeCollectionType;
}): GestureHandleResult {
  const anchor = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null) {
    return { status: "ignored" };
  }

  options.canvas.state.runtime.marqueeAnchor = anchor;
  options.canvas.state.toolInfo.marqueeType = options.marqueeType;
  options.editor.actions.setMarqueeRange(
    options.marqueeType,
    resolveGridRectFromPoints(anchor, anchor),
  );
  return { status: "handled" };
}

function updateMarqueeRange(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
}): GestureHandleResult {
  const anchor = options.canvas.state.runtime.marqueeAnchor;
  const currentPoint = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (anchor === null || currentPoint === null) {
    return { status: "ignored" };
  }

  options.editor.actions.setMarqueeRange(
    options.canvas.state.toolInfo.marqueeType,
    resolveGridRectFromPoints(anchor, currentPoint),
  );
  return { status: "handled" };
}

function exitMarqueeToSelect(canvas: CanvasInteractionController): void {
  // AI-REMOVED 2026-11-12:
  // Reason: 真实工具切换同步触发 on-exit，再次清理导致取消动作执行两次。
  // Trigger: REQ-048 统一 Canvas 输入生命周期；真实路由回归暴露重复取消。
  // Evidence: X 退出调用本函数，setActiveTool 发布 on-exit 后又调用 cleanupMarquee。
  // Replacement: 本模块 on-exit-active-tool 分支统一清理。
  // Risk: 直接调用模块的测试需要实际工具生命周期；产品入口均经注册路由。
  // Human Review: Required
  // Original code:
  // cleanupMarquee(canvas, editor);
  // canvas.actions.hideCanvasTopLeftCornerToolbar();
  canvas.actions.setActiveTool("select");
}

export function cleanupMarquee(canvas: CanvasInteractionController, editor: EditorContract | null, skipClearSelection = false): void {
  editor?.actions.cancelMarquee();
  if (!skipClearSelection) {
    editor?.actions.clearCollection(EntityCollectionType.selection);
  }
  resetMarqueeLogisticsSuppression(editor);
  canvas.state.runtime.marqueeAnchor = null;
  canvas.state.toolInfo.marqueeType = EntityCollectionType.marquee;
  canvas.actions.hideCanvasRightDockToolbar();
}

function resetMarqueeLogisticsSuppression(editor: EditorContract | null): void {
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
  editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
}

export function showMarqueeRightDockToolbar(
  canvas: CanvasInteractionController,
  editor: EditorContract | null,
  presentation = canvas.state.runtime.canvasRightDockToolbar.items.find(
    (item) => item.operationId === "exit-marquee",
  )?.presentation ?? "button",
): void {
  const operationIds = (editor?.state.collections.selection?.length ?? 0) > 0
    ? MARQUEE_RIGHT_DOCK_OPERATION_IDS
    : EMPTY_MARQUEE_RIGHT_DOCK_OPERATION_IDS;

  canvas.actions.showCanvasRightDockToolbar(
    operationIds.map((operationId) => ({ operationId, presentation })),
  );
}

// AI-REMOVED 2026-08-22:
// Reason: 框选工具列刷新不再复用工具列级 mode，也不再传递按钮 ID。
// Trigger: presentation 已成为逐项展示请求。
// Evidence: 新实现从退出功能请求继承 presentation，并为每个 operationId 构造请求。
// Replacement: 上方 showMarqueeRightDockToolbar 实现。
// Risk: Low
// Human Review: Required
//
// Original code:
// export function showMarqueeRightDockToolbar(
//   appHost: AppHost,
//   editor: EditorContract | null,
//   mode = appHost.internalState.runtime.canvasRightDockToolbar.mode,
// ): void {
//   const buttonIds = (editor?.state.collections.selection?.length ?? 0) > 0
//     ? MARQUEE_RIGHT_DOCK_BUTTON_IDS
//     : EMPTY_MARQUEE_RIGHT_DOCK_BUTTON_IDS;
//
//   appHost.internalActions.showCanvasRightDockToolbar(buttonIds, mode);
// }

function toggleEntityOrStrictLogisticsSegmentInSelection(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entity: WorldEntity;
}): void {
  const entityIds = resolveStrictLogisticsSegmentSelectionIds(options);
  const shouldRemove = options.editor.state.collections.selection.contains(options.entity.id);

  for (const entityId of entityIds) {
    if (shouldRemove) {
      removeEntityFromSelection(options.editor, entityId);
    } else {
      addEntityToSelection(options.editor, entityId);
    }
  }
}

function resolveStrictLogisticsSegmentSelectionIds(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  entity: WorldEntity;
}): readonly string[] {
  const registry = options.canvas.registry;
  if (!registry.queries.isDedicatedLogisticsDevice(options.entity.definitionId)) {
    return [options.entity.id];
  }

  const kind = registry.queries.resolveDedicatedLogisticsKind(options.entity.definitionId);
  if (kind === null) {
    return [options.entity.id];
  }

  const entityDefinitionMap = new Map(
    registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const segmentEntityIds = collectConnectedStrictLogisticsEntityIds({
    startEntityId: options.entity.id,
    startEntity: options.entity,
    kind,
    document: options.editor.document.getSnapshot(),
    entityDefinitionMap,
    isDedicatedLogisticsDevice: registry.queries.isDedicatedLogisticsDevice.bind(registry.queries),
    resolveDedicatedLogisticsKind: registry.queries.resolveDedicatedLogisticsKind.bind(registry.queries),
    directions: ["input", "output"],
  });

  return segmentEntityIds.size > 0 ? Array.from(segmentEntityIds) : [options.entity.id];
}

function addEntityToSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    return;
  }

  editor.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId,
  });
}

function removeEntityFromSelection(editor: EditorContract, entityId: string): void {
  if (editor.state.collections.selection.contains(entityId)) {
    editor.actions.removeFromCollection({
      collectionType: EntityCollectionType.selection,
      entityId,
    });
  }
}

function resolveGridRectFromPoints(start: GridPoint, end: GridPoint): GridRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x) + 1,
    height: Math.abs(end.y - start.y) + 1,
  };
}
