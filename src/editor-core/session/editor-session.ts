import type { GridPoint } from "@/editor-core/document/world-document";
import type { WorkbenchMode } from "@/app-shell/state/workbench-ui-state";

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
  mode: WorkbenchMode;
  activeTool: EditorTool;
  selection: string[];
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  viewport: EditorViewport;
}

export function createInitialEditorSession(): EditorSession {
  return {
    mode: "edit",
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
