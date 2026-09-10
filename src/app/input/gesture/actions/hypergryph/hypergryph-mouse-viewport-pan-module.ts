import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GestureMappingModule } from "../types";
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
  nudgeMobilePreviewIntoSafeViewport,
} from "./mobile-preview-bounds";

export function createHypergryphMouseViewportPanModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-mouse-viewport-pan",
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
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart": {
          if (!isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragstart": {
          if (!canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )) {
            return { status: "ignored" };
          }

          moveViewport(editor, event.startPosition, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "mouse dragmove": {
          if (!isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "touch dragmove": {
          if (!canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )) {
            return { status: "ignored" };
          }

          moveViewport(editor, {
            x: event.position.x - event.delta.x,
            y: event.position.y - event.delta.y,
          }, event.position);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();

          return { status: "handled" };
        }

        case "mouse dragend":
          return isMousePanButtonAllowed(context.appHost.internalState.activeTool, event.originButton)
            ? { status: "handled" }
            : { status: "ignored" };

        case "touch dragend":
          return canPanTouchDrag(
            context.appHost.internalState.activeTool,
            event.longPress,
          )
            ? { status: "handled" }
            : { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function moveViewport(
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  startPosition: GesturePosition,
  endPosition: GesturePosition,
): void {
  editor.actions.moveViewportByClientPixelVector({
    startClientPixel: startPosition,
    endClientPixel: endPosition,
  });
}

function isMousePanButtonAllowed(activeTool: ActiveTool, originButton: number): boolean {
  if (originButton === 1) {
    return true;
  }

  return (
    activeTool === "select"
    || activeTool === "logistics-placement"
    || activeTool === "dark-pipe-link"
  ) && originButton === 0;
}

function canPanTouchDrag(activeTool: ActiveTool, longPress: boolean): boolean {
  return !longPress
    || activeTool === "single-placement"
    || activeTool === "blueprint-placement";
}
