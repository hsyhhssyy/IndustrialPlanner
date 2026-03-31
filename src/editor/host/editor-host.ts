import {
  createEditorCore,
  type EditorCore,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type { EditorSession, EditorTool } from "@/editor/core/editor-session";
import type { GridPoint, WorldDocument } from "@/domain/document/world-document";

export interface EditorHost {
  getSnapshot: () => EditorCoreSnapshot;
  setActiveTool: (tool: EditorTool) => void;
  setPlacementDefinition: (definitionId: string, tool?: EditorTool) => void;
  selectEntity: (entityId: string | null) => void;
  setPendingLinkSource: (entityId: string | null) => void;
  placeEntity: (definitionId: string, position: GridPoint) => void;
  createLink: (sourceEntityId: string, targetEntityId: string) => void;
  removeLink: (linkId: string) => void;
  removeSelectedEntities: () => void;
  removeSelectedLinks: () => void;
  undo: () => void;
  redo: () => void;
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

  setPlacementDefinition(definitionId: string, tool?: EditorTool): void {
    this.core.setPlacementDefinition(definitionId, tool);
  }

  selectEntity(entityId: string | null): void {
    this.core.selectEntity(entityId);
  }

  setPendingLinkSource(entityId: string | null): void {
    this.core.setPendingLinkSource(entityId);
  }

  placeEntity(definitionId: string, position: GridPoint): void {
    this.core.placeEntity(definitionId, position);
  }

  createLink(sourceEntityId: string, targetEntityId: string): void {
    this.core.createLink(sourceEntityId, targetEntityId);
  }

  removeLink(linkId: string): void {
    this.core.removeLink(linkId);
  }

  removeSelectedEntities(): void {
    this.core.removeSelectedEntities();
  }

  removeSelectedLinks(): void {
    this.core.removeSelectedLinks();
  }

  undo(): void {
    this.core.undo();
  }

  redo(): void {
    this.core.redo();
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
