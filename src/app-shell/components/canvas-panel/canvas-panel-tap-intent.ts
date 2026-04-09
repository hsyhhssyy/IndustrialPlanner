import type { CurrentInteractionMode } from "@/editor/contracts/interaction-mode";
import type { CanvasInteractionTarget } from "@/workbench/contracts/workbench-facade";
import type { WorkbenchPhase } from "@/workbench/workbench-ui-state";

export type CanvasPanelTapIntent =
  | {
      kind: "noop";
    }
  | {
      kind: "select-edit-entity";
      entityId: string;
    }
  | {
      kind: "clear-edit-selection";
    }
  | {
      kind: "activate-link-target";
      entityId: string | null;
    }
  | {
      kind: "commit-placement";
    }
  | {
      kind: "select-simulation-entity";
      entityId: string | null;
    };

export interface ResolveCanvasPanelTapIntentOptions {
  phase: WorkbenchPhase;
  currentMode: CurrentInteractionMode;
  target: CanvasInteractionTarget;
}

export function resolveCanvasPanelTapIntent(
  options: ResolveCanvasPanelTapIntentOptions,
): CanvasPanelTapIntent {
  const targetEntityId =
    options.target.kind === "entity" ? options.target.entityId : null;

  if (options.phase === "simulate") {
    return {
      kind: "select-simulation-entity",
      entityId: targetEntityId,
    };
  }

  switch (options.currentMode.key) {
    case "link":
      return {
        kind: "activate-link-target",
        entityId: targetEntityId,
      };
    case "placement":
      return options.currentMode.inputMode === "pointer"
        ? {
            kind: "commit-placement",
          }
        : {
            kind: "noop",
          };
    case "move":
      return {
        kind: "noop",
      };
    default:
      break;
  }

  if (targetEntityId) {
    return {
      kind: "select-edit-entity",
      entityId: targetEntityId,
    };
  }

  return {
    kind: "clear-edit-selection",
  };
}
