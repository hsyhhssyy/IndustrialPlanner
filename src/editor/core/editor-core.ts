import {
  createExplicitLinkId,
  createWorldEntityId,
  getEntityLinks,
  type WorldDocument,
} from "@/domain/document/world-document";
import { applyWorldDocumentCommand } from "@/editor/core/commands/document-command-applier";
import type { DocumentCommand } from "@/editor/core/commands/document-command";
import type {
  EditorSession,
  EditorTool,
} from "@/editor/contracts/editor-session";
import type {
  PlacementPreviewState,
  PlacementPreviewStrategy,
} from "@/editor/contracts/placement-preview";
import { isPlacementTool } from "@/editor/core/editor-session";
import type { GridPoint } from "@/shared/geometry/grid";

interface DocumentHistoryEntry {
  command: DocumentCommand;
  before: WorldDocument;
  after: WorldDocument;
}

export interface EditorHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export type EditorHistorySnapshot = EditorHistoryState;

export interface EditorCoreSnapshot {
  document: WorldDocument;
  session: EditorSession;
  history: EditorHistoryState;
}

export interface EditorCore {
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

interface CreateEditorCoreOptions {
  document: WorldDocument;
  session: EditorSession;
}

class EditorCoreImpl implements EditorCore {
  private document: WorldDocument;
  private session: EditorSession;
  private undoStack: DocumentHistoryEntry[] = [];
  private redoStack: DocumentHistoryEntry[] = [];
  private historyState: EditorHistoryState;

  constructor(options: CreateEditorCoreOptions) {
    this.document = options.document;
    this.session = options.session;
    this.historyState = this.createHistoryState();
  }

  getSnapshot(): EditorCoreSnapshot {
    return {
      document: this.document,
      session: this.session,
      history: this.historyState,
    };
  }

  setActiveTool(tool: EditorTool): void {
    this.session = {
      ...this.session,
      activeTool: tool,
      placementDefinitionId: isPlacementTool(tool)
        ? this.session.placementDefinitionId
        : null,
      placementStrategy: isPlacementTool(tool)
        ? this.session.placementStrategy
        : null,
      placementPreview: isPlacementTool(tool)
        ? this.session.placementPreview
        : null,
      pendingLinkSourceEntityId:
        tool === "link" ? this.session.pendingLinkSourceEntityId : null,
    };
  }

  setPlacementDefinition(
    definitionId: string,
    tool: EditorTool = "place",
    strategy: PlacementPreviewStrategy = "pointer-follow",
  ): void {
    this.session = {
      ...this.session,
      activeTool: tool,
      placementDefinitionId: definitionId,
      placementStrategy: strategy,
      placementPreview: null,
      pendingLinkSourceEntityId: null,
    };
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    this.session = {
      ...this.session,
      placementPreview: preview,
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
        placementStrategy: this.session.placementStrategy,
        placementPreview: this.session.placementPreview,
        pendingLinkSourceEntityId: null,
      };
    }
  }

  patchEntityConfig(entityId: string, patch: Record<string, unknown>): void {
    this.applyCommand({
      type: "entity.config.patch",
      payload: {
        entityId,
        patch,
      },
    });
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
    this.historyState = this.createHistoryState();
    this.sanitizeSession();
  }

  redo(): void {
    const entry = this.redoStack.pop();

    if (!entry) {
      return;
    }

    this.document = entry.after;
    this.undoStack.push(entry);
    this.historyState = this.createHistoryState();
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
    this.historyState = this.createHistoryState();
    this.sanitizeSession();
    return true;
  }

  private createHistoryState(): EditorHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
    };
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
      placementPreview:
        this.session.placementDefinitionId && isPlacementTool(this.session.activeTool)
          ? this.session.placementPreview
          : null,
    };
  }
}

export function createEditorCore(
  options: CreateEditorCoreOptions,
): EditorCore {
  return new EditorCoreImpl(options);
}
