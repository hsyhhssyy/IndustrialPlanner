import {
  createExplicitLinkId,
  createWorldEntityId,
  getEntityLinks,
  type WorldDocument,
} from "@/domain/document/world-document";
import { applyWorldDocumentCommand } from "@/editor/core/commands/document-command-applier";
import type { DocumentCommand } from "@/editor/core/commands/document-command";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  createInspectInteractionMode,
  createLinkInteractionMode,
  createPlacementInteractionMode,
  createSelectInteractionMode,
  getPendingLinkSourceEntityId,
  isLinkInteractionMode,
  isPlacementInteractionMode,
  resolveDisplayToolForMode,
  type InteractionModeKey,
  type PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import type {
  PlacementInteractionMode,
  PlacementPreviewState,
} from "@/editor/contracts/placement-preview";
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
  setInteractionMode: (modeKey: Exclude<InteractionModeKey, "placement">) => void;
  armPlacement: (
    definitionId: string,
    displayTool?: PlacementDisplayTool,
    inputMode?: PlacementInteractionMode,
  ) => void;
  setPlacementRotation: (rotation: GridRotation | null) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  selectEntity: (
    entityId: string | null,
    inputMode?: PlacementInteractionMode | null,
  ) => void;
  rotateSelectedEntityClockwise: (position?: GridPoint) => boolean;
  setLinkSourceEntityId: (entityId: string | null) => void;
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

  setInteractionMode(modeKey: Exclude<InteractionModeKey, "placement">): void {
    const context = {
      previousModeKey: this.session.currentMode.key,
      entryDisplayTool: this.session.displayTool,
    };

    switch (modeKey) {
      case "select":
        this.applyInteractionMode(createSelectInteractionMode(context), true);
        return;
      case "link":
        this.applyInteractionMode(createLinkInteractionMode(context), true);
        return;
      case "inspect":
        this.applyInteractionMode(createInspectInteractionMode(context), true);
        return;
    }
  }

  armPlacement(
    definitionId: string,
    displayTool: PlacementDisplayTool = "place",
    inputMode: PlacementInteractionMode = "pointer",
  ): void {
    this.applyInteractionMode(
      createPlacementInteractionMode({
        definitionId,
        displayTool,
        inputMode,
        rotation: 0,
        previousModeKey: this.session.currentMode.key,
        entryDisplayTool: displayTool,
      }),
      true,
    );
  }

  setPlacementRotation(rotation: GridRotation | null): void {
    if (!isPlacementInteractionMode(this.session.currentMode)) {
      return;
    }

    this.applyInteractionMode(
      {
        ...this.session.currentMode,
        rotation: rotation ?? 0,
      },
      false,
    );
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    this.session = {
      ...this.session,
      placementPreview: preview,
    };
  }

  selectEntity(
    entityId: string | null,
    inputMode: PlacementInteractionMode | null = entityId
      ? this.session.selectionInputMode
      : null,
  ): void {
    this.session = {
      ...this.session,
      selection: entityId ? [entityId] : [],
      selectionInputMode: entityId ? inputMode : null,
    };
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

  setLinkSourceEntityId(entityId: string | null): void {
    if (!isLinkInteractionMode(this.session.currentMode)) {
      if (entityId === null) {
        return;
      }

      this.applyInteractionMode(
        createLinkInteractionMode({
          sourceEntityId: entityId,
          previousModeKey: this.session.currentMode.key,
          entryDisplayTool: this.session.displayTool,
        }),
        true,
      );
      return;
    }

    this.applyInteractionMode(
      {
        ...this.session.currentMode,
        sourceEntityId: entityId,
      },
      true,
    );
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

    if (!this.applyCommand(nextCommand)) {
      return;
    }

    const placementMode = isPlacementInteractionMode(this.session.currentMode)
      ? this.session.currentMode
      : null;

    this.session = {
      ...this.session,
      selection: [entityId],
      selectionInputMode: placementMode?.inputMode ?? this.session.selectionInputMode,
    };
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
        selectionInputMode: null,
      };
      this.setLinkSourceEntityId(null);
    }
  }

  removeLink(linkId: string): void {
    if (this.applyCommand({ type: "link.remove", payload: { linkId } })) {
      this.setLinkSourceEntityId(null);
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
      selectionInputMode: null,
    };
    this.setLinkSourceEntityId(null);
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

  private applyInteractionMode(
    nextMode: EditorSession["currentMode"],
    clearPlacementPreview: boolean,
  ): void {
    this.session = {
      ...this.session,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
      placementPreview: clearPlacementPreview ? null : this.session.placementPreview,
    };
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
      getPendingLinkSourceEntityId(this.session.currentMode) &&
      this.document.entities[getPendingLinkSourceEntityId(this.session.currentMode) ?? ""]
        ? getPendingLinkSourceEntityId(this.session.currentMode)
        : null;
    const nextMode = isLinkInteractionMode(this.session.currentMode)
      ? {
          ...this.session.currentMode,
          sourceEntityId: pendingLinkSourceEntityId,
        }
      : this.session.currentMode;

    this.session = {
      ...this.session,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
      selection,
      selectionInputMode:
        selection.length > 0 ? this.session.selectionInputMode : null,
      hoveredEntityId,
      dragPreviewEntityId,
      placementPreview: isPlacementInteractionMode(nextMode)
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
