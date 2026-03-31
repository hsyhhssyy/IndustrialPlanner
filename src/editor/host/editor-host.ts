import {
  createEditorCore,
  type EditorCore,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type { EditorSession, EditorTool } from "@/editor/core/editor-session";
import type { WorldDocument } from "@/domain/document/world-document";

export interface EditorHost {
  getSnapshot: () => EditorCoreSnapshot;
  setActiveTool: (tool: EditorTool) => void;
  selectEntity: (entityId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface CreateEditorHostOptions {
  document: WorldDocument;
  session: EditorSession;
  core?: EditorCore;
}

class EditorHostImpl implements EditorHost {
  private readonly core: EditorCore;

  constructor(options: CreateEditorHostOptions) {
    this.core =
      options.core ??
      createEditorCore({
        document: options.document,
        session: options.session,
      });
  }

  getSnapshot(): EditorCoreSnapshot {
    return this.core.getSnapshot();
  }

  setActiveTool(tool: EditorTool): void {
    this.core.setActiveTool(tool);
  }

  selectEntity(entityId: string): void {
    this.core.selectEntity(entityId);
  }

  zoomIn(): void {
    this.core.zoomBy(0.1);
  }

  zoomOut(): void {
    this.core.zoomBy(-0.1);
  }
}

export function createEditorHost(
  options: CreateEditorHostOptions,
): EditorHost {
  return new EditorHostImpl(options);
}
