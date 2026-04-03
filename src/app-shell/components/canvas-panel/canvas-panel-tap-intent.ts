import type { CanvasInteractionTarget } from "@/app-shell/contracts/workbench-facade";
import type { WorkbenchMode } from "@/app-shell/contracts/workbench-ui";
import type { PlacementPreviewStrategy } from "@/editor/contracts/placement-preview";
import type { EditorTool } from "@/editor/contracts/editor-session";
import { isPlacementTool } from "@/editor/core/editor-session";

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
  mode: WorkbenchMode;
  activeTool: EditorTool;
  placementDefinitionId: string | null;
  placementStrategy: PlacementPreviewStrategy | null;
  target: CanvasInteractionTarget;
}

export function resolveCanvasPanelTapIntent(
  options: ResolveCanvasPanelTapIntentOptions,
): CanvasPanelTapIntent {
  const targetEntityId =
    options.target.kind === "entity" ? options.target.entityId : null;

  if (options.mode === "simulate") {
    return {
      kind: "select-simulation-entity",
      entityId: targetEntityId,
    };
  }

  if (options.activeTool === "link") {
    return {
      kind: "activate-link-target",
      entityId: targetEntityId,
    };
  }

  if (targetEntityId) {
    return {
      kind: "select-edit-entity",
      entityId: targetEntityId,
    };
  }

  if (
    isPlacementTool(options.activeTool) &&
    options.placementDefinitionId &&
    options.placementStrategy === "pointer-follow"
  ) {
    return {
      kind: "commit-placement",
    };
  }

  if (
    isPlacementTool(options.activeTool) &&
    options.placementDefinitionId &&
    options.placementStrategy === "anchored-confirm"
  ) {
    return {
      kind: "noop",
    };
  }

  return {
    kind: "clear-edit-selection",
  };
}
