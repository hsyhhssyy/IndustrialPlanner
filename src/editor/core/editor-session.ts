export type EditorTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export interface EditorSession {
  activeTool: EditorTool;
  selection: string[];
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  placementDefinitionId: string | null;
  pendingLinkSourceEntityId: string | null;
}

export function createInitialEditorSession(): EditorSession {
  return {
    activeTool: "select",
    selection: ["reactor-1"],
    hoveredEntityId: null,
    dragPreviewEntityId: null,
    placementDefinitionId: null,
    pendingLinkSourceEntityId: null,
  };
}

export function isPlacementTool(tool: EditorTool): boolean {
  return tool === "place" || tool === "belt" || tool === "pipe";
}
