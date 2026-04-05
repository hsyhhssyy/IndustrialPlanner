import type {
  EditorSession,
  EditorTool,
} from "@/editor/contracts/editor-session";

export function createInitialEditorSession(): EditorSession {
  return {
    activeTool: "select",
    selection: ["reactor-1"],
    hoveredEntityId: null,
    dragPreviewEntityId: null,
    placementDefinitionId: null,
    placementInteractionMode: null,
    placementRotation: null,
    placementPreview: null,
    pendingLinkSourceEntityId: null,
  };
}

export function isPlacementTool(tool: EditorTool): boolean {
  return tool === "place" || tool === "belt" || tool === "pipe";
}
