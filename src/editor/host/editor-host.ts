import {
  createEditorCore,
  type EditorCore,
  type EditorHistoryState,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  getPendingLinkSourceEntityId,
  isLinkInteractionMode,
  isMoveInteractionMode,
  isPlacementInteractionMode,
  type InteractionModeKey,
  type PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import {
  isSameMoveDraftState,
  type MoveDraftState,
} from "@/editor/contracts/move-draft";
import {
  isSamePlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import type {
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import {
  getExplicitLinkBetween,
} from "@/domain/document/world-document";
import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { Stage1EntityDefinition } from "@/domain/registry/stage1-registry";
import {
  getStage1BaseDefinition,
  isStage1FootprintWithinBase,
} from "@/domain/base/stage1-bases";
import {
  getRotatedGridFootprint,
  resolveCenteredGridPoint,
  resolveCenteredRotatedGridPoint,
  rotateGridRotationClockwise,
  type GridPoint,
  type GridRotation,
} from "@/shared/geometry/grid";
import { createLogger } from "@/shared/logging/logger";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import type { CanvasPoint } from "@/workbench/workspace-state";

export interface EditorInteractionTarget {
  kind: "blank";
}

export interface EditorEntityInteractionTarget {
  kind: "entity";
  entityId: string;
  selected: boolean;
}

export type EditorWorldInteractionTarget =
  | EditorInteractionTarget
  | EditorEntityInteractionTarget;

export interface CanvasWorldInput {
  worldPoint: CanvasPoint;
  gridPoint: GridPoint;
}

export interface PlacementPreviewUpdateResult {
  preview: PlacementPreviewState | null;
  invalidReason: PlacementPreviewInvalidReason | null;
  hitEntityId: string | null;
  overlappingEntityIds: string[];
  changed: boolean;
}

export interface PlacementQueryResult {
  preview: PlacementPreviewState | null;
  invalidReason: PlacementPreviewInvalidReason | null;
  hitEntityId: string | null;
  overlappingEntityIds: string[];
}

export interface MoveDraftUpdateResult {
  draft: MoveDraftState | null;
  invalidReason: MoveDraftInvalidReason | null;
  overlappingEntityIds: string[];
  changed: boolean;
}

export interface MoveQueryResult {
  draft: MoveDraftState | null;
  invalidReason: MoveDraftInvalidReason | null;
  overlappingEntityIds: string[];
}

function hitTestWorldEntity(
  document: WorldDocument,
  topology: CompiledTopology,
  worldPoint: CanvasPoint,
): string | null {
  const { gridSize } = document.documentSettings;

  for (let index = document.entityOrder.length - 1; index >= 0; index -= 1) {
    const entityId = document.entityOrder[index];

    if (!entityId) {
      continue;
    }

    const entity = document.entities[entityId];
    const definition = topology.entityViews[entityId]?.definition;

    if (!entity || !definition) {
      continue;
    }

    const footprint = getRotatedGridFootprint(
      definition.footprint,
      entity.rotation,
    );

    const x = entity.position.x * gridSize;
    const y = entity.position.y * gridSize;
    const width = footprint.width * gridSize;
    const height = footprint.height * gridSize;

    if (
      worldPoint.x >= x &&
      worldPoint.x <= x + width &&
      worldPoint.y >= y &&
      worldPoint.y <= y + height
    ) {
      return entityId;
    }
  }

  return null;
}

function resolveCenteredPlacementGridPoint(options: {
  worldPoint: CanvasPoint;
  gridSize: number;
  footprint: {
    width: number;
    height: number;
  };
}) {
  const centerXCells = options.worldPoint.x / options.gridSize;
  const centerYCells = options.worldPoint.y / options.gridSize;

  return resolveCenteredGridPoint(
    {
      x: centerXCells,
      y: centerYCells,
    },
    options.footprint,
  );
}

/**
 * Semantic editor facade.
 *
 * This layer owns editor-side queries and typed editor actions. Those actions
 * may stay session-only, or continue into EditorCore document mutations.
 */
export interface EditorHost {
  getSnapshot: () => EditorCoreSnapshot;
  getDocument: () => WorldDocument;
  getState: () => {
    session: EditorSession;
    history: EditorHistoryState;
  };
  queryInteractionTarget: (
    worldPoint: CanvasPoint,
  ) => EditorWorldInteractionTarget;
  setInteractionMode: (
    modeKey: Exclude<InteractionModeKey, "placement" | "move">,
  ) => void;
  armPlacement: (
    definitionId: string,
    displayTool?: PlacementDisplayTool,
    inputMode?: PlacementInteractionMode,
  ) => void;
  beginMove: (
    entityId: string,
    inputMode: PlacementInteractionMode,
    input: CanvasWorldInput,
  ) => boolean;
  rotatePlacementClockwise: () => boolean;
  queryPlacementAtWorldInput: (input: CanvasWorldInput) => PlacementQueryResult;
  queryPlacementPreview: (
    preview: PlacementPreviewState,
  ) => PlacementQueryResult;
  updatePlacementPreview: (input: CanvasWorldInput) => PlacementPreviewUpdateResult;
  confirmPlacement: () => boolean;
  commitPlacement: (input: CanvasWorldInput) => boolean;
  clearPlacementPreview: () => void;
  queryMoveDraftAtWorldInput: (input: CanvasWorldInput) => MoveQueryResult;
  updateMoveDraft: (input: CanvasWorldInput) => MoveDraftUpdateResult;
  confirmMove: () => boolean;
  cancelMove: () => boolean;
  activateLinkTarget: (entityId: string | null) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  selectEntity: (
    entityId: string | null,
    inputMode?: PlacementInteractionMode | null,
  ) => void;
  rotateSelectedEntityClockwise: () => boolean;
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

interface CreateEditorHostOptions {
  document: WorldDocument;
  session: EditorSession;
  getTopology: () => CompiledTopology;
  getDefinition: (definitionId: string) => Stage1EntityDefinition | undefined;
  core?: EditorCore;
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

type PlacementPreviewInvalidReason =
  | "inactive-tool"
  | "missing-definition"
  | "entity-collision"
  | "out-of-base";

type MoveDraftInvalidReason =
  | "inactive-move"
  | "missing-entity"
  | "out-of-base";

interface PlacementCandidateEvaluation {
  invalidReason: PlacementPreviewInvalidReason | null;
  overlappingEntityIds: string[];
}

interface MoveCandidateEvaluation {
  invalidReason: MoveDraftInvalidReason | null;
  overlappingEntityIds: string[];
}

class EditorHostImpl implements EditorHost {
  private readonly core: EditorCore;
  private readonly getTopology: () => CompiledTopology;
  private readonly getDefinition: (definitionId: string) => Stage1EntityDefinition | undefined;
  private readonly placementPreviewProfiler?: PlacementPreviewProfiler;
  private readonly logger = createLogger("editor.host");

  constructor(options: CreateEditorHostOptions) {
    this.getTopology = options.getTopology;
    this.getDefinition = options.getDefinition;
    this.placementPreviewProfiler = options.placementPreviewProfiler;
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

  getDocument(): WorldDocument {
    return this.core.getSnapshot().document;
  }

  getState(): { session: EditorSession; history: EditorHistoryState } {
    const snapshot = this.core.getSnapshot();

    return {
      session: snapshot.session,
      history: snapshot.history,
    };
  }

  private getPlacementMode(session: EditorSession = this.core.getSnapshot().session) {
    return isPlacementInteractionMode(session.currentMode)
      ? session.currentMode
      : null;
  }

  private getLinkMode(session: EditorSession = this.core.getSnapshot().session) {
    return isLinkInteractionMode(session.currentMode)
      ? session.currentMode
      : null;
  }

  private getMoveMode(session: EditorSession = this.core.getSnapshot().session) {
    return isMoveInteractionMode(session.currentMode)
      ? session.currentMode
      : null;
  }

  queryInteractionTarget(worldPoint: CanvasPoint): EditorWorldInteractionTarget {
    const snapshot = this.core.getSnapshot();
    const hitEntityId = hitTestWorldEntity(
      snapshot.document,
      this.getTopology(),
      worldPoint,
    );

    if (!hitEntityId) {
      return {
        kind: "blank",
      };
    }

    return {
      kind: "entity",
      entityId: hitEntityId,
      selected: snapshot.session.selection.includes(hitEntityId),
    };
  }

  setInteractionMode(
    modeKey: Exclude<InteractionModeKey, "placement" | "move">,
  ): void {
    this.core.setInteractionMode(modeKey);
  }

  armPlacement(
    definitionId: string,
    displayTool?: PlacementDisplayTool,
    inputMode?: PlacementInteractionMode,
  ): void {
    this.core.armPlacement(definitionId, displayTool, inputMode);
    this.logger.info("Armed placement definition.", {
      definitionId,
      displayTool: displayTool ?? "place",
      inputMode: inputMode ?? "pointer",
    });
  }

  beginMove(
    entityId: string,
    inputMode: PlacementInteractionMode,
    input: CanvasWorldInput,
  ): boolean {
    const { document, session } = this.core.getSnapshot();

    if (
      session.currentMode.key !== "select" ||
      session.selection.length !== 1 ||
      session.selection[0] !== entityId
    ) {
      return false;
    }

    const entity = document.entities[entityId];

    if (!entity) {
      return false;
    }

    const draft: MoveDraftState = {
      entityId,
      interactionMode: inputMode,
      originGridPoint: entity.position,
      gridPoint: entity.position,
      rotation: entity.rotation,
      valid: true,
      anchorWorldOffset: {
        x: input.worldPoint.x - entity.position.x * document.documentSettings.gridSize,
        y: input.worldPoint.y - entity.position.y * document.documentSettings.gridSize,
      },
    };

    this.core.beginMove(entityId, inputMode, draft);
    this.logger.info("Began move draft.", {
      entityId,
      inputMode,
      originGridPoint: entity.position,
      anchorWorldOffset: draft.anchorWorldOffset,
    });
    return true;
  }

  rotatePlacementClockwise(): boolean {
    const { session } = this.core.getSnapshot();
    const placementMode = this.getPlacementMode(session);

    if (!placementMode) {
      return false;
    }

    const definition = this.getDefinition(placementMode.definitionId);

    if (!definition) {
      return false;
    }

    const currentRotation = placementMode.rotation;
    const nextRotation = rotateGridRotationClockwise(currentRotation);
    this.core.setPlacementRotation(nextRotation);

    if (!session.placementPreview) {
      this.logger.info("Rotated armed placement before preview existed.", {
        definitionId: placementMode.definitionId,
        previousRotation: currentRotation,
        nextRotation,
      });
      return true;
    }

    const currentFootprint = getRotatedGridFootprint(
      definition.footprint,
      session.placementPreview.rotation,
    );
    const nextFootprint = getRotatedGridFootprint(
      definition.footprint,
      nextRotation,
    );
    const rotatedPreview = {
      ...session.placementPreview,
      rotation: nextRotation,
      gridPoint: resolveCenteredRotatedGridPoint({
        gridPoint: session.placementPreview.gridPoint,
        currentFootprint,
        nextFootprint,
      }),
    } satisfies PlacementPreviewState;
    const resolution = this.queryPlacementPreview(rotatedPreview);

    if (
      !isSamePlacementPreviewState(
        session.placementPreview,
        resolution.preview,
      )
    ) {
      this.core.setPlacementPreview(resolution.preview);
    }

    this.logger.info("Rotated armed placement preview.", {
      definitionId: placementMode.definitionId,
      previousRotation: currentRotation,
      nextRotation,
      previousGridPoint: session.placementPreview.gridPoint,
      nextGridPoint: resolution.preview?.gridPoint ?? null,
      invalidReason: resolution.invalidReason,
    });
    return true;
  }

  updatePlacementPreview(input: CanvasWorldInput): PlacementPreviewUpdateResult {
    return this.measureProfilerStage("editor.total", () => {
      const previousPreview = this.core.getSnapshot().session.placementPreview;
      const resolution = this.queryPlacementAtWorldInput(input);
      const changed = !isSamePlacementPreviewState(previousPreview, resolution.preview);

      if (changed) {
        this.measureProfilerStage("editor.writeSession", () => {
          this.core.setPlacementPreview(resolution.preview);
        });
      }

      if (changed) {
        this.logger.debug("Updated placement preview.", {
          worldPoint: input.worldPoint,
          gridPoint: input.gridPoint,
          preview: resolution.preview,
          invalidReason: resolution.invalidReason,
          hitEntityId: resolution.hitEntityId,
        });
      }

      return {
        preview: resolution.preview,
        invalidReason: resolution.invalidReason,
        hitEntityId: resolution.hitEntityId,
        overlappingEntityIds: [...resolution.overlappingEntityIds],
        changed,
      };
    });
  }

  queryPlacementAtWorldInput(input: CanvasWorldInput): PlacementQueryResult {
    return this.measureProfilerStage("editor.resolvePlacementPreview", () => {
      const { document, session } = this.core.getSnapshot();
      const placementMode = this.getPlacementMode(session);

      if (!placementMode) {
        return {
          preview: null,
          invalidReason: "inactive-tool",
          hitEntityId: null,
          overlappingEntityIds: [],
        };
      }

      const definition = this.getDefinition(placementMode.definitionId);

      if (!definition) {
        return {
          preview: null,
          invalidReason: "missing-definition",
          hitEntityId: null,
          overlappingEntityIds: [],
        };
      }

      const preview = this.createPlacementPreviewFromWorldInput(
        document,
        session,
        definition,
        input,
      );
      const hitEntityId = this.measureProfilerStage("editor.hitTest", () =>
        hitTestWorldEntity(document, this.getTopology(), input.worldPoint),
      );
      const evaluation = this.evaluatePlacementPreview(preview, definition);

      return {
        preview: {
          ...preview,
          valid: evaluation.invalidReason === null,
        },
        invalidReason: evaluation.invalidReason,
        hitEntityId,
        overlappingEntityIds: evaluation.overlappingEntityIds,
      };
    });
  }

  queryPlacementPreview(preview: PlacementPreviewState): PlacementQueryResult {
    const { session } = this.core.getSnapshot();
    const placementMode = this.getPlacementMode(session);

    if (
      !placementMode ||
      preview.definitionId !== placementMode.definitionId
    ) {
      return {
        preview: null,
        invalidReason: "inactive-tool",
        hitEntityId: null,
        overlappingEntityIds: [],
      };
    }

    const definition = this.getDefinition(preview.definitionId);

    if (!definition) {
      return {
        preview: null,
        invalidReason: "missing-definition",
        hitEntityId: null,
        overlappingEntityIds: [],
      };
    }

    const evaluation = this.evaluatePlacementPreview(preview, definition);

    return {
      preview: {
        ...preview,
        valid: evaluation.invalidReason === null,
      },
      invalidReason: evaluation.invalidReason,
      hitEntityId: null,
      overlappingEntityIds: evaluation.overlappingEntityIds,
    };
  }

  confirmPlacement(): boolean {
    const { session } = this.core.getSnapshot();
    const preview = session.placementPreview;
    const placementMode = this.getPlacementMode(session);

    if (
      !placementMode ||
      !preview ||
      preview.definitionId !== placementMode.definitionId
    ) {
      this.logger.info("Skipped placement confirmation.", {
        currentMode: session.currentMode,
        displayTool: session.displayTool,
        preview,
      });
      return false;
    }

    const resolution = this.queryPlacementPreview(preview);

    if (resolution.preview && !isSamePlacementPreviewState(preview, resolution.preview)) {
      this.core.setPlacementPreview(resolution.preview);
    }

    if (!resolution.preview?.valid) {
      this.logger.info("Blocked placement confirmation.", {
        definitionId: placementMode.definitionId,
        preview,
        invalidReason: resolution.invalidReason,
        overlappingEntityIds: resolution.overlappingEntityIds,
      });
      return false;
    }

      this.logger.info("Confirmed placement from preview.", {
        definitionId: placementMode.definitionId,
      gridPoint: resolution.preview.gridPoint,
      rotation: resolution.preview.rotation,
      interactionMode: resolution.preview.interactionMode,
      overlappingEntityIds: resolution.overlappingEntityIds,
    });
    this.core.placeEntity(
        placementMode.definitionId,
      resolution.preview.gridPoint,
      resolution.preview.rotation,
    );
    return true;
  }

  commitPlacement(input: CanvasWorldInput): boolean {
    const { session } = this.core.getSnapshot();
    const placementMode = this.getPlacementMode(session);

    if (
      !placementMode ||
      placementMode.inputMode !== "pointer"
    ) {
      this.logger.info("Skipped pointer placement commit before preview resolution.", {
        currentMode: session.currentMode,
        displayTool: session.displayTool,
      });
      return false;
    }

    const resolution = this.queryPlacementAtWorldInput(input);
    const preview = resolution.preview;

    if (!preview?.valid) {
      this.core.setLinkSourceEntityId(null);
    this.logger.info("Blocked pointer placement commit.", {
        definitionId: placementMode.definitionId,
        worldPoint: input.worldPoint,
        gridPoint: input.gridPoint,
        preview,
        invalidReason: resolution.invalidReason,
        hitEntityId: resolution.hitEntityId,
        overlappingEntityIds: resolution.overlappingEntityIds,
      });
      return false;
    }

    this.logger.info("Committed pointer placement.", {
      definitionId: placementMode.definitionId,
      worldPoint: input.worldPoint,
      gridPoint: input.gridPoint,
      preview,
      overlappingEntityIds: resolution.overlappingEntityIds,
    });
    this.core.placeEntity(
      placementMode.definitionId,
      preview.gridPoint,
      preview.rotation,
    );
    return true;
  }

  clearPlacementPreview(): void {
    this.core.setPlacementPreview(null);
  }

  queryMoveDraftAtWorldInput(input: CanvasWorldInput): MoveQueryResult {
    const { document, session } = this.core.getSnapshot();
    const moveMode = this.getMoveMode(session);
    const moveDraft = session.moveDraft;

    if (!moveMode || !moveDraft) {
      return {
        draft: null,
        invalidReason: "inactive-move",
        overlappingEntityIds: [],
      };
    }

    const entity = document.entities[moveMode.entityId];

    if (!entity) {
      return {
        draft: null,
        invalidReason: "missing-entity",
        overlappingEntityIds: [],
      };
    }

    const definition =
      this.getTopology().entityViews[entity.id]?.definition ??
      this.getDefinition(entity.definitionId);

    if (!definition) {
      return {
        draft: null,
        invalidReason: "missing-entity",
        overlappingEntityIds: [],
      };
    }

    const draft = this.createMoveDraftFromWorldInput(document, moveDraft, input);
    const evaluation = this.evaluateMoveDraft(draft, definition);

    return {
      draft: {
        ...draft,
        valid: evaluation.invalidReason === null,
      },
      invalidReason: evaluation.invalidReason,
      overlappingEntityIds: evaluation.overlappingEntityIds,
    };
  }

  updateMoveDraft(input: CanvasWorldInput): MoveDraftUpdateResult {
    const previousDraft = this.core.getSnapshot().session.moveDraft;
    const resolution = this.queryMoveDraftAtWorldInput(input);
    const changed = !isSameMoveDraftState(previousDraft, resolution.draft);

    if (changed) {
      this.core.setMoveDraft(resolution.draft);
      this.logger.debug("Updated move draft.", {
        worldPoint: input.worldPoint,
        gridPoint: input.gridPoint,
        draft: resolution.draft,
        invalidReason: resolution.invalidReason,
      });
    }

    return {
      draft: resolution.draft,
      invalidReason: resolution.invalidReason,
      overlappingEntityIds: [...resolution.overlappingEntityIds],
      changed,
    };
  }

  confirmMove(): boolean {
    const { document, session } = this.core.getSnapshot();
    const moveDraft = session.moveDraft;
    const moveMode = this.getMoveMode(session);

    if (!moveDraft || !moveMode) {
      return false;
    }

    const entity = document.entities[moveMode.entityId];

    if (!entity) {
      return false;
    }

    const definition =
      this.getTopology().entityViews[entity.id]?.definition ??
      this.getDefinition(entity.definitionId);

    if (!definition) {
      return false;
    }

    const evaluation = this.evaluateMoveDraft(moveDraft, definition);
    const resolvedDraft = {
      ...moveDraft,
      valid: evaluation.invalidReason === null,
    } satisfies MoveDraftState;

    if (!isSameMoveDraftState(moveDraft, resolvedDraft)) {
      this.core.setMoveDraft(resolvedDraft);
    }

    if (!resolvedDraft.valid) {
      this.logger.info("Blocked move confirmation.", {
        draft: moveDraft,
        invalidReason: evaluation.invalidReason,
        overlappingEntityIds: evaluation.overlappingEntityIds,
      });
      return false;
    }

    const didConfirm = this.core.confirmMove();

    if (didConfirm) {
      this.logger.info("Confirmed move draft.", {
        entityId: moveDraft.entityId,
        originGridPoint: moveDraft.originGridPoint,
        nextGridPoint: resolvedDraft.gridPoint,
        interactionMode: moveDraft.interactionMode,
      });
    }

    return didConfirm;
  }

  cancelMove(): boolean {
    const { session } = this.core.getSnapshot();
    const moveDraft = session.moveDraft;
    const moveMode = this.getMoveMode(session);

    if (!moveDraft || !moveMode) {
      return false;
    }

    this.core.cancelMove();
    this.logger.info("Canceled move draft.", {
      entityId: moveMode.entityId,
      originGridPoint: moveDraft.originGridPoint,
      currentGridPoint: moveDraft.gridPoint,
      interactionMode: moveMode.inputMode,
    });
    return true;
  }

  activateLinkTarget(entityId: string | null): void {
    this.handleLinkToolClick(entityId);
  }

  setPlacementPreview(preview: PlacementPreviewState | null): void {
    this.core.setPlacementPreview(preview);
  }

  selectEntity(
    entityId: string | null,
    inputMode?: PlacementInteractionMode | null,
  ): void {
    this.core.selectEntity(entityId, inputMode);
  }

  rotateSelectedEntityClockwise(): boolean {
    const {
      document,
      session: { selection },
    } = this.core.getSnapshot();
    const selectedEntityId = selection[0];

    if (!selectedEntityId) {
      return false;
    }

    const entity = document.entities[selectedEntityId];

    if (!entity) {
      return false;
    }

    const definition = this.getDefinition(entity.definitionId);

    if (!definition) {
      return false;
    }

    const nextRotation = rotateGridRotationClockwise(entity.rotation);
    const currentFootprint = getRotatedGridFootprint(
      definition.footprint,
      entity.rotation,
    );
    const nextFootprint = getRotatedGridFootprint(
      definition.footprint,
      nextRotation,
    );
    const nextPosition = resolveCenteredRotatedGridPoint({
      gridPoint: entity.position,
      currentFootprint,
      nextFootprint,
    });

    const didRotate = this.core.rotateSelectedEntityClockwise(nextPosition);

    if (didRotate) {
      this.logger.info("Rotated selected entity.", {
        entityId: selectedEntityId,
        previousPosition: entity.position,
        nextPosition,
        previousRotation: entity.rotation,
        nextRotation,
      });
    }

    return didRotate;
  }

  setLinkSourceEntityId(entityId: string | null): void {
    this.core.setLinkSourceEntityId(entityId);
  }

  placeEntity(
    definitionId: string,
    position: GridPoint,
    rotation?: GridRotation,
  ): void {
    this.core.placeEntity(definitionId, position, rotation);
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

  private createPlacementPreviewFromWorldInput(
    document: WorldDocument,
    session: EditorSession,
    definition: Stage1EntityDefinition,
    input: CanvasWorldInput,
  ): PlacementPreviewState {
    const placementMode = this.getPlacementMode(session);
    const rotation = placementMode?.rotation ?? 0;
    const footprint = getRotatedGridFootprint(definition.footprint, rotation);
    const previewGridPoint = resolveCenteredPlacementGridPoint({
      worldPoint: input.worldPoint,
      gridSize: document.documentSettings.gridSize,
      footprint,
    });

    return {
      definitionId: placementMode?.definitionId ?? definition.id,
      interactionMode: placementMode?.inputMode ?? "pointer",
      gridPoint: previewGridPoint,
      rotation,
      valid: true,
    };
  }

  private createMoveDraftFromWorldInput(
    document: WorldDocument,
    moveDraft: MoveDraftState,
    input: CanvasWorldInput,
  ): MoveDraftState {
    const { gridSize } = document.documentSettings;
    const draftGridPoint = {
      x: Math.floor((input.worldPoint.x - moveDraft.anchorWorldOffset.x) / gridSize),
      y: Math.floor((input.worldPoint.y - moveDraft.anchorWorldOffset.y) / gridSize),
    } satisfies GridPoint;

    return {
      ...moveDraft,
      gridPoint: draftGridPoint,
      valid: true,
    };
  }

  private evaluatePlacementPreview(
    preview: PlacementPreviewState,
    definition: Stage1EntityDefinition,
  ): PlacementCandidateEvaluation {
    const { document } = this.core.getSnapshot();
    const topology = this.getTopology();
    const base = getStage1BaseDefinition(document.baseId);
    const footprint = getRotatedGridFootprint(
      definition.footprint,
      preview.rotation,
    );
    const overlappingEntityIds = this.collectOverlappingEntityIds(
      topology,
      preview.gridPoint,
      footprint,
    );
    const withinBase = isStage1FootprintWithinBase({
      base,
      position: preview.gridPoint,
      footprint,
    });

    return {
      invalidReason: withinBase ? null : "out-of-base",
      overlappingEntityIds,
    };
  }

  private evaluateMoveDraft(
    draft: MoveDraftState,
    definition: Stage1EntityDefinition,
  ): MoveCandidateEvaluation {
    const { document } = this.core.getSnapshot();
    const topology = this.getTopology();
    const base = getStage1BaseDefinition(document.baseId);
    const footprint = getRotatedGridFootprint(
      definition.footprint,
      draft.rotation,
    );
    const overlappingEntityIds = this.collectOverlappingEntityIds(
      topology,
      draft.gridPoint,
      footprint,
      draft.entityId,
    );
    const withinBase = isStage1FootprintWithinBase({
      base,
      position: draft.gridPoint,
      footprint,
    });

    return {
      invalidReason: withinBase ? null : "out-of-base",
      overlappingEntityIds,
    };
  }

  private collectOverlappingEntityIds(
    topology: CompiledTopology,
    position: GridPoint,
    footprint: Stage1EntityDefinition["footprint"],
    ignoreEntityId: string | null = null,
  ): string[] {
    const entityIds = new Set<string>();

    for (let y = 0; y < footprint.height; y += 1) {
      for (let x = 0; x < footprint.width; x += 1) {
        const cellKey = `${position.x + x},${position.y + y}`;
        const occupants = topology.occupancyIndex[cellKey];

        if (!occupants) {
          continue;
        }

        for (const entityId of occupants) {
          if (entityId === ignoreEntityId) {
            continue;
          }

          entityIds.add(entityId);
        }
      }
    }

    return Array.from(entityIds);
  }

  private measureProfilerStage<T>(
    stageId:
      | "editor.total"
      | "editor.resolvePlacementPreview"
      | "editor.hitTest"
      | "editor.writeSession",
    callback: () => T,
  ): T {
    if (this.placementPreviewProfiler) {
      return this.placementPreviewProfiler.measureStage(stageId, callback);
    }

    return callback();
  }

  private handleLinkToolClick(hitEntityId: string | null): void {
    const { document, session } = this.core.getSnapshot();
    const pendingLinkSourceEntityId = getPendingLinkSourceEntityId(session.currentMode);

    if (!hitEntityId) {
      this.core.selectEntity(null, null);
      this.core.setLinkSourceEntityId(null);
      return;
    }

    if (!pendingLinkSourceEntityId) {
      this.core.selectEntity(hitEntityId, null);
      this.core.setLinkSourceEntityId(hitEntityId);
      return;
    }

    if (pendingLinkSourceEntityId === hitEntityId) {
      this.core.selectEntity(hitEntityId, null);
      this.core.setLinkSourceEntityId(null);
      return;
    }

    const resolvedPair = this.resolveDarkPipePair(
      pendingLinkSourceEntityId,
      hitEntityId,
    );

    if (!resolvedPair) {
      this.core.selectEntity(hitEntityId, null);
      this.core.setLinkSourceEntityId(hitEntityId);
      return;
    }

    const existingLink = getExplicitLinkBetween(
      document,
      resolvedPair.sourceEntityId,
      resolvedPair.targetEntityId,
    );

    if (existingLink) {
      this.core.removeLink(existingLink.id);
      this.core.selectEntity(hitEntityId, null);
      this.core.setLinkSourceEntityId(null);
      return;
    }

    this.core.createLink(
      resolvedPair.sourceEntityId,
      resolvedPair.targetEntityId,
    );
  }

  private resolveDarkPipePair(
    entityIdA: string,
    entityIdB: string,
  ): { sourceEntityId: string; targetEntityId: string } | null {
    const topology = this.getTopology();
    const definitionA = topology.entityViews[entityIdA]?.definition;
    const definitionB = topology.entityViews[entityIdB]?.definition;

    if (!definitionA || !definitionB) {
      return null;
    }

    const aCanSource = definitionA.capabilityIds.includes("device-link-source");
    const aCanTarget = definitionA.capabilityIds.includes("device-link-target");
    const bCanSource = definitionB.capabilityIds.includes("device-link-source");
    const bCanTarget = definitionB.capabilityIds.includes("device-link-target");

    if (aCanSource && bCanTarget) {
      return {
        sourceEntityId: entityIdA,
        targetEntityId: entityIdB,
      };
    }

    if (bCanSource && aCanTarget) {
      return {
        sourceEntityId: entityIdB,
        targetEntityId: entityIdA,
      };
    }

    return null;
  }
}

export function createEditorHost(
  options: CreateEditorHostOptions,
): EditorHost {
  return new EditorHostImpl(options);
}
