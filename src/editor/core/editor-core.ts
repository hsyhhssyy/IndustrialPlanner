import {
  createExplicitLinkId,
  createWorldEntityId,
  getEntityLinks,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { Stage1EntityDefinition } from "@/domain/registry/stage1-registry";
import { applyWorldDocumentCommand } from "@/editor/core/commands/document-command-applier";
import type {
  AtomicDocumentCommand,
  DocumentCommand,
} from "@/editor/core/commands/document-command";
import type { EditorSession } from "@/editor/contracts/editor-session";
import type {
  DraftEntitiesState,
  DraftEntityState,
  DraftsState,
  EditorEntityCollectionState,
  SelectedEntitiesState,
} from "@/editor/contracts/entity-collection";
import {
  createMarqueeInteractionMode,
  createInspectInteractionMode,
  createLinkInteractionMode,
  createMoveInteractionMode,
  createPlacementInteractionMode,
  createSelectInteractionMode,
  getPendingLinkSourceEntityId,
  isMarqueeInteractionMode,
  isLinkInteractionMode,
  isMoveInteractionMode,
  isPlacementInteractionMode,
  resolveDefaultNextInteractionMode,
  resolveDisplayToolForMode,
  type InteractionModeKey,
  type PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import type { MoveDraftState } from "@/editor/contracts/move-draft";
import type { MarqueeDraftState } from "@/editor/contracts/marquee-draft";
import type { MarqueeRangeState } from "@/editor/contracts/marquee-range";
import {
  resolveMarqueeSelection,
  resolveNextSelection,
  type EditorSelectionUpdateMode,
} from "@/editor/contracts/selection";
import type {
  PlacementInteractionMode,
  PlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getRotatedGridFootprint,
  rotateGridRotationClockwise,
  type GridPoint,
  type GridRotation,
} from "@/shared/geometry/grid";

const PLACEMENT_PREVIEW_DRAFT_ID = "draft:placement-preview";

function createMoveDraftId(entityId: string): string {
  return `draft:move:${entityId}`;
}

function isManagedDraftId(id: string): boolean {
  return id === PLACEMENT_PREVIEW_DRAFT_ID || id.startsWith("draft:move:");
}

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

/**
 * Editor write kernel.
 *
 * Session-only editor actions and DocumentCommand application both converge
 * here; this is the current write truth for EditorSession and WorldDocument.
 */
export interface EditorCore {
  getSnapshot: () => EditorCoreSnapshot;
  setInteractionMode: (
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
  ) => void;
  armPlacement: (
    definitionId: string,
    displayTool?: PlacementDisplayTool,
    inputMode?: PlacementInteractionMode,
  ) => void;
  beginMove: (
    entityId: string,
    inputMode: PlacementInteractionMode,
    draft: MoveDraftState,
  ) => void;
  beginMarquee: (
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
    draft: MarqueeDraftState,
  ) => void;
  setPlacementRotation: (rotation: GridRotation | null) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  setMoveDraft: (draft: MoveDraftState | null) => void;
  setMarqueeDraft: (draft: MarqueeDraftState | null) => void;
  cancelMove: () => void;
  cancelMarquee: () => boolean;
  confirmMove: () => boolean;
  confirmMarqueeSelection: () => boolean;
  applyDocumentCommand: (command: DocumentCommand) => boolean;
  setSelection: (
    selection: readonly string[],
    inputMode?: PlacementInteractionMode | null,
  ) => void;
  selectEntity: (
    entityId: string | null,
    inputMode?: PlacementInteractionMode | null,
    selectionMode?: EditorSelectionUpdateMode,
  ) => void;
  rotateSelectedEntityClockwise: (position?: GridPoint) => boolean;
  setLinkSourceEntityId: (entityId: string | null) => void;
  placeEntity: (
    definitionId: string,
    position: GridPoint,
    rotation?: GridRotation,
  ) => void;
  moveEntity: (entityId: string, position: GridPoint) => boolean;
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
  getDefinition: (definitionId: string) => Stage1EntityDefinition | undefined;
}

class EditorCoreImpl implements EditorCore {
  private document: WorldDocument;
  private session: EditorSession;
  private undoStack: DocumentHistoryEntry[] = [];
  private redoStack: DocumentHistoryEntry[] = [];
  private historyState: EditorHistoryState;
  private readonly getDefinition: CreateEditorCoreOptions["getDefinition"];

  constructor(options: CreateEditorCoreOptions) {
    this.document = options.document;
    this.getDefinition = options.getDefinition;
    this.session = this.resolveSessionCollections(options.session);
    this.historyState = this.createHistoryState();
  }

  getSnapshot(): EditorCoreSnapshot {
    return {
      document: this.document,
      session: this.session,
      history: this.historyState,
    };
  }

  setInteractionMode(
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
  ): void {
    const context = {
      previousModeKey: this.session.currentMode.key,
      entryDisplayTool: this.session.displayTool,
    };

    switch (modeKey) {
      case "select":
        this.applyInteractionMode(createSelectInteractionMode(context), true, true);
        return;
      case "link":
        this.applyInteractionMode(createLinkInteractionMode(context), true, true);
        return;
      case "inspect":
        this.applyInteractionMode(createInspectInteractionMode(context), true, true);
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
      true,
    );
  }

  beginMove(
    entityId: string,
    inputMode: PlacementInteractionMode,
    draft: MoveDraftState,
  ): void {
    this.applyInteractionMode(
      createMoveInteractionMode({
        entityId,
        inputMode,
        previousModeKey: this.session.currentMode.key,
        entryDisplayTool: this.session.displayTool,
      }),
      true,
      false,
    );

    this.setSession({
      ...this.session,
      selection: draft.entities.map((entity) => entity.entityId),
      selectionInputMode: inputMode,
    });
    this.setMoveDraft(draft);
  }

  beginMarquee(
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
    draft: MarqueeDraftState,
  ): void {
    this.applyInteractionMode(
      createMarqueeInteractionMode({
        inputMode,
        selectionMode,
        previousModeKey: this.session.currentMode.key,
        entryDisplayTool: this.session.displayTool,
      }),
      true,
      true,
    );

    this.setMarqueeDraft(draft);
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
      false,
    );
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    this.setSession({
      ...this.session,
      placementPreview: preview,
    });
  }

  setMoveDraft(draft: MoveDraftState | null): void {
    this.setSession({
      ...this.session,
      moveDraft: draft,
    });
  }

  setMarqueeDraft(draft: MarqueeDraftState | null): void {
    this.setSession({
      ...this.session,
      marqueeDraft: draft,
    });
  }

  cancelMove(): void {
    if (!isMoveInteractionMode(this.session.currentMode)) {
      return;
    }

    this.applyInteractionMode(
      resolveDefaultNextInteractionMode(this.session.currentMode),
      true,
      true,
    );
  }

  cancelMarquee(): boolean {
    if (!isMarqueeInteractionMode(this.session.currentMode)) {
      return false;
    }

    this.applyInteractionMode(
      resolveDefaultNextInteractionMode(this.session.currentMode),
      true,
      true,
    );
    return true;
  }

  confirmMove(): boolean {
    if (!isMoveInteractionMode(this.session.currentMode) || !this.session.draftEntities) {
      return false;
    }

    const moveDraftEntities = this.session.draftEntities.ids
      .map((id) => this.session.drafts.entities[id])
      .filter(
        (draftEntity): draftEntity is DraftEntityState =>
          Boolean(draftEntity?.sourceEntityId),
      );

    if (
      moveDraftEntities.length === 0 ||
      moveDraftEntities.some(
        (draftEntity) =>
          !draftEntity.valid ||
          !draftEntity.sourceEntityId ||
          !this.document.entities[draftEntity.sourceEntityId],
      )
    ) {
      return false;
    }

    const commands: AtomicDocumentCommand[] = [];

    for (const draftEntity of moveDraftEntities) {
      const entity = draftEntity.sourceEntityId
        ? this.document.entities[draftEntity.sourceEntityId]
        : null;

      if (!entity) {
        continue;
      }

      const positionChanged =
        draftEntity.position.x !== entity.position.x ||
        draftEntity.position.y !== entity.position.y;
      const rotationChanged = draftEntity.rotation !== entity.rotation;

      if (rotationChanged) {
        commands.push({
          type: "entity.rotate",
          payload: {
            entityId: entity.id,
            position: positionChanged ? draftEntity.position : undefined,
            rotation: draftEntity.rotation,
          },
        });
      } else if (positionChanged) {
        commands.push({
          type: "entity.move",
          payload: {
            entityId: entity.id,
            position: draftEntity.position,
          },
        });
      }
    }

    if (commands.length > 0) {
      this.applyCommand({
        type: "batch",
        payload: {
          commands,
        },
      });
    }

    this.applyInteractionMode(
      resolveDefaultNextInteractionMode(this.session.currentMode),
      true,
      true,
    );
    return true;
  }

  confirmMarqueeSelection(): boolean {
    if (
      !isMarqueeInteractionMode(this.session.currentMode) ||
      !this.session.marqueeDraft
    ) {
      return false;
    }

    this.setSelection(
      this.session.draftEntities?.ids ?? [],
      this.session.currentMode.inputMode,
    );
    this.applyInteractionMode(
      resolveDefaultNextInteractionMode(this.session.currentMode),
      true,
      true,
    );
    return true;
  }

  applyDocumentCommand(command: DocumentCommand): boolean {
    return this.applyCommand(command);
  }

  setSelection(
    selection: readonly string[],
    inputMode: PlacementInteractionMode | null = null,
  ): void {
    const nextSelection: string[] = [];
    const seen = new Set<string>();

    for (const entityId of selection) {
      if (!this.document.entities[entityId] || seen.has(entityId)) {
        continue;
      }

      seen.add(entityId);
      nextSelection.push(entityId);
    }

    this.setSession({
      ...this.session,
      selection: nextSelection,
      selectionInputMode: nextSelection.length > 0 ? inputMode : null,
    });
  }

  selectEntity(
    entityId: string | null,
    inputMode: PlacementInteractionMode | null = entityId
      ? this.session.selectionInputMode
      : null,
    selectionMode: EditorSelectionUpdateMode = "replace",
  ): void {
    if (!entityId) {
      this.setSelection([], null);
      return;
    }

    const nextSelection = resolveNextSelection(
      this.session.selection,
      entityId,
      selectionMode,
    );

    this.setSelection(nextSelection, inputMode);
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

    this.setSession({
      ...this.session,
      selection: [entityId],
      selectionInputMode: placementMode?.inputMode ?? this.session.selectionInputMode,
    });
  }

  moveEntity(entityId: string, position: GridPoint): boolean {
    return this.applyCommand({
      type: "entity.move",
      payload: {
        entityId,
        position,
      },
    });
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
      this.setSession({
        ...this.session,
        selection: [targetEntityId],
        selectionInputMode: null,
      });
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
    this.setSession({
      ...this.session,
      selection: [],
      selectionInputMode: null,
    });
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
    clearMoveDraft: boolean,
  ): void {
    this.setSession({
      ...this.session,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
      placementPreview: clearPlacementPreview ? null : this.session.placementPreview,
      moveDraft: clearMoveDraft ? null : this.session.moveDraft,
      marqueeDraft: null,
    });
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
    const moveDraft =
      this.session.moveDraft &&
      this.document.entities[this.session.moveDraft.entityId] &&
      this.session.moveDraft.entities.every(
        (draftEntity) => Boolean(this.document.entities[draftEntity.entityId]),
      )
        ? this.session.moveDraft
        : null;
    const pendingLinkSourceEntityId =
      getPendingLinkSourceEntityId(this.session.currentMode) &&
      this.document.entities[getPendingLinkSourceEntityId(this.session.currentMode) ?? ""]
        ? getPendingLinkSourceEntityId(this.session.currentMode)
        : null;
    let nextMode = this.session.currentMode;

    if (isLinkInteractionMode(this.session.currentMode)) {
      nextMode = {
        ...this.session.currentMode,
        sourceEntityId: pendingLinkSourceEntityId,
      };
    }

    if (
      isMoveInteractionMode(nextMode) &&
      (!moveDraft || selection[0] !== nextMode.entityId)
    ) {
      nextMode = resolveDefaultNextInteractionMode(nextMode);
    }

    const marqueeDraft =
      this.session.marqueeDraft &&
      (nextMode.key === "select" || nextMode.key === "marquee")
        ? {
            ...this.session.marqueeDraft,
            entityIds: this.session.marqueeDraft.entityIds.filter((entityId) =>
              Boolean(this.document.entities[entityId]),
            ),
            baseSelection: this.session.marqueeDraft.baseSelection.filter((entityId) =>
              Boolean(this.document.entities[entityId]),
            ),
          }
        : null;

    if (isMarqueeInteractionMode(nextMode) && !marqueeDraft) {
      nextMode = resolveDefaultNextInteractionMode(nextMode);
    }

    this.setSession({
      ...this.session,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
      selection,
      selectionInputMode:
        selection.length > 0 ? this.session.selectionInputMode : null,
      hoveredEntityId,
      placementPreview: isPlacementInteractionMode(nextMode)
        ? this.session.placementPreview
        : null,
      moveDraft: isMoveInteractionMode(nextMode) ? moveDraft : null,
      marqueeDraft:
        nextMode.key === "select" || nextMode.key === "marquee"
          ? marqueeDraft
          : null,
    });
  }

  private setSession(nextSession: EditorSession): void {
    this.session = this.resolveSessionCollections(nextSession);
  }

  private resolveSessionCollections(session: EditorSession): EditorSession {
    const drafts = this.buildDraftsState(session);

    return {
      ...session,
      drafts,
      selectedEntities: this.buildSelectedEntities(session, drafts),
      draftEntities: this.buildDraftEntities(session, drafts),
      marqueeRange: this.buildMarqueeRange(session.marqueeDraft),
    };
  }

  private buildDraftsState(session: EditorSession): DraftsState {
    const nextEntities: Record<string, DraftEntityState> = Object.fromEntries(
      Object.entries(session.drafts.entities).filter(([id]) => !isManagedDraftId(id)),
    );

    if (session.placementPreview) {
      nextEntities[PLACEMENT_PREVIEW_DRAFT_ID] = {
        id: PLACEMENT_PREVIEW_DRAFT_ID,
        definitionId: session.placementPreview.definitionId,
        position: {
          ...session.placementPreview.gridPoint,
        },
        rotation: session.placementPreview.rotation,
        config: {},
        tags: [],
        sourceEntityId: null,
        valid: session.placementPreview.valid,
        invalidReason: session.placementPreview.valid
          ? null
          : "placement-preview-invalid",
      };
    }

    if (session.moveDraft) {
      for (const draftEntity of session.moveDraft.entities) {
        const sourceEntity = this.document.entities[draftEntity.entityId];

        if (!sourceEntity) {
          continue;
        }

        nextEntities[createMoveDraftId(draftEntity.entityId)] = {
          ...sourceEntity,
          id: createMoveDraftId(draftEntity.entityId),
          position: {
            ...draftEntity.gridPoint,
          },
          rotation: draftEntity.rotation,
          config: {
            ...sourceEntity.config,
          },
          tags: [...sourceEntity.tags],
          sourceEntityId: sourceEntity.id,
          valid: session.moveDraft.valid,
          invalidReason: session.moveDraft.valid ? null : "move-draft-invalid",
        };
      }
    }

    return {
      entities: nextEntities,
    };
  }

  private buildSelectedEntities(
    session: EditorSession,
    drafts: DraftsState,
  ): SelectedEntitiesState | null {
    return this.buildEntityCollection(session.selection, drafts);
  }

  private buildDraftEntities(
    session: EditorSession,
    drafts: DraftsState,
  ): DraftEntitiesState | null {
    if (session.moveDraft) {
      return this.buildEntityCollection(
        session.moveDraft.entities.map((entity) => createMoveDraftId(entity.entityId)),
        drafts,
      );
    }

    if (session.placementPreview) {
      return this.buildEntityCollection([PLACEMENT_PREVIEW_DRAFT_ID], drafts);
    }

    if (session.marqueeDraft) {
      return this.buildEntityCollection(
        resolveMarqueeSelection(
          session.marqueeDraft.baseSelection,
          session.marqueeDraft.entityIds,
          session.marqueeDraft.selectionMode,
        ),
        drafts,
      );
    }

    return null;
  }

  private buildMarqueeRange(
    draft: MarqueeDraftState | null,
  ): MarqueeRangeState | null {
    if (!draft) {
      return null;
    }

    return {
      selectionMode: draft.selectionMode,
      originGridPoint: {
        ...draft.originGridPoint,
      },
      gridPoint: {
        ...draft.gridPoint,
      },
      bounds: {
        ...draft.bounds,
      },
    };
  }

  private buildEntityCollection(
    ids: readonly string[],
    drafts: DraftsState,
  ): EditorEntityCollectionState | null {
    const uniqueIds: string[] = [];
    const areas: Array<{
      position: GridPoint;
      footprint: Stage1EntityDefinition["footprint"];
    }> = [];
    const seen = new Set<string>();

    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }

      const entity = drafts.entities[id] ?? this.document.entities[id];

      if (!entity) {
        continue;
      }

      const definition = this.getDefinition(entity.definitionId);

      if (!definition) {
        continue;
      }

      seen.add(id);
      uniqueIds.push(id);
      areas.push({
        position: entity.position,
        footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
      });
    }

    if (areas.length === 0) {
      return null;
    }

    const bounds = getGridBoundingBox(areas);

    return {
      ids: uniqueIds,
      boundsDerived: bounds,
      geometricCenterCellsDerived: bounds ? getGridBoundsCenterCells(bounds) : null,
    };
  }
}

export function createEditorCore(
  options: CreateEditorCoreOptions,
): EditorCore {
  return new EditorCoreImpl(options);
}
