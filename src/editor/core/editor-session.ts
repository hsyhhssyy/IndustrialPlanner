import type {
  EditorSession,
} from "@/editor/contracts/editor-session";
import {
  createSelectInteractionMode,
  isPlacementDisplayTool,
  type DisplayTool,
} from "@/editor/contracts/interaction-mode";

export function createInitialEditorSession(): EditorSession {
  return {
    displayTool: "select",
    currentMode: createSelectInteractionMode(),
    selection: ["reactor-1"],
    selectionInputMode: null,
    hoveredEntityId: null,
    placementPreview: null,
    moveDraft: null,
    marqueeDraft: null,
  };
}

export function isPlacementTool(tool: DisplayTool): boolean {
  return isPlacementDisplayTool(tool);
}
