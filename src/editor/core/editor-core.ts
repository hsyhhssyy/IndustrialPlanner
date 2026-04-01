import {
  applyWorldDocumentCommand,
  createExplicitLinkId,
  createWorldEntityId,
  getEntityLinks,
  type GridPoint,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { DocumentCommand } from "@/domain/document/document-command";
import type { EditorSession, EditorTool } from "@/editor/core/editor-session";

interface DocumentHistoryEntry {
  command: DocumentCommand;
  before: WorldDocument;
  after: WorldDocument;
}

export interface EditorHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export interface EditorCoreSnapshot {
  document: WorldDocument;
  session: EditorSession;
  history: EditorHistorySnapshot;
}

export interface EditorCore {
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
}

interface CreateEditorCoreOptions {
  document: WorldDocument;
  session: EditorSession;
}

class EditorCoreImpl implements EditorCore {
  private document: WorldDocument;
  private session: EditorSession;
  private undoStack: DocumentHistoryEntry[] = [];
  private redoStack: DocumentHistoryEntry[] = [];

  constructor(options: CreateEditorCoreOptions) {
    this.document = options.document;
    this.session = options.session;
  }

  getSnapshot(): EditorCoreSnapshot {
    return {
      document: this.document,
      session: this.session,
      history: {
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        undoDepth: this.undoStack.length,
        redoDepth: this.redoStack.length,
      },
    };
  }

  setActiveTool(tool: EditorTool): void {
    this.session = {
      ...this.session,
      activeTool: tool,
      pendingLinkSourceEntityId:
        tool === "link" ? this.session.pendingLinkSourceEntityId : null,
    };
  }

  setPlacementDefinition(definitionId: string, tool: EditorTool = "place"): void {
    this.session = {
      ...this.session,
      activeTool: tool,
      placementDefinitionId: definitionId,
      pendingLinkSourceEntityId: null,
    };
  }

  selectEntity(entityId: string | null): void {
    this.session = {
      ...this.session,
      selection: entityId ? [entityId] : [],
    };
  }

  setPendingLinkSource(entityId: string | null): void {
    this.session = {
      ...this.session,
      pendingLinkSourceEntityId: entityId,
    };
  }

  placeEntity(definitionId: string, position: GridPoint): void {
    const entityId = createWorldEntityId(this.document, definitionId);
    const nextCommand: DocumentCommand = {
      type: "entity.place",
      payload: {
        entityId,
        definitionId,
        position,
        rotation: 0,
        config: {},
        tags: ["user-placed"],
      },
    };

    if (this.applyCommand(nextCommand)) {
      this.session = {
        ...this.session,
        selection: [entityId],
        placementDefinitionId: definitionId,
        pendingLinkSourceEntityId: null,
      };
    }
  }

  createLink(sourceEntityId: string, targetEntityId: string): void {
    const nextCommand: DocumentCommand = {
      type: "link.create",
      payload: {
        linkId: createExplicitLinkId(this.document, "dark-pipe"),
        kind: "dark-pipe",
        sourceEntityId,
        targetEntityId,
      },
    };

    if (this.applyCommand(nextCommand)) {
      this.session = {
        ...this.session,
        selection: [targetEntityId],
        pendingLinkSourceEntityId: null,
      };
    }
  }

  removeLink(linkId: string): void {
    if (this.applyCommand({ type: "link.remove", payload: { linkId } })) {
      this.session = {
        ...this.session,
        pendingLinkSourceEntityId: null,
      };
    }
  }

  removeSelectedEntities(): void {
    const selectedIds = [...this.session.selection];

    selectedIds.forEach((entityId) => {
      this.applyCommand({
        type: "entity.remove",
        payload: { entityId },
      });
    });

    this.sanitizeSession();
    this.session = {
      ...this.session,
      selection: [],
      pendingLinkSourceEntityId: null,
    };
  }

  removeSelectedLinks(): void {
    const linkIds = Array.from(
      new Set(
        this.session.selection.flatMap((entityId) =>
          getEntityLinks(this.document, entityId).map((link) => link.id),
        ),
      ),
    );

    linkIds.forEach((linkId) => {
      this.applyCommand({
        type: "link.remove",
        payload: { linkId },
      });
    });

    this.sanitizeSession();
  }

  undo(): void {
    const entry = this.undoStack.pop();

    if (!entry) {
      return;
    }

    this.document = entry.before;
    this.redoStack.push(entry);
    this.sanitizeSession();
  }

  redo(): void {
    const entry = this.redoStack.pop();

    if (!entry) {
      return;
    }

    this.document = entry.after;
    this.undoStack.push(entry);
    this.sanitizeSession();
  }

  private applyCommand(command: DocumentCommand): boolean {
    const nextDocument = applyWorldDocumentCommand(this.document, command);

    if (nextDocument === this.document) {
      return false;
    }

    this.undoStack.push({
      command,
      before: this.document,
      after: nextDocument,
    });
    this.redoStack = [];
    this.document = nextDocument;
    this.sanitizeSession();
    return true;
  }

  private sanitizeSession(): void {
    const selection = this.session.selection.filter(
      (entityId) => Boolean(this.document.entities[entityId]),
    );
    const hoveredEntityId =
      this.session.hoveredEntityId &&
      this.document.entities[this.session.hoveredEntityId]
        ? this.session.hoveredEntityId
        : null;
    const dragPreviewEntityId =
      this.session.dragPreviewEntityId &&
      this.document.entities[this.session.dragPreviewEntityId]
        ? this.session.dragPreviewEntityId
        : null;
    const pendingLinkSourceEntityId =
      this.session.pendingLinkSourceEntityId &&
      this.document.entities[this.session.pendingLinkSourceEntityId]
        ? this.session.pendingLinkSourceEntityId
        : null;

    this.session = {
      ...this.session,
      selection,
      hoveredEntityId,
      dragPreviewEntityId,
      pendingLinkSourceEntityId,
    };
  }
}

export function createEditorCore(
  options: CreateEditorCoreOptions,
): EditorCore {
  return new EditorCoreImpl(options);
}
