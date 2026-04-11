import type {
  CanvasGestureEvent,
  CanvasPointerDownRoute,
  CanvasTouchDownRoute,
} from "./canvas-panel-gesture-session";
import { resolveCanvasPanelTapIntent } from "./canvas-panel-tap-intent";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type {
  CurrentInteractionMode,
  DisplayTool,
} from "@/editor/contracts/interaction-mode";
import {
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import { createLogger } from "@/shared/logging/logger";
import type {
  CanvasInteractionTarget,
  WorkbenchController,
} from "@/workbench/contracts/workbench-facade";
import type { RenderDerivedScreenBox } from "@/workbench/workspace-derived-state";
import type { WorkbenchPhase } from "@/workbench/workbench-ui-state";
import type { CanvasPoint } from "@/workbench/workspace-state";

const logger = createLogger("app.canvas-panel");

export interface ResolveCanvasPointerDownRouteOptions {
  button: number;
  currentMode: CurrentInteractionMode;
  phase: WorkbenchPhase;
  selectionModifierActive: boolean;
  screenPoint: CanvasPoint;
  selection: readonly string[];
  target: CanvasInteractionTarget;
}

export interface ResolveCanvasTouchDownRouteOptions {
  anchoredMoveScreenBox: RenderDerivedScreenBox | null;
  anchoredPlacementActive: boolean;
  anchoredPlacementScreenBox: RenderDerivedScreenBox | null;
  currentMode: CurrentInteractionMode;
  phase: WorkbenchPhase;
  screenPoint: CanvasPoint;
  selection: readonly string[];
  target: CanvasInteractionTarget;
}

export interface RouteCanvasGestureEventOptions {
  anchoredPlacementActive: boolean;
  cancelMarquee: () => void;
  cancelMove: () => void;
  cancelPlacement: () => void;
  cancelScheduledPlacementPreview: () => void;
  controller: WorkbenchController;
  currentMode: CurrentInteractionMode;
  displayTool: DisplayTool;
  event: CanvasGestureEvent;
  phase: WorkbenchPhase;
  schedulePlacementPreviewFromScreenPoint: (screenPoint: CanvasPoint) => void;
}

function resolveInteractionModeFromGestureSource(
  source: CanvasGestureEvent["source"],
): PlacementInteractionMode {
  return source === "touch" ? "touch" : "pointer";
}

export function isPointInsideScreenBox(
  point: CanvasPoint,
  screenBox: RenderDerivedScreenBox | null,
): boolean {
  if (!screenBox) {
    return false;
  }

  return (
    point.x >= screenBox.left &&
    point.x <= screenBox.left + screenBox.width &&
    point.y >= screenBox.top &&
    point.y <= screenBox.top + screenBox.height
  );
}

export function resolveSelectedEntityMoveCandidate(options: {
  currentMode: CurrentInteractionMode;
  phase: WorkbenchPhase;
  selectionModifierActive?: boolean;
  selection: readonly string[];
  target: CanvasInteractionTarget;
}): string | null {
  if (
    options.phase !== "edit" ||
    options.currentMode.key !== "select" ||
    options.selection.length === 0
  ) {
    return null;
  }

  return options.target.kind === "entity" && options.target.selected
    ? options.target.entityId
    : null;
}

export function resolveCanvasPointerDownRoute(
  options: ResolveCanvasPointerDownRouteOptions,
): CanvasPointerDownRoute {
  if (options.button === 0) {
    const moveEntityId = resolveSelectedEntityMoveCandidate(options);

    return {
      kind: "primary",
      moveEntityId,
      marqueeSelectionMode: resolvePointerMarqueeSelectionMode({
        currentMode: options.currentMode,
        moveEntityId,
        phase: options.phase,
        selectionModifierActive: options.selectionModifierActive,
      }),
    };
  }

  if (options.button === 2) {
    return {
      kind: "secondary",
    };
  }

  if (options.button === 1) {
    return {
      kind: "pan",
    };
  }

  return {
    kind: "ignore",
  };
}

function resolvePointerMarqueeSelectionMode(options: {
  currentMode: CurrentInteractionMode;
  moveEntityId: string | null;
  phase: WorkbenchPhase;
  selectionModifierActive: boolean;
}): EditorSelectionUpdateMode | null {
  if (
    options.phase !== "edit" ||
    options.currentMode.key !== "select" ||
    options.moveEntityId !== null
  ) {
    return null;
  }

  return options.selectionModifierActive ? "toggle" : "replace";
}

export function resolveCanvasTouchDownRoute(
  options: ResolveCanvasTouchDownRouteOptions,
): CanvasTouchDownRoute {
  if (options.anchoredPlacementActive) {
    return {
      kind: "placement-or-pan",
      anchoredPlacementHit: isPointInsideScreenBox(
        options.screenPoint,
        options.anchoredPlacementScreenBox,
      ),
    };
  }

  if (
    isMoveInteractionMode(options.currentMode) &&
    options.currentMode.inputMode === "touch"
  ) {
    if (
      isPointInsideScreenBox(options.screenPoint, options.anchoredMoveScreenBox)
    ) {
      return {
        kind: "move",
      };
    }
  } else if (resolveSelectedEntityMoveCandidate(options) !== null) {
    return {
      kind: "move",
    };
  }

  return {
    kind: "gesture",
    interactionTarget: options.target,
  };
}

function getSelectedEntityIdForMove(
  controller: WorkbenchController,
): string | null {
  const selection = controller.editorStore.getSnapshot().session.selection;

  return selection[0] ?? null;
}

async function dispatchCanvasTap(options: {
  controller: WorkbenchController;
  currentMode: CurrentInteractionMode;
  displayTool: DisplayTool;
  interactionMode: PlacementInteractionMode;
  phase: WorkbenchPhase;
  screenPoint: CanvasPoint;
  selectionModifierActive: boolean;
}): Promise<void> {
  const target = options.controller.getCanvasInteractionTarget(options.screenPoint);
  const intent = resolveCanvasPanelTapIntent({
    phase: options.phase,
    currentMode: options.currentMode,
    selectionModifierActive: options.selectionModifierActive,
    target,
  });
  const placementMode = isPlacementInteractionMode(options.currentMode)
    ? options.currentMode
    : null;

  if (placementMode) {
    logger.info("Resolved canvas tap intent during placement.", {
      screenPoint: options.screenPoint,
      phase: options.phase,
      currentMode: options.currentMode,
      displayTool: options.displayTool,
      target,
      intent,
    });
  }

  switch (intent.kind) {
    case "select-edit-entity":
      await options.controller.selectEntity(intent.entityId, options.interactionMode);
      return;
    case "toggle-edit-entity":
      await options.controller.selectEntity(
        intent.entityId,
        options.interactionMode,
        "toggle",
      );
      return;
    case "clear-edit-selection":
      await options.controller.clearSelection();
      return;
    case "activate-link-target":
      await options.controller.activateLinkTarget(intent.entityId);
      return;
    case "commit-placement":
      await options.controller.commitPlacementAtScreenPoint(options.screenPoint);
      return;
    case "select-simulation-entity":
      await options.controller.selectSimulationEntity(intent.entityId);
      return;
    case "noop":
      return;
  }
}

export async function routeCanvasGestureEvent(
  options: RouteCanvasGestureEventOptions,
): Promise<void> {
  switch (options.event.kind) {
    case "tap":
      await dispatchCanvasTap({
        controller: options.controller,
        currentMode: options.currentMode,
        displayTool: options.displayTool,
        interactionMode: resolveInteractionModeFromGestureSource(
          options.event.source,
        ),
        phase: options.phase,
        screenPoint: options.event.screenPoint,
        selectionModifierActive: options.event.selectionModifierActive,
      });
      return;
    case "hover":
      options.schedulePlacementPreviewFromScreenPoint(options.event.screenPoint);
      return;
    case "drag-start":
      switch (options.event.recognizer) {
        case "touch-placement":
          options.schedulePlacementPreviewFromScreenPoint(options.event.screenPoint);
          return;
        case "touch-move": {
          const entityId = getSelectedEntityIdForMove(options.controller);

          if (!entityId) {
            return;
          }

          options.controller.beginMoveFromScreenPoint(
            entityId,
            options.event.origin,
            "touch",
          );

          if (
            isMoveInteractionMode(
              options.controller.editorStore.getSnapshot().session.currentMode,
            )
          ) {
            options.controller.updateMoveDraftFromScreenPoint(
              options.event.screenPoint,
            );
          }
          return;
        }
        case "pointer-move":
          if (!options.event.entityId) {
            return;
          }

          options.controller.beginMoveFromScreenPoint(
            options.event.entityId,
            options.event.origin,
            "pointer",
          );

          if (
            isMoveInteractionMode(
              options.controller.editorStore.getSnapshot().session.currentMode,
            )
          ) {
            options.controller.updateMoveDraftFromScreenPoint(
              options.event.screenPoint,
            );
          }
          return;
        case "pointer-marquee":
          options.controller.beginMarqueeFromScreenPoint(
            options.event.origin,
            "pointer",
            options.event.selectionMode ?? "replace",
          );
          options.controller.updateMarqueeDraftFromScreenPoint(
            options.event.screenPoint,
          );
          return;
      }
      return;
    case "drag":
      if (options.event.recognizer === "touch-placement") {
        options.schedulePlacementPreviewFromScreenPoint(options.event.screenPoint);
        return;
      }

      if (options.event.recognizer === "pointer-marquee") {
        options.controller.updateMarqueeDraftFromScreenPoint(
          options.event.screenPoint,
        );
        return;
      }

      if (
        isMoveInteractionMode(
          options.controller.editorStore.getSnapshot().session.currentMode,
        )
      ) {
        options.controller.updateMoveDraftFromScreenPoint(options.event.screenPoint);
      }
      return;
    case "drag-end":
      if (!options.event.didDrag) {
        return;
      }

      if (options.event.recognizer === "pointer-move") {
        if (options.event.outcome === "cancel") {
          options.controller.cancelMove();
          return;
        }

        if (options.controller.editorStore.getSnapshot().session.moveDraft?.valid) {
          await options.controller.confirmMovePreview();
        } else {
          options.controller.cancelMove();
        }
        return;
      }

      if (options.event.recognizer === "pointer-marquee") {
        if (options.event.outcome === "cancel") {
          options.cancelMarquee();
          return;
        }

        await options.controller.confirmMarqueeSelection();
      }
      return;
    case "pan-start":
    case "pan":
      options.controller.panCanvasBy(options.event.screenDelta);
      return;
    case "pan-end":
      return;
    case "pinch":
      if (options.event.scaleFactor && options.event.zoomAnchor) {
        options.controller.zoomCanvasAt(
          options.event.zoomAnchor,
          options.event.scaleFactor,
        );
      }

      if (options.event.midpointDelta) {
        const distance = Math.hypot(
          options.event.midpointDelta.x,
          options.event.midpointDelta.y,
        );

        if (distance > 0) {
          options.controller.panCanvasBy(options.event.midpointDelta);
        }
      }
      return;
    case "secondary-action": {
      const moveMode = isMoveInteractionMode(options.currentMode)
        ? options.currentMode
        : null;
      const placementMode = isPlacementInteractionMode(options.currentMode)
        ? options.currentMode
        : null;

      if (moveMode) {
        options.cancelMove();
        return;
      }

      if (placementMode) {
        options.cancelPlacement();
      }
      return;
    }
    case "clear-preview":
      options.cancelScheduledPlacementPreview();

      if (!options.anchoredPlacementActive) {
        options.controller.clearPlacementPreview();
      } else if (options.event.reason !== "touch-down") {
        options.controller.clearPlacementPreview();
      }
      return;
  }
}
