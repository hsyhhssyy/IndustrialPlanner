import type { GridPoint } from "@/domain/document/world-document";

export type EditorTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export interface EditorViewport {
  offset: GridPoint;
  zoom: number;
}

export interface EditorSession {
  activeTool: EditorTool;
  selection: string[];
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  viewport: EditorViewport;
}

export function createInitialEditorSession(): EditorSession {
  return {
    activeTool: "select",
    selection: ["reactor-1"],
    hoveredEntityId: null,
    dragPreviewEntityId: null,
    viewport: {
      offset: { x: 0, y: 0 },
      zoom: 1,
    },
  };
}
