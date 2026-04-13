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
      kind: "toggle-edit-entity";
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
    };

export interface ResolveCanvasPanelTapIntentOptions {
  phase: WorkbenchPhase;
  currentMode: CurrentInteractionMode;
  selectionModifierActive: boolean;
  target: CanvasInteractionTarget;
}

export function resolveCanvasPanelTapIntent(
  options: ResolveCanvasPanelTapIntentOptions,
): CanvasPanelTapIntent {
  const targetEntityId =
    options.target.kind === "entity" ? options.target.entityId : null;

  if (options.phase === "simulate") {
    return {
      kind: "noop",
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
    case "marquee":
      return {
        kind: "noop",
      };
    default:
      break;
  }

  if (targetEntityId) {
    return {
      kind: options.selectionModifierActive
        ? "toggle-edit-entity"
        : "select-edit-entity",
      entityId: targetEntityId,
    };
  }

  if (options.selectionModifierActive) {
    return {
      kind: "noop",
    };
  }

  return {
    kind: "clear-edit-selection",
  };
}
