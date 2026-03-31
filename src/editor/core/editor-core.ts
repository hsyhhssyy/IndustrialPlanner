import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorSession, EditorTool } from "@/editor/core/editor-session";

export interface EditorCoreSnapshot {
  document: WorldDocument;
  session: EditorSession;
}

export interface EditorCore {
  getSnapshot: () => EditorCoreSnapshot;
  setActiveTool: (tool: EditorTool) => void;
  selectEntity: (entityId: string) => void;
  zoomBy: (delta: number) => void;
}

interface CreateEditorCoreOptions {
  document: WorldDocument;
  session: EditorSession;
}

class EditorCoreImpl implements EditorCore {
  private readonly document: WorldDocument;
  private session: EditorSession;

  constructor(options: CreateEditorCoreOptions) {
    this.document = options.document;
    this.session = options.session;
  }

  getSnapshot(): EditorCoreSnapshot {
    return {
      document: this.document,
      session: this.session,
    };
  }

  setActiveTool(tool: EditorTool): void {
    this.session = {
      ...this.session,
      activeTool: tool,
    };
  }

  selectEntity(entityId: string): void {
    this.session = {
      ...this.session,
      selection: [entityId],
    };
  }

  zoomBy(delta: number): void {
    this.session = {
      ...this.session,
      viewport: {
        ...this.session.viewport,
        zoom: Math.min(2.5, Math.max(0.5, this.session.viewport.zoom + delta)),
      },
    };
  }
}

export function createEditorCore(
  options: CreateEditorCoreOptions,
): EditorCore {
  return new EditorCoreImpl(options);
}
