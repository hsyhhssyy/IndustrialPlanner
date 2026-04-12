import {
  createEditorCore,
  type EditorCore,
  type EditorHistoryState,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type { EditorSession } from "@/editor/contracts/editor-session";
import type { EditorMergedEntityLookup } from "@/editor/contracts/merged-entity-lookup";
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
  type MoveDraftEntityState,
  type MoveDraftState,
} from "@/editor/contracts/move-draft";
import {
  isSameMarqueeDraftState,
  type MarqueeDraftState,
} from "@/editor/contracts/marquee-draft";
import {
  resolveMarqueeSelection,
  type EditorSelectionUpdateMode,
} from "@/editor/contracts/selection";
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
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getGridFootprintCenterCells,
  resolveCenteredGridPoint,
  resolveCenteredRotatedGridPoint,
  rotateGridCenterCellsClockwise,
  rotateGridRotationClockwise,
  type GridBounds,
  type GridFootprint,
  type GridPoint,
  type GridRotation,
} from "@/shared/geometry/grid";
import { createLogger } from "@/shared/logging/logger";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import type { CanvasPoint } from "@/workbench/workspace-state";
import type { AtomicDocumentCommand } from "@/editor/core/commands/document-command";

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

export interface MarqueeDraftUpdateResult {
  draft: MarqueeDraftState | null;
  changed: boolean;
}

function resolveMarqueeBounds(
  originGridPoint: GridPoint,
  gridPoint: GridPoint,
): GridBounds {
  const left = Math.min(originGridPoint.x, gridPoint.x);
  const top = Math.min(originGridPoint.y, gridPoint.y);
  const right = Math.max(originGridPoint.x, gridPoint.x);
  const bottom = Math.max(originGridPoint.y, gridPoint.y);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
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

function rotateMoveAnchorWorldOffsetClockwise(options: {
  anchorWorldOffset: {
    x: number;
    y: number;
  };
  currentFootprint: {
    width: number;
    height: number;
  };
  gridSize: number;
}) {
  const currentHeightPx = options.currentFootprint.height * options.gridSize;

  return {
    x: currentHeightPx - options.anchorWorldOffset.y,
    y: options.anchorWorldOffset.x,
  };
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
  getEntityById: EditorMergedEntityLookup["getEntityById"];
  queryInteractionTarget: (
    worldPoint: CanvasPoint,
  ) => EditorWorldInteractionTarget;
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
    input: CanvasWorldInput,
  ) => boolean;
  rotateMoveClockwise: () => boolean;
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
  beginMarquee: (
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
    input: CanvasWorldInput,
  ) => boolean;
  updateMarqueeDraft: (input: CanvasWorldInput) => MarqueeDraftUpdateResult;
  confirmMarqueeSelection: () => boolean;
  cancelMarquee: () => boolean;
  activateLinkTarget: (entityId: string | null) => void;
  setPlacementPreview: (preview: PlacementPreviewState | null) => void;
  selectEntity: (
    entityId: string | null,
    inputMode?: PlacementInteractionMode | null,
    selectionMode?: EditorSelectionUpdateMode,
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

interface ResolvedMoveDraftEntity {
  entity: MoveDraftEntityState;
  definition: Stage1EntityDefinition;
}

function rotateResolvedDraftEntitiesClockwise(
  entities: readonly ResolvedMoveDraftEntity[],
  rotationCenterCells?: GridCenterCells,
): MoveDraftEntityState[] {
  const bounds = getMoveDraftBounds(entities);

  if (!bounds) {
    return entities.map((entity) => cloneMoveDraftEntity(entity.entity));
  }

  const resolvedRotationCenterCells =
    rotationCenterCells ?? getGridBoundsCenterCells(bounds);

  return entities.map(({ entity, definition }) => {
    const currentFootprint = getRotatedGridFootprint(
      definition.footprint,
      entity.rotation,
    );
    const nextRotation = rotateGridRotationClockwise(entity.rotation);
    const nextFootprint = getRotatedGridFootprint(
      definition.footprint,
      nextRotation,
    );
    const currentCenterCells =
      entity.centerCells ??
      getGridFootprintCenterCells(entity.gridPoint, currentFootprint);
    const rotatedCenterCells = rotateGridCenterCellsClockwise({
      centerCells: currentCenterCells,
      rotationCenterCells: resolvedRotationCenterCells,
    });

    return {
      ...cloneMoveDraftEntity(entity),
      centerCells: rotatedCenterCells,
      gridPoint: resolveCenteredGridPoint(rotatedCenterCells, nextFootprint),
      rotation: nextRotation,
    };
  });
}

function cloneMoveDraftEntity(entity: MoveDraftEntityState): MoveDraftEntityState {
  return {
    ...entity,
    originGridPoint: {
      ...entity.originGridPoint,
    },
    gridPoint: {
      ...entity.gridPoint,
    },
    centerCells: entity.centerCells
      ? {
          ...entity.centerCells,
        }
      : undefined,
  };
}

function cloneMoveDraftEntities(
  entities: readonly MoveDraftEntityState[],
): MoveDraftEntityState[] {
  return entities.map((entity) => cloneMoveDraftEntity(entity));
}

function getMoveDraftEntity(
  draft: MoveDraftState,
  entityId: string,
): MoveDraftEntityState | null {
  return draft.entities.find((entity) => entity.entityId === entityId) ?? null;
}

function getMoveDraftBounds(
  entities: readonly ResolvedMoveDraftEntity[],
): GridBounds | null {
  return getGridBoundingBox(
    entities.map((entity) => ({
      position: entity.entity.gridPoint,
      footprint: getRotatedGridFootprint(
        entity.definition.footprint,
        entity.entity.rotation,
      ),
    })),
  );
}

type GridCenterCells = {
  x: number;
  y: number;
};

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
        getDefinition: options.getDefinition,
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

  getEntityById(id: string) {
    const snapshot = this.core.getSnapshot();
    const draftEntity = snapshot.session.drafts.entities[id];

    if (draftEntity) {
      return {
        kind: "draft" as const,
        entity: draftEntity,
      };
    }

    const worldEntity = snapshot.document.entities[id];

    if (!worldEntity) {
      return null;
    }

    return {
      kind: "world" as const,
      entity: worldEntity,
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
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
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
    const moveMode = this.getMoveMode(session);
    const existingDraft =
      session.moveDraft && getMoveDraftEntity(session.moveDraft, entityId)
        ? session.moveDraft
        : null;
    const existingResolvedEntities = existingDraft
      ? this.resolveMoveDraftEntities(existingDraft, {
          preferManagedDrafts: true,
        })
      : null;
    const isSelectedEntity =
      session.currentMode.key === "select" &&
      session.selection.length > 0 &&
      session.selection.includes(entityId);

    if (
      (!isSelectedEntity || session.currentMode.key !== "select") &&
      !existingDraft
    ) {
      return false;
    }

    const anchorEntity =
      existingResolvedEntities?.find((entity) => entity.entity.entityId === entityId)
        ?.entity ??
      (existingDraft ? getMoveDraftEntity(existingDraft, entityId) : null);

    if (!anchorEntity && !document.entities[entityId]) {
      return false;
    }

    const entityIds = existingDraft
      ? existingResolvedEntities?.map((entity) => entity.entity.entityId) ?? []
      : session.selection;
    const draftEntities = existingDraft
      ? existingResolvedEntities?.map((entity) => cloneMoveDraftEntity(entity.entity)) ?? []
      : entityIds
          .map((selectedEntityId) => document.entities[selectedEntityId])
          .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
          .map(
            (entity) => {
              const definition = this.getDefinition(entity.definitionId);
              const footprint = definition
                ? getRotatedGridFootprint(definition.footprint, entity.rotation)
                : null;

              return {
                entityId: entity.id,
                originGridPoint: entity.position,
                gridPoint: entity.position,
                centerCells: footprint
                  ? getGridFootprintCenterCells(entity.position, footprint)
                  : undefined,
                originRotation: entity.rotation,
                rotation: entity.rotation,
              } satisfies MoveDraftEntityState;
            },
          );

    if (draftEntities.length === 0) {
      return false;
    }

    const resolvedAnchorEntity =
      anchorEntity ??
      draftEntities.find((draftEntity) => draftEntity.entityId === entityId) ??
      null;

    if (!resolvedAnchorEntity) {
      return false;
    }

    const anchorGridPoint = resolvedAnchorEntity.gridPoint;
    const rotationCenterCells =
      existingDraft?.rotationCenterCells ??
      this.resolveMoveDraftRotationCenterCells(draftEntities);
    const draft: MoveDraftState = {
      entityId,
      interactionMode: inputMode,
      originGridPoint: resolvedAnchorEntity.originGridPoint,
      gridPoint: resolvedAnchorEntity.gridPoint,
      rotation: resolvedAnchorEntity.rotation,
      valid: existingDraft?.valid ?? true,
      rotationCenterCells: rotationCenterCells ?? undefined,
      anchorWorldOffset: {
        x:
          input.worldPoint.x -
          anchorGridPoint.x * document.documentSettings.gridSize,
        y:
          input.worldPoint.y -
          anchorGridPoint.y * document.documentSettings.gridSize,
      },
      entities: draftEntities,
    };

    this.core.beginMove(entityId, inputMode, draft);
    this.logger.info(existingDraft ? "Re-anchored move draft." : "Began move draft.", {
      entityId,
      entityIds: draft.entities.map((entity) => entity.entityId),
      inputMode,
      originGridPoint: draft.originGridPoint,
      currentGridPoint: draft.gridPoint,
      rotation: draft.rotation,
      anchorWorldOffset: draft.anchorWorldOffset,
    });
    return true;
  }

  rotateMoveClockwise(): boolean {
    const { document, session } = this.core.getSnapshot();
    const moveDraft = session.moveDraft;

    if (!moveDraft) {
      return false;
    }

    const resolvedEntities = this.resolveMoveDraftEntities(moveDraft, {
      preferManagedDrafts: true,
    });
    const resolvedAnchorEntity = resolvedEntities?.find(
      (entity) => entity.entity.entityId === moveDraft.entityId,
    );

    if (!resolvedEntities || !resolvedAnchorEntity) {
      return false;
    }

    const anchorEntity = resolvedAnchorEntity.entity;
    const currentRotation = anchorEntity.rotation;
    const currentFootprint = getRotatedGridFootprint(
      resolvedAnchorEntity.definition.footprint,
      currentRotation,
    );
    const gridSize = document.documentSettings.gridSize;
    const currentAnchorWorldPoint = {
      x: anchorEntity.gridPoint.x * gridSize + moveDraft.anchorWorldOffset.x,
      y: anchorEntity.gridPoint.y * gridSize + moveDraft.anchorWorldOffset.y,
    };
    const rotatedEntities = rotateResolvedDraftEntitiesClockwise(
      resolvedEntities,
      moveDraft.rotationCenterCells,
    );
    const nextAnchorEntity = rotatedEntities.find(
      (entity) => entity.entityId === moveDraft.entityId,
    );

    if (!nextAnchorEntity) {
      return false;
    }

    const rotatedDraft = {
      ...moveDraft,
      gridPoint: nextAnchorEntity.gridPoint,
      rotation: nextAnchorEntity.rotation,
      valid: true,
      rotationCenterCells: moveDraft.rotationCenterCells,
      anchorWorldOffset: rotateMoveAnchorWorldOffsetClockwise({
        anchorWorldOffset: moveDraft.anchorWorldOffset,
        currentFootprint,
        gridSize,
      }),
      entities: rotatedEntities,
    } satisfies MoveDraftState;
    const reanchoredDraft = this.createMoveDraftFromWorldInput(
      document,
      rotatedDraft,
      {
        worldPoint: currentAnchorWorldPoint,
        gridPoint: {
          x: Math.floor(currentAnchorWorldPoint.x / gridSize),
          y: Math.floor(currentAnchorWorldPoint.y / gridSize),
        },
      },
    );
    const resolvedRotatedEntities = this.resolveMoveDraftEntities(reanchoredDraft);

    if (!resolvedRotatedEntities) {
      return false;
    }

    const evaluation = this.evaluateMoveDraft(
      reanchoredDraft,
      resolvedRotatedEntities,
    );
    const resolvedDraft = {
      ...reanchoredDraft,
      valid: evaluation.invalidReason === null,
    } satisfies MoveDraftState;

    if (!isSameMoveDraftState(moveDraft, resolvedDraft)) {
      this.core.setMoveDraft(resolvedDraft);
    }

    this.logger.info("Rotated move draft.", {
      entityIds: moveDraft.entities.map((entity) => entity.entityId),
      anchorEntityId: moveDraft.entityId,
      previousGridPoint: anchorEntity.gridPoint,
      nextGridPoint: resolvedDraft.gridPoint,
      previousRotation: currentRotation,
      nextRotation: nextAnchorEntity.rotation,
      invalidReason: evaluation.invalidReason,
    });
    return true;
  }

  rotatePlacementClockwise(): boolean {
    const { session } = this.core.getSnapshot();
    const placementMode = this.getPlacementMode(session);
    const previewDraftId = session.draftEntities?.ids[0] ?? null;
    const previewDraft = previewDraftId
      ? session.drafts.entities[previewDraftId]
      : null;

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

    if (
      !previewDraft ||
      previewDraft.sourceEntityId !== null ||
      previewDraft.definitionId !== placementMode.definitionId
    ) {
      this.logger.info("Rotated armed placement before preview existed.", {
        definitionId: placementMode.definitionId,
        previousRotation: currentRotation,
        nextRotation,
      });
      return true;
    }

    const rotatedPreviewEntity = rotateResolvedDraftEntitiesClockwise([
      {
        entity: {
          entityId: previewDraft.id,
          originGridPoint: previewDraft.position,
          gridPoint: previewDraft.position,
          originRotation: previewDraft.rotation,
          rotation: previewDraft.rotation,
        },
        definition,
      } satisfies ResolvedMoveDraftEntity,
    ])[0];

    if (!rotatedPreviewEntity) {
      return false;
    }

    const rotatedPreview = {
      definitionId: previewDraft.definitionId,
      interactionMode: placementMode.inputMode,
      rotation: rotatedPreviewEntity.rotation,
      gridPoint: rotatedPreviewEntity.gridPoint,
      valid: previewDraft.valid,
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
      previousGridPoint: previewDraft.position,
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
    const placementMode = this.getPlacementMode(session);
    const previewDraftId = session.draftEntities?.ids[0] ?? null;
    const previewDraft = previewDraftId
      ? session.drafts.entities[previewDraftId]
      : null;
    const preview =
      placementMode &&
      previewDraft &&
      previewDraft.sourceEntityId === null &&
      previewDraft.definitionId === placementMode.definitionId
        ? {
            definitionId: previewDraft.definitionId,
            interactionMode: placementMode.inputMode,
            gridPoint: previewDraft.position,
            rotation: previewDraft.rotation,
            valid: previewDraft.valid,
          }
        : null;

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
    const moveDraft = session.moveDraft;

    if (!moveDraft) {
      return {
        draft: null,
        invalidReason: "inactive-move",
        overlappingEntityIds: [],
      };
    }

    const resolvedEntities = this.resolveMoveDraftEntities(moveDraft, {
      preferManagedDrafts: true,
    });

    if (!resolvedEntities) {
      return {
        draft: null,
        invalidReason: "missing-entity",
        overlappingEntityIds: [],
      };
    }

    const draft = this.createMoveDraftFromWorldInput(document, moveDraft, input);
    const evaluation = this.evaluateMoveDraft(draft, resolvedEntities);

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
    const { session } = this.core.getSnapshot();
    const moveDraft = session.moveDraft;

    if (!moveDraft) {
      return false;
    }

    const resolvedEntities = this.resolveMoveDraftEntities(moveDraft);

    if (!resolvedEntities) {
      return false;
    }

    const evaluation = this.evaluateMoveDraft(moveDraft, resolvedEntities);
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
        entityIds: moveDraft.entities.map((entity) => entity.entityId),
        anchorEntityId: moveDraft.entityId,
        originGridPoint: moveDraft.originGridPoint,
        nextGridPoint: resolvedDraft.gridPoint,
        nextRotation: resolvedDraft.rotation,
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
      entityIds: moveDraft.entities.map((entity) => entity.entityId),
      anchorEntityId: moveMode.entityId,
      originGridPoint: moveDraft.originGridPoint,
      currentGridPoint: moveDraft.gridPoint,
      interactionMode: moveMode.inputMode,
    });
    return true;
  }

  beginMarquee(
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
    input: CanvasWorldInput,
  ): boolean {
    const { session } = this.core.getSnapshot();

    if (session.currentMode.key !== "select") {
      return false;
    }

    const draft = this.createMarqueeDraft({
      baseSelection: session.selection,
      currentGridPoint: input.gridPoint,
      inputMode,
      originGridPoint: input.gridPoint,
      selectionMode,
    });

    this.core.beginMarquee(inputMode, selectionMode, draft);
    this.logger.info("Began marquee draft.", {
      interactionMode: inputMode,
      selectionMode,
      originGridPoint: draft.originGridPoint,
      bounds: draft.bounds,
      baseSelection: draft.baseSelection,
    });
    return true;
  }

  updateMarqueeDraft(input: CanvasWorldInput): MarqueeDraftUpdateResult {
    const { session } = this.core.getSnapshot();
    const marqueeDraft = session.marqueeDraft;

    if (!marqueeDraft) {
      return {
        draft: null,
        changed: false,
      };
    }

    const nextDraft = this.createMarqueeDraft({
      baseSelection: marqueeDraft.baseSelection,
      currentGridPoint: input.gridPoint,
      inputMode: marqueeDraft.interactionMode,
      originGridPoint: marqueeDraft.originGridPoint,
      selectionMode: marqueeDraft.selectionMode,
    });
    const changed = !isSameMarqueeDraftState(marqueeDraft, nextDraft);

    if (changed) {
      this.core.setMarqueeDraft(nextDraft);
      this.logger.debug("Updated marquee draft.", {
        originGridPoint: nextDraft.originGridPoint,
        gridPoint: nextDraft.gridPoint,
        bounds: nextDraft.bounds,
        entityIds: nextDraft.entityIds,
        selectionMode: nextDraft.selectionMode,
      });
    }

    return {
      draft: nextDraft,
      changed,
    };
  }

  confirmMarqueeSelection(): boolean {
    const { session } = this.core.getSnapshot();
    const marqueeDraft = session.marqueeDraft;

    if (!marqueeDraft) {
      return false;
    }

    const nextSelection = resolveMarqueeSelection(
      marqueeDraft.baseSelection,
      marqueeDraft.entityIds,
      marqueeDraft.selectionMode,
    );

    const confirmed = this.core.confirmMarqueeSelection();

    if (!confirmed) {
      return false;
    }

    this.logger.info("Confirmed marquee draft.", {
      interactionMode: marqueeDraft.interactionMode,
      selectionMode: marqueeDraft.selectionMode,
      bounds: marqueeDraft.bounds,
      entityIds: marqueeDraft.entityIds,
      previousSelection: marqueeDraft.baseSelection,
      nextSelection,
    });
    return true;
  }

  cancelMarquee(): boolean {
    const { session } = this.core.getSnapshot();
    const marqueeDraft = session.marqueeDraft;

    if (!marqueeDraft) {
      return false;
    }

    const canceled = this.core.cancelMarquee();

    if (!canceled) {
      return false;
    }

    this.logger.info("Canceled marquee draft.", {
      interactionMode: marqueeDraft.interactionMode,
      selectionMode: marqueeDraft.selectionMode,
      bounds: marqueeDraft.bounds,
      entityIds: marqueeDraft.entityIds,
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
    selectionMode: EditorSelectionUpdateMode = "replace",
  ): void {
    this.core.selectEntity(entityId, inputMode, selectionMode);
  }

  rotateSelectedEntityClockwise(): boolean {
    const {
      document,
      session: { selection },
    } = this.core.getSnapshot();
    if (selection.length === 0) {
      return false;
    }

    const resolvedEntities = selection
      .map((entityId) => {
        const entity = document.entities[entityId];
        const definition = entity ? this.getDefinition(entity.definitionId) : undefined;

        if (!entity || !definition) {
          return null;
        }

        return {
          entity: {
            entityId: entity.id,
            originGridPoint: entity.position,
            gridPoint: entity.position,
            originRotation: entity.rotation,
            rotation: entity.rotation,
          } satisfies MoveDraftEntityState,
          definition,
        } satisfies ResolvedMoveDraftEntity;
      })
      .filter((entity): entity is ResolvedMoveDraftEntity => entity !== null);

    if (resolvedEntities.length !== selection.length) {
      return false;
    }

    const rotatedEntities = rotateResolvedDraftEntitiesClockwise(resolvedEntities);
    const commands: AtomicDocumentCommand[] = rotatedEntities.map((entity) => ({
      type: "entity.rotate",
      payload: {
        entityId: entity.entityId,
        position: entity.gridPoint,
        rotation: entity.rotation,
      },
    }));

    if (commands.length === 0) {
      return false;
    }

    const didRotate = this.core.applyDocumentCommand(
      commands.length === 1 && commands[0]
        ? commands[0]
        : {
            type: "batch",
            payload: {
              commands,
            },
          },
    );

    if (didRotate) {
      this.logger.info("Rotated selected entities.", {
        entityIds: selection,
        rotatedEntityStates: rotatedEntities,
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

  private resolveMoveDraftEntities(
    draft: MoveDraftState,
    options: {
      preferManagedDrafts?: boolean;
    } = {},
  ): ResolvedMoveDraftEntity[] | null {
    const { document, session } = this.core.getSnapshot();
    const topology = this.getTopology();

    if (options.preferManagedDrafts && session.draftEntities) {
      const draftEntityBySourceId = new Map(
        draft.entities.map((entity) => [entity.entityId, entity] as const),
      );
      const resolvedManagedEntities: ResolvedMoveDraftEntity[] = [];

      for (const draftId of session.draftEntities.ids) {
        const managedDraft = session.drafts.entities[draftId];

        if (!managedDraft?.sourceEntityId) {
          continue;
        }

        const sourceEntity = document.entities[managedDraft.sourceEntityId];
        const definition =
          topology.entityViews[managedDraft.sourceEntityId]?.definition ??
          (sourceEntity
            ? this.getDefinition(sourceEntity.definitionId)
            : undefined);
        const previousEntity = draftEntityBySourceId.get(managedDraft.sourceEntityId);

        if (!sourceEntity || !definition) {
          continue;
        }

        const currentFootprint = getRotatedGridFootprint(
          definition.footprint,
          managedDraft.rotation,
        );

        resolvedManagedEntities.push({
          entity: {
            entityId: managedDraft.sourceEntityId,
            originGridPoint: previousEntity?.originGridPoint ?? sourceEntity.position,
            gridPoint: managedDraft.position,
            centerCells:
              previousEntity?.centerCells ??
              getGridFootprintCenterCells(
                managedDraft.position,
                currentFootprint,
              ),
            originRotation: previousEntity?.originRotation ?? sourceEntity.rotation,
            rotation: managedDraft.rotation,
          },
          definition,
        });
      }

      if (resolvedManagedEntities.length === session.draftEntities.ids.length) {
        return resolvedManagedEntities;
      }
    }

    const resolvedEntities = draft.entities
      .map((draftEntity) => {
        const entity = document.entities[draftEntity.entityId];
        const definition =
          topology.entityViews[draftEntity.entityId]?.definition ??
          (entity ? this.getDefinition(entity.definitionId) : undefined);

        if (!entity || !definition) {
          return null;
        }

        return {
          entity: cloneMoveDraftEntity(draftEntity),
          definition,
        } satisfies ResolvedMoveDraftEntity;
      })
      .filter((entity): entity is ResolvedMoveDraftEntity => entity !== null);

    return resolvedEntities.length === draft.entities.length ? resolvedEntities : null;
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
    const activeMoveDraft = this.core.getSnapshot().session.moveDraft;
    const resolvedEntities = this.resolveMoveDraftEntities(moveDraft, {
      preferManagedDrafts: moveDraft === activeMoveDraft,
    });
    const resolvedAnchorEntity = resolvedEntities?.find(
      (entity) => entity.entity.entityId === moveDraft.entityId,
    );

    if (!resolvedEntities || !resolvedAnchorEntity) {
      return moveDraft;
    }

    const currentFootprint = getRotatedGridFootprint(
      resolvedAnchorEntity.definition.footprint,
      resolvedAnchorEntity.entity.rotation,
    );
    const currentAnchorCenterCells =
      resolvedAnchorEntity.entity.centerCells ??
      getGridFootprintCenterCells(
        resolvedAnchorEntity.entity.gridPoint,
        currentFootprint,
      );
    const currentAnchorTopLeftCells = {
      x: currentAnchorCenterCells.x - currentFootprint.width / 2,
      y: currentAnchorCenterCells.y - currentFootprint.height / 2,
    };
    const targetAnchorTopLeftCells = {
      x: (input.worldPoint.x - moveDraft.anchorWorldOffset.x) / gridSize,
      y: (input.worldPoint.y - moveDraft.anchorWorldOffset.y) / gridSize,
    };
    const deltaX = targetAnchorTopLeftCells.x - currentAnchorTopLeftCells.x;
    const deltaY = targetAnchorTopLeftCells.y - currentAnchorTopLeftCells.y;
    const nextEntities = resolvedEntities.map(({ entity, definition }) => {
      const currentEntityFootprint = getRotatedGridFootprint(
        definition.footprint,
        entity.rotation,
      );
      const currentCenterCells =
        entity.centerCells ??
        getGridFootprintCenterCells(entity.gridPoint, currentEntityFootprint);
      const nextCenterCells = {
        x: currentCenterCells.x + deltaX,
        y: currentCenterCells.y + deltaY,
      };

      return {
        ...cloneMoveDraftEntity(entity),
        centerCells: nextCenterCells,
        gridPoint: resolveCenteredGridPoint(
          nextCenterCells,
          currentEntityFootprint,
        ),
      } satisfies MoveDraftEntityState;
    });
    const nextAnchorEntity = nextEntities.find(
      (entity) => entity.entityId === moveDraft.entityId,
    );

    if (!nextAnchorEntity) {
      return moveDraft;
    }

    return {
      ...moveDraft,
      gridPoint: nextAnchorEntity.gridPoint,
      valid: true,
      rotationCenterCells: moveDraft.rotationCenterCells
        ? {
            x: moveDraft.rotationCenterCells.x + deltaX,
            y: moveDraft.rotationCenterCells.y + deltaY,
          }
        : undefined,
      entities: nextEntities,
    };
  }

  private resolveMoveDraftRotationCenterCells(
    entities: readonly MoveDraftEntityState[],
  ): GridCenterCells | null {
    const { document } = this.core.getSnapshot();
    const topology = this.getTopology();
    const bounds = getGridBoundingBox(
      entities
        .map((entity) => {
          const documentEntity = document.entities[entity.entityId];
          const definition =
            topology.entityViews[entity.entityId]?.definition ??
            (documentEntity
              ? this.getDefinition(documentEntity.definitionId)
              : undefined);

          if (!documentEntity || !definition) {
            return null;
          }

          return {
            position: entity.gridPoint,
            footprint: getRotatedGridFootprint(
              definition.footprint,
              entity.rotation,
            ),
          };
        })
        .filter((area): area is NonNullable<typeof area> => area !== null),
    );

    return bounds ? getGridBoundsCenterCells(bounds) : null;
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
    entities: readonly ResolvedMoveDraftEntity[],
  ): MoveCandidateEvaluation {
    const { document } = this.core.getSnapshot();
    const topology = this.getTopology();
    const base = getStage1BaseDefinition(document.baseId);
    const ignoredEntityIds = new Set(draft.entities.map((entity) => entity.entityId));
    const overlappingEntityIds = new Set<string>();
    let withinBase = true;

    for (const { entity, definition } of entities) {
      const footprint = getRotatedGridFootprint(
        definition.footprint,
        entity.rotation,
      );

      for (const overlappingEntityId of this.collectOverlappingEntityIds(
        topology,
        entity.gridPoint,
        footprint,
        ignoredEntityIds,
      )) {
        overlappingEntityIds.add(overlappingEntityId);
      }

      withinBase =
        withinBase &&
        isStage1FootprintWithinBase({
          base,
          position: entity.gridPoint,
          footprint,
        });
    }

    return {
      invalidReason: withinBase ? null : "out-of-base",
      overlappingEntityIds: Array.from(overlappingEntityIds),
    };
  }

  private collectOverlappingEntityIds(
    topology: CompiledTopology,
    position: GridPoint,
    footprint: Stage1EntityDefinition["footprint"],
    ignoredEntityIds: ReadonlySet<string> | null = null,
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
          if (ignoredEntityIds?.has(entityId)) {
            continue;
          }

          entityIds.add(entityId);
        }
      }
    }

    return Array.from(entityIds);
  }

  private collectMarqueeEntityIds(
    document: WorldDocument,
    topology: CompiledTopology,
    bounds: GridBounds,
  ): string[] {
    const entityIds = new Set<string>();

    for (let y = bounds.top; y < bounds.top + bounds.height; y += 1) {
      for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
        const occupants = topology.occupancyIndex[`${x},${y}`];

        if (!occupants) {
          continue;
        }

        for (const entityId of occupants) {
          entityIds.add(entityId);
        }
      }
    }

    return document.entityOrder.filter((entityId) => entityIds.has(entityId));
  }

  private createMarqueeDraft(options: {
    baseSelection: readonly string[];
    currentGridPoint: GridPoint;
    inputMode: PlacementInteractionMode;
    originGridPoint: GridPoint;
    selectionMode: EditorSelectionUpdateMode;
  }): MarqueeDraftState {
    const document = this.core.getSnapshot().document;
    const bounds = resolveMarqueeBounds(
      options.originGridPoint,
      options.currentGridPoint,
    );

    return {
      interactionMode: options.inputMode,
      selectionMode: options.selectionMode,
      originGridPoint: options.originGridPoint,
      gridPoint: options.currentGridPoint,
      bounds,
      entityIds: this.collectMarqueeEntityIds(document, this.getTopology(), bounds),
      baseSelection: [...options.baseSelection],
    };
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
