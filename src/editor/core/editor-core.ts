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
  MovePreviewState,
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import {
  applyEditorMode,
  createInspectEditorMode,
  createLinkEditorMode,
  createMoveEditorMode,
  createPlacementEditorMode,
  createSelectEditorMode,
  isLinkMode,
  isMoveMode,
  isPlacementMode,
  resolveEditorModeFallback,
} from "@/editor/core/editor-session";
import {
  rotateGridRotationClockwise,
  type GridPoint,
  type GridRotation,
} from "@/shared/geometry/grid";

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
    interactionMode?: PlacementInteractionMode,
  ) => void;
  setPlacementRotation: (rotation: GridRotation | null) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  beginMoveSelection: (interactionMode: PlacementInteractionMode) => boolean;
  setMovePreview: (preview: MovePreviewState | null) => void;
  cancelMove: () => boolean;
  selectEntity: (
    entityId: string | null,
    interactionMode?: PlacementInteractionMode | null,
  ) => void;
  moveSelectedEntity: (
    position: GridPoint,
    rotation?: GridRotation,
  ) => boolean;
  rotateSelectedEntityClockwise: (position?: GridPoint) => boolean;
  setPendingLinkSource: (entityId: string | null) => void;
  placeEntity: (
    definitionId: string,
    position: GridPoint,
    rotation?: GridRotation,
  ) => void;
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
    if (tool === "link") {
      this.session = applyEditorMode(this.session, createLinkEditorMode());
      return;
    }

    if (tool === "inspect") {
      this.session = applyEditorMode(this.session, createInspectEditorMode());
      return;
    }

    this.session = applyEditorMode(this.session, createSelectEditorMode(tool));
  }

  setPlacementDefinition(
    definitionId: string,
    tool: EditorTool = "place",
    interactionMode: PlacementInteractionMode = "pointer",
  ): void {
    this.session = applyEditorMode(
      this.session,
      createPlacementEditorMode({
        definitionId,
        displayTool: tool,
        interactionMode,
      }),
    );
  }

  setPlacementRotation(rotation: GridRotation | null): void {
    if (!isPlacementMode(this.session.mode)) {
      return;
    }

    this.session = applyEditorMode(this.session, {
      ...this.session.mode,
      rotation: rotation ?? 0,
    });
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    if (!isPlacementMode(this.session.mode)) {
      return;
    }

    this.session = applyEditorMode(this.session, {
      ...this.session.mode,
      preview,
    });
  }

  beginMoveSelection(interactionMode: PlacementInteractionMode): boolean {
    const selectedEntityId = this.session.selection[0];

    if (!selectedEntityId) {
      return false;
    }

    const entity = this.document.entities[selectedEntityId];

    if (!entity) {
      return false;
    }

    this.session = applyEditorMode(
      {
        ...this.session,
        selection: [selectedEntityId],
        selectionInteractionMode: interactionMode,
      },
      createMoveEditorMode({
        entityId: selectedEntityId,
        definitionId: entity.definitionId,
        interactionMode,
        originGridPoint: entity.position,
        originRotation: entity.rotation,
        preview: {
          entityId: selectedEntityId,
          definitionId: entity.definitionId,
          interactionMode,
          gridPoint: {
            ...entity.position,
          },
          rotation: entity.rotation,
          valid: true,
        },
      }),
    );
    return true;
  }

  setMovePreview(preview: MovePreviewState | null): void {
    if (!isMoveMode(this.session.mode) || !preview) {
      return;
    }

    this.session = applyEditorMode(this.session, {
      ...this.session.mode,
      preview,
    });
  }

  cancelMove(): boolean {
    if (!isMoveMode(this.session.mode)) {
      return false;
    }

    this.session = applyEditorMode(this.session, resolveEditorModeFallback(this.session.mode));
    return true;
  }

  selectEntity(
    entityId: string | null,
    interactionMode: PlacementInteractionMode | null = entityId
      ? this.session.selectionInteractionMode
      : null,
  ): void {
    const nextSelection = entityId ? [entityId] : [];
    const nextMode =
      isMoveMode(this.session.mode) && this.session.mode.entityId !== entityId
        ? resolveEditorModeFallback(this.session.mode)
        : this.session.mode;

    this.session = applyEditorMode(
      {
        ...this.session,
        selection: nextSelection,
        selectionInteractionMode: entityId ? interactionMode : null,
      },
      nextMode,
    );
  }

  moveSelectedEntity(
    position: GridPoint,
    rotation?: GridRotation,
  ): boolean {
    const selectedEntityId = this.session.selection[0];

    if (!selectedEntityId) {
      return false;
    }

    const effectiveRotation = rotation ?? this.document.entities[selectedEntityId]?.rotation;
    const didMove = this.applyCommand({
      type: "entity.move",
      payload: {
        entityId: selectedEntityId,
        position,
        ...(effectiveRotation !== undefined ? { rotation: effectiveRotation } : {}),
      },
    });

    if (!didMove) {
      if (isMoveMode(this.session.mode)) {
        this.session = applyEditorMode(
          {
            ...this.session,
            selection: [selectedEntityId],
            selectionInteractionMode: this.session.mode.interactionMode,
          },
          resolveEditorModeFallback(this.session.mode),
        );
      }

      return false;
    }

    const nextMode = isMoveMode(this.session.mode)
      ? resolveEditorModeFallback(this.session.mode)
      : this.session.mode;

    this.session = applyEditorMode(
      {
        ...this.session,
        selection: [selectedEntityId],
        selectionInteractionMode: isMoveMode(this.session.mode)
          ? this.session.mode.interactionMode
          : this.session.selectionInteractionMode,
      },
      nextMode,
    );
    return true;
  }

  rotateSelectedEntityClockwise(position?: GridPoint): boolean {
    const selectedEntityId = this.session.selection[0];

    if (!selectedEntityId) {
      return false;
    }

    const entity = this.document.entities[selectedEntityId];

    if (!entity) {
      return false;
    }

    return this.applyCommand({
      type: "entity.rotate",
      payload: {
        entityId: selectedEntityId,
        position,
        rotation: rotateGridRotationClockwise(entity.rotation),
      },
    });
  }

  setPendingLinkSource(entityId: string | null): void {
    if (!isLinkMode(this.session.mode)) {
      return;
    }

    this.session = applyEditorMode(this.session, {
      ...this.session.mode,
      pendingSourceEntityId: entityId,
    });
  }

  placeEntity(
    definitionId: string,
    position: GridPoint,
    rotation: GridRotation = 0,
  ): void {
    const entityId = createWorldEntityId(this.document, definitionId);
    const nextCommand: DocumentCommand = {
      type: "entity.place",
      payload: {
        entityId,
        definitionId,
        position,
        rotation,
        config: {},
        tags: ["user-placed"],
      },
    };

    if (this.applyCommand(nextCommand)) {
      this.session = applyEditorMode(
        {
          ...this.session,
          selection: [entityId],
          selectionInteractionMode: this.session.placementInteractionMode,
        },
        this.session.mode,
      );
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
      const nextMode = isLinkMode(this.session.mode)
        ? {
            ...this.session.mode,
            pendingSourceEntityId: null,
          }
        : this.session.mode;

      this.session = applyEditorMode(
        {
          ...this.session,
          selection: [targetEntityId],
          selectionInteractionMode: null,
        },
        nextMode,
      );
    }
  }

  removeLink(linkId: string): void {
    if (this.applyCommand({ type: "link.remove", payload: { linkId } })) {
      const nextMode = isLinkMode(this.session.mode)
        ? {
            ...this.session.mode,
            pendingSourceEntityId: null,
          }
        : this.session.mode;

      this.session = applyEditorMode(this.session, nextMode);
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
    this.session = applyEditorMode(
      {
        ...this.session,
        selection: [],
        selectionInteractionMode: null,
      },
      this.session.mode,
    );
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
    const mode = (() => {
      if (isLinkMode(this.session.mode)) {
        return {
          ...this.session.mode,
          pendingSourceEntityId: pendingLinkSourceEntityId,
        };
      }

      if (isMoveMode(this.session.mode)) {
        if (
          !this.document.entities[this.session.mode.entityId] ||
          !selection.includes(this.session.mode.entityId)
        ) {
          return resolveEditorModeFallback(this.session.mode);
        }
      }

      return this.session.mode;
    })();

    this.session = applyEditorMode(
      {
        ...this.session,
        selection,
        selectionInteractionMode:
          selection.length > 0 ? this.session.selectionInteractionMode : null,
        hoveredEntityId,
        dragPreviewEntityId,
        pendingLinkSourceEntityId,
      },
      mode,
    );
  }
}

export function createEditorCore(
  options: CreateEditorCoreOptions,
): EditorCore {
  return new EditorCoreImpl(options);
}
