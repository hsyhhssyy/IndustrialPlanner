import type { AppHost } from "@/app/host/app-host";
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

const PINCH_ZOOM_STEPS_PER_DOUBLING = 4;
const MIN_WHEEL_ZOOM_STEP = 1;
const MAX_WHEEL_ZOOM_STEP = 2;

export function createHypergryphViewportZoomModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-viewport-zoom",
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
        case "wheel up":
        case "wheel down": {
          const step = resolveWheelZoomStep(event.normalizedDelta);

          if (step === null) {
            return { status: "ignored" };
          }

          editor.actions.zoom(step);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        case "pinch in":
        case "pinch out": {
          const step = resolvePinchZoomStep(event.scaleDelta);

          if (step === null) {
            return { status: "ignored" };
          }

          editor.actions.zoom(step);
          nudgeMobilePreviewIntoSafeViewport({
            appHost: context.appHost,
            editor,
          });
          context.appHost.internalActions.alignCanvasFloatingToolbar();
          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}

function resolveWheelZoomStep(normalizedDelta: number): number | null {
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    return null;
  }

  const magnitude = Math.min(
    MAX_WHEEL_ZOOM_STEP,
    Math.max(MIN_WHEEL_ZOOM_STEP, Math.abs(normalizedDelta)),
  );

  return normalizedDelta < 0 ? magnitude : -magnitude;
}

function resolvePinchZoomStep(scaleDelta: number): number | null {
  if (!Number.isFinite(scaleDelta) || scaleDelta <= 0 || scaleDelta === 1) {
    return null;
  }

  return PINCH_ZOOM_STEPS_PER_DOUBLING * Math.log2(scaleDelta);
}
