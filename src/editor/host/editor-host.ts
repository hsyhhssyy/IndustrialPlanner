import {
  createEditorCore,
  type EditorCore,
  type EditorHistoryState,
  type EditorCoreSnapshot,
} from "@/editor/core/editor-core";
import type {
  EditorSession,
  EditorTool,
} from "@/editor/contracts/editor-session";
import {
  isSamePlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import type {
  PlacementPreviewState,
  PlacementPreviewStrategy,
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
import { isPlacementTool } from "@/editor/core/editor-session";
import type { GridPoint } from "@/shared/geometry/grid";
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
  changed: boolean;
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

    const x = entity.position.x * gridSize;
    const y = entity.position.y * gridSize;
    const width = definition.footprint.width * gridSize;
    const height = definition.footprint.height * gridSize;

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

  return {
    x: Math.max(0, Math.round(centerXCells - options.footprint.width / 2)),
    y: Math.max(0, Math.round(centerYCells - options.footprint.height / 2)),
  };
}

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
  setActiveTool: (tool: EditorTool) => void;
  setPlacementDefinition: (
    definitionId: string,
    tool?: EditorTool,
    strategy?: PlacementPreviewStrategy,
  ) => void;
  updatePlacementPreview: (input: CanvasWorldInput) => PlacementPreviewUpdateResult;
  confirmPlacement: () => boolean;
  commitPlacement: (input: CanvasWorldInput) => boolean;
  clearPlacementPreview: () => void;
  activateLinkTarget: (entityId: string | null) => void;
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

interface PlacementPreviewResolution {
  preview: PlacementPreviewState | null;
  invalidReason: PlacementPreviewInvalidReason | null;
  hitEntityId: string | null;
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

  setActiveTool(tool: EditorTool): void {
    this.core.setActiveTool(tool);
  }

  setPlacementDefinition(
    definitionId: string,
    tool?: EditorTool,
    strategy?: PlacementPreviewStrategy,
  ): void {
    this.core.setPlacementDefinition(definitionId, tool, strategy);
    this.logger.info("Armed placement definition.", {
      definitionId,
      tool: tool ?? "place",
      strategy: strategy ?? "pointer-follow",
    });
  }

  updatePlacementPreview(input: CanvasWorldInput): PlacementPreviewUpdateResult {
    return this.measureProfilerStage("editor.total", () => {
      const previousPreview = this.core.getSnapshot().session.placementPreview;
      const resolution = this.measureProfilerStage(
        "editor.resolvePlacementPreview",
        () => this.resolvePlacementPreview(input),
      );
      const changed = !isSamePlacementPreviewState(previousPreview, resolution.preview);

      this.measureProfilerStage("editor.writeSession", () => {
        this.core.setPlacementPreview(resolution.preview);
      });

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
        changed,
      };
    });
  }

  confirmPlacement(): boolean {
    const { session } = this.core.getSnapshot();
    const preview = session.placementPreview;

    if (
      !isPlacementTool(session.activeTool) ||
      !session.placementDefinitionId ||
      !preview ||
      !preview.valid ||
      preview.definitionId !== session.placementDefinitionId
    ) {
      this.logger.info("Skipped placement confirmation.", {
        activeTool: session.activeTool,
        placementDefinitionId: session.placementDefinitionId,
        placementStrategy: session.placementStrategy,
        preview,
      });
      return false;
    }

    this.logger.info("Confirmed placement from preview.", {
      definitionId: session.placementDefinitionId,
      gridPoint: preview.gridPoint,
      strategy: preview.strategy,
    });
    this.core.placeEntity(session.placementDefinitionId, preview.gridPoint);
    return true;
  }

  commitPlacement(input: CanvasWorldInput): boolean {
    const { session } = this.core.getSnapshot();

    if (
      !isPlacementTool(session.activeTool) ||
      !session.placementDefinitionId ||
      session.placementStrategy !== "pointer-follow"
    ) {
      this.logger.info("Skipped pointer-follow placement commit before preview resolution.", {
        activeTool: session.activeTool,
        placementDefinitionId: session.placementDefinitionId,
        placementStrategy: session.placementStrategy,
      });
      return false;
    }

    const resolution = this.resolvePlacementPreview(input);
    const preview = resolution.preview;

    if (!preview?.valid) {
      this.core.setPendingLinkSource(null);
      this.logger.info("Blocked pointer-follow placement commit.", {
        definitionId: session.placementDefinitionId,
        worldPoint: input.worldPoint,
        gridPoint: input.gridPoint,
        preview,
        invalidReason: resolution.invalidReason,
        hitEntityId: resolution.hitEntityId,
      });
      return false;
    }

    this.logger.info("Committed pointer-follow placement.", {
      definitionId: session.placementDefinitionId,
      worldPoint: input.worldPoint,
      gridPoint: input.gridPoint,
      preview,
    });
    this.core.placeEntity(session.placementDefinitionId, preview.gridPoint);
    return true;
  }

  clearPlacementPreview(): void {
    this.core.setPlacementPreview(null);
  }

  activateLinkTarget(entityId: string | null): void {
    this.handleLinkToolClick(entityId);
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

  private resolvePlacementPreview(
    input: CanvasWorldInput,
  ): PlacementPreviewResolution {
    const { document, session } = this.core.getSnapshot();

    if (!isPlacementTool(session.activeTool) || !session.placementDefinitionId) {
      return {
        preview: null,
        invalidReason: "inactive-tool",
        hitEntityId: null,
      };
    }

    const definition = this.getDefinition(session.placementDefinitionId);

    if (!definition) {
      return {
        preview: null,
        invalidReason: "missing-definition",
        hitEntityId: null,
      };
    }

    const base = getStage1BaseDefinition(document.baseId);
    const previewGridPoint = resolveCenteredPlacementGridPoint({
      worldPoint: input.worldPoint,
      gridSize: document.documentSettings.gridSize,
      footprint: definition.footprint,
    });
    const hitEntityId = this.measureProfilerStage("editor.hitTest", () =>
      hitTestWorldEntity(document, this.getTopology(), input.worldPoint),
    );
    const withinBase = isStage1FootprintWithinBase({
      base,
      position: previewGridPoint,
      footprint: definition.footprint,
    });
    const invalidReason =
      hitEntityId !== null
        ? "entity-collision"
        : withinBase
          ? null
          : "out-of-base";

    return {
      preview: {
        definitionId: session.placementDefinitionId,
        strategy: session.placementStrategy ?? "pointer-follow",
        gridPoint: previewGridPoint,
        rotation: 0,
        valid: invalidReason === null,
      },
      invalidReason,
      hitEntityId,
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
    const {
      document,
      session: { pendingLinkSourceEntityId },
    } = this.core.getSnapshot();

    if (!hitEntityId) {
      this.core.selectEntity(null);
      this.core.setPendingLinkSource(null);
      return;
    }

    if (!pendingLinkSourceEntityId) {
      this.core.selectEntity(hitEntityId);
      this.core.setPendingLinkSource(hitEntityId);
      return;
    }

    if (pendingLinkSourceEntityId === hitEntityId) {
      this.core.selectEntity(hitEntityId);
      this.core.setPendingLinkSource(null);
      return;
    }

    const resolvedPair = this.resolveDarkPipePair(
      pendingLinkSourceEntityId,
      hitEntityId,
    );

    if (!resolvedPair) {
      this.core.selectEntity(hitEntityId);
      this.core.setPendingLinkSource(hitEntityId);
      return;
    }

    const existingLink = getExplicitLinkBetween(
      document,
      resolvedPair.sourceEntityId,
      resolvedPair.targetEntityId,
    );

    if (existingLink) {
      this.core.removeLink(existingLink.id);
      this.core.selectEntity(hitEntityId);
      this.core.setPendingLinkSource(null);
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
