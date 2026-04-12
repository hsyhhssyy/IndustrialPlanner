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
import {
  PLACEMENT_PREVIEW_DRAFT_ID,
  createMoveDraftId,
  getManagedMarqueeDraft,
  getManagedMoveDraft,
  getSelectedEntityIds,
  isManagedDraftId,
} from "@/editor/contracts/editor-session-helpers";
import {
  cloneDraftsState,
} from "@/editor/contracts/entity-collection";
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

function buildMoveDraftEntityCenterCells(
  draft: MoveDraftState,
): Record<string, { x: number; y: number }> {
  return Object.fromEntries(
    draft.entities
      .filter(
        (
          entity,
        ): entity is typeof entity & {
          centerCells: {
            x: number;
            y: number;
          };
        } => Boolean(entity.centerCells),
      )
      .map((entity) => [
        entity.entityId,
        {
          ...entity.centerCells,
        },
      ]),
  );
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
        anchorWorldOffset: draft.anchorWorldOffset,
        rotationCenterCells: draft.rotationCenterCells ?? null,
        draftEntityCenterCells: buildMoveDraftEntityCenterCells(draft),
        previousModeKey: this.session.currentMode.key,
        entryDisplayTool: this.session.displayTool,
      }),
      true,
      false,
    );

    this.setSelection(
      draft.entities.map((entity) => entity.entityId),
      inputMode,
    );
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
    this.setSession(this.patchPlacementPreview(this.session, preview));
  }

  setMoveDraft(draft: MoveDraftState | null): void {
    this.setSession(this.patchMoveDraft(this.session, draft));
  }

  setMarqueeDraft(draft: MarqueeDraftState | null): void {
    this.setSession(this.patchMarqueeDraft(this.session, draft));
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
      !this.session.marqueeRange
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
    this.setSession(this.patchSelectedEntities(this.session, selection, inputMode));
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
      getSelectedEntityIds(this.session),
      entityId,
      selectionMode,
    );

    this.setSelection(nextSelection, inputMode);
  }

  rotateSelectedEntityClockwise(position?: GridPoint): boolean {
    const selectedEntityId = getSelectedEntityIds(this.session)[0];

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

    this.setSelection(
      [entityId],
      placementMode?.inputMode ?? this.session.selectionInputMode,
    );
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
      this.setSelection([targetEntityId], null);
      this.setLinkSourceEntityId(null);
    }
  }

  removeLink(linkId: string): void {
    if (this.applyCommand({ type: "link.remove", payload: { linkId } })) {
      this.setLinkSourceEntityId(null);
    }
  }

  removeSelectedEntities(): void {
    const selectedIds = [...getSelectedEntityIds(this.session)];

    selectedIds.forEach((entityId) => {
      this.applyCommand({
        type: "entity.remove",
        payload: { entityId },
      });
    });

    this.sanitizeSession();
    this.setSelection([], null);
    this.setLinkSourceEntityId(null);
  }

  removeSelectedLinks(): void {
    const linkIds = Array.from(
      new Set(
        getSelectedEntityIds(this.session).flatMap((entityId) =>
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
    let nextSession: EditorSession = {
      ...this.session,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
    };

    if (clearPlacementPreview) {
      nextSession = this.patchPlacementPreview(nextSession, null);
    }

    if (clearMoveDraft) {
      nextSession = this.patchMoveDraft(nextSession, null);
    }

    nextSession = this.patchMarqueeDraft(nextSession, null);
    this.setSession(nextSession);
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
    const selection = getSelectedEntityIds(this.session).filter((entityId) =>
      Boolean(this.document.entities[entityId]),
    );
    const hoveredEntityId =
      this.session.hoveredEntityId &&
      this.document.entities[this.session.hoveredEntityId]
        ? this.session.hoveredEntityId
        : null;
    const pendingLinkSourceEntityId =
      getPendingLinkSourceEntityId(this.session.currentMode) &&
      this.document.entities[getPendingLinkSourceEntityId(this.session.currentMode) ?? ""]
        ? getPendingLinkSourceEntityId(this.session.currentMode)
        : null;
    let nextMode = this.session.currentMode;
    let nextSession = this.patchSelectedEntities(
      this.session,
      selection,
      selection.length > 0 ? this.session.selectionInputMode : null,
    );

    nextSession = {
      ...nextSession,
      hoveredEntityId,
    };

    if (isLinkInteractionMode(this.session.currentMode)) {
      nextMode = {
        ...this.session.currentMode,
        sourceEntityId: pendingLinkSourceEntityId,
      };
    }

    nextSession = {
      ...nextSession,
      currentMode: nextMode,
      displayTool: resolveDisplayToolForMode(nextMode),
    };

    const moveDraft = getManagedMoveDraft(nextSession, this.document);

    if (
      isMoveInteractionMode(nextMode) &&
      (!moveDraft || !selection.includes(nextMode.entityId))
    ) {
      nextMode = resolveDefaultNextInteractionMode(nextMode);
      nextSession = {
        ...nextSession,
        currentMode: nextMode,
        displayTool: resolveDisplayToolForMode(nextMode),
      };
    }

    if (!isMoveInteractionMode(nextMode)) {
      nextSession = this.patchMoveDraft(nextSession, null);
    }

    if (!isPlacementInteractionMode(nextMode)) {
      nextSession = this.patchPlacementPreview(nextSession, null);
    }

    if (isMarqueeInteractionMode(nextMode) && !getManagedMarqueeDraft(nextSession)) {
      nextMode = resolveDefaultNextInteractionMode(nextMode);
      nextSession = {
        ...nextSession,
        currentMode: nextMode,
        displayTool: resolveDisplayToolForMode(nextMode),
      };
    }

    if (!isMarqueeInteractionMode(nextMode)) {
      nextSession = this.patchMarqueeDraft(nextSession, null);
    }

    this.setSession(nextSession);
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
      marqueeRange: this.buildMarqueeRange(session.marqueeRange),
    };
  }

  private buildDraftsState(session: EditorSession): DraftsState {
    return cloneDraftsState(session.drafts);
  }

  private buildSelectedEntities(
    session: EditorSession,
    drafts: DraftsState,
  ): SelectedEntitiesState | null {
    return this.buildEntityCollection(getSelectedEntityIds(session), drafts);
  }

  private buildDraftEntities(
    session: EditorSession,
    drafts: DraftsState,
  ): DraftEntitiesState | null {
    return this.buildEntityCollection(session.draftEntities?.ids ?? [], drafts);
  }

  private buildMarqueeRange(
    range: MarqueeRangeState | null,
  ): MarqueeRangeState | null {
    if (!range) {
      return null;
    }

    return {
      selectionMode: range.selectionMode,
      originGridPoint: {
        ...range.originGridPoint,
      },
      gridPoint: {
        ...range.gridPoint,
      },
      bounds: {
        ...range.bounds,
      },
    };
  }

  private patchSelectedEntities(
    session: EditorSession,
    selection: readonly string[],
    inputMode: PlacementInteractionMode | null,
  ): EditorSession {
    const nextSelection: string[] = [];
    const seen = new Set<string>();

    for (const entityId of selection) {
      if (!this.document.entities[entityId] || seen.has(entityId)) {
        continue;
      }

      seen.add(entityId);
      nextSelection.push(entityId);
    }

    return {
      ...session,
      selectedEntities: this.buildEntityCollection(nextSelection, session.drafts),
      selectionInputMode: nextSelection.length > 0 ? inputMode : null,
    };
  }

  private patchPlacementPreview(
    session: EditorSession,
    preview: PlacementPreviewState | null,
  ): EditorSession {
    const nextDrafts = cloneDraftsState(session.drafts);
    delete nextDrafts.entities[PLACEMENT_PREVIEW_DRAFT_ID];

    if (preview) {
      nextDrafts.entities[PLACEMENT_PREVIEW_DRAFT_ID] = {
        id: PLACEMENT_PREVIEW_DRAFT_ID,
        definitionId: preview.definitionId,
        position: {
          ...preview.gridPoint,
        },
        rotation: preview.rotation,
        config: {},
        tags: [],
        sourceEntityId: null,
        valid: preview.valid,
        invalidReason: preview.valid ? null : "placement-preview-invalid",
      };
    }

    const nextDraftEntityIds = preview
      ? [PLACEMENT_PREVIEW_DRAFT_ID]
      : (session.draftEntities?.ids ?? []).filter(
          (id) => id !== PLACEMENT_PREVIEW_DRAFT_ID,
        );

    return {
      ...session,
      drafts: nextDrafts,
      draftEntities: this.buildEntityCollection(nextDraftEntityIds, nextDrafts),
    };
  }

  private patchMoveDraft(
    session: EditorSession,
    draft: MoveDraftState | null,
  ): EditorSession {
    const nextDrafts = cloneDraftsState(session.drafts);

    for (const id of Object.keys(nextDrafts.entities)) {
      if (id.startsWith("draft:move:")) {
        delete nextDrafts.entities[id];
      }
    }

    if (draft) {
      for (const draftEntity of draft.entities) {
        const sourceEntity = this.document.entities[draftEntity.entityId];

        if (!sourceEntity) {
          continue;
        }

        nextDrafts.entities[createMoveDraftId(draftEntity.entityId)] = {
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
          valid: draft.valid,
          invalidReason: draft.valid ? null : "move-draft-invalid",
        };
      }
    }

    const nextDraftEntityIds = draft
      ? draft.entities.map((entity) => createMoveDraftId(entity.entityId))
      : (session.draftEntities?.ids ?? []).filter(
          (id) => !id.startsWith("draft:move:"),
        );

    return {
      ...session,
      currentMode:
        draft && isMoveInteractionMode(session.currentMode)
          ? {
              ...session.currentMode,
              entityId: draft.entityId,
              inputMode: draft.interactionMode,
              anchorWorldOffset: {
                ...draft.anchorWorldOffset,
              },
              rotationCenterCells: draft.rotationCenterCells
                ? {
                    ...draft.rotationCenterCells,
                  }
                : null,
              draftEntityCenterCells: buildMoveDraftEntityCenterCells(draft),
            }
          : session.currentMode,
      drafts: nextDrafts,
      draftEntities: this.buildEntityCollection(nextDraftEntityIds, nextDrafts),
    };
  }

  private patchMarqueeDraft(
    session: EditorSession,
    draft: MarqueeDraftState | null,
  ): EditorSession {
    const nextDraftEntityIds = draft
      ? resolveMarqueeSelection(
          draft.baseSelection,
          draft.entityIds,
          draft.selectionMode,
        )
      : (session.draftEntities?.ids ?? []).filter((id) => isManagedDraftId(id));

    return {
      ...session,
      draftEntities: this.buildEntityCollection(nextDraftEntityIds, session.drafts),
      marqueeRange: draft
        ? {
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
          }
        : null,
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
