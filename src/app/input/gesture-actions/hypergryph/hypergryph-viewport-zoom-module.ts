import type { AppHost } from "@/app/app-host";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

const PINCH_ZOOM_STEPS_PER_DOUBLING = 4;
const MIN_WHEEL_ZOOM_STEP = 1;
const MAX_WHEEL_ZOOM_STEP = 2;

export function createHypergryphViewportZoomModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-viewport-zoom",
    when: isHypergryphGestureEnabled,
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
          context.appHost.internalActions.alignCanvasToolbar();
          return { status: "handled" };
        }

        case "pinch in":
        case "pinch out": {
          const step = resolvePinchZoomStep(event.scaleDelta);

          if (step === null) {
            return { status: "ignored" };
          }

          editor.actions.zoom(step);
          context.appHost.internalActions.alignCanvasToolbar();
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
