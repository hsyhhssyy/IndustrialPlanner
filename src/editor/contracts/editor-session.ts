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
