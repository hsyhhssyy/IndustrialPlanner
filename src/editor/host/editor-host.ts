import {
  createEditorCore,
  type EditorCore,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type {
  EditorSession,
  EditorTool,
} from "@/editor/contracts/editor-session";
import type {
  PlacementPreviewState,
  PlacementPreviewStrategy,
} from "@/editor/contracts/placement-preview";
import type { WorldDocument } from "@/domain/document/world-document";
import type { GridPoint } from "@/shared/geometry/grid";

export interface EditorHost {
  getSnapshot: () => EditorCoreSnapshot;
  setActiveTool: (tool: EditorTool) => void;
  setPlacementDefinition: (
    definitionId: string,
    tool?: EditorTool,
    strategy?: PlacementPreviewStrategy,
  ) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  selectEntity: (entityId: string | null) => void;
  setPendingLinkSource: (entityId: string | null) => void;
  placeEntity: (definitionId: string, position: GridPoint) => void;
  patchEntityConfig: (entityId: string, patch: Record<string, unknown>) => void;
  createLink: (sourceEntityId: string, targetEntityId: string) => void;
  removeLink: (linkId: string) => void;
  removeSelectedEntities: () => void;
  removeSelectedLinks: () => void;
  undo: () => void;
  redo: () => void;
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

  setPlacementDefinition(
    definitionId: string,
    tool?: EditorTool,
    strategy?: PlacementPreviewStrategy,
  ): void {
    this.core.setPlacementDefinition(definitionId, tool, strategy);
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    this.core.setPlacementPreview(preview);
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

  patchEntityConfig(entityId: string, patch: Record<string, unknown>): void {
    this.core.patchEntityConfig(entityId, patch);
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
}

export function createEditorHost(
  options: CreateEditorHostOptions,
): EditorHost {
  return new EditorHostImpl(options);
}
