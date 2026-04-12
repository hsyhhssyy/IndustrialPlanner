import {
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import { isPlacementInteractionMode } from "@/editor/contracts/interaction-mode";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";
import type { CanvasPoint, WorkspaceState } from "@/workbench/workspace-state";

export interface RenderDerivedScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RenderDerivedCameraTransform {
  zoom: number;
  viewportOffset: CanvasPoint;
}

export interface RenderDerivedState {
  cellSizePx: number;
  worldBoundsPx: {
    width: number;
    height: number;
  };
  cameraTransform: RenderDerivedCameraTransform;
  anchoredPlacementScreenBox: RenderDerivedScreenBox | null;
  anchoredMoveScreenBox: RenderDerivedScreenBox | null;
  anchoredSelectionScreenBox: RenderDerivedScreenBox | null;
  marqueeScreenBox: RenderDerivedScreenBox | null;
}

export interface WorkspaceDerivedState {
  render: RenderDerivedState;
}

interface DeriveRenderDerivedStateOptions {
  workspaceState: WorkspaceState;
  topology: CompiledTopology;
  registry: Stage1Registry;
}

function projectGridFootprintScreenBox(options: {
  canvasView: WorkspaceState["canvasView"];
  gridSize: number;
  position: {
    x: number;
    y: number;
  };
  footprint: {
    width: number;
    height: number;
  };
}): RenderDerivedScreenBox {
  return {
    left:
      (options.position.x * options.gridSize - options.canvasView.offset.x) *
      options.canvasView.zoom,
    top:
      (options.position.y * options.gridSize - options.canvasView.offset.y) *
      options.canvasView.zoom,
    width: options.footprint.width * options.gridSize * options.canvasView.zoom,
    height: options.footprint.height * options.gridSize * options.canvasView.zoom,
  };
}

function projectGridBoundsScreenBox(options: {
  canvasView: WorkspaceState["canvasView"];
  gridSize: number;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}): RenderDerivedScreenBox {
  return {
    left:
      (options.bounds.left * options.gridSize - options.canvasView.offset.x) *
      options.canvasView.zoom,
    top:
      (options.bounds.top * options.gridSize - options.canvasView.offset.y) *
      options.canvasView.zoom,
    width: options.bounds.width * options.gridSize * options.canvasView.zoom,
    height: options.bounds.height * options.gridSize * options.canvasView.zoom,
  };
}

function deriveAnchoredPlacementScreenBox(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedScreenBox | null {
  const {
    workspaceState: { canvasView, document, editor, ui },
    registry,
  } = options;
  const preview = editor.session.placementPreview;

  if (ui.phase !== "edit" || !preview || preview.interactionMode !== "touch") {
    return null;
  }

  if (editor.session.draftEntities?.boundsDerived) {
    return projectGridBoundsScreenBox({
      canvasView,
      gridSize: document.documentSettings.gridSize,
      bounds: editor.session.draftEntities.boundsDerived,
    });
  }

  const definition = getStage1EntityDefinition(registry, preview.definitionId);

  if (!definition) {
    return null;
  }

  const { gridSize } = document.documentSettings;
  const footprint = getRotatedGridFootprint(
    definition.footprint,
    preview.rotation,
  );

  return projectGridFootprintScreenBox({
    canvasView,
    gridSize,
    position: preview.gridPoint,
    footprint,
  });
}

function deriveAnchoredSelectionScreenBox(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedScreenBox | null {
  const {
    workspaceState: { canvasView, document, editor, ui },
    topology,
    registry,
  } = options;
  const selectionMode = editor.session.currentMode;

  if (
    ui.phase !== "edit" ||
    selectionMode.key !== "select" ||
    isPlacementInteractionMode(editor.session.currentMode) ||
    editor.session.selectionInputMode !== "touch"
  ) {
    return null;
  }

  if (editor.session.selectedEntities?.boundsDerived) {
    return projectGridBoundsScreenBox({
      canvasView,
      gridSize: document.documentSettings.gridSize,
      bounds: editor.session.selectedEntities.boundsDerived,
    });
  }

  const bounds = getGridBoundingBox(
    editor.session.selection
      .map((entityId) => {
        const selectedEntity = document.entities[entityId];
        const definition =
          topology.entityViews[entityId]?.definition ??
          (selectedEntity
            ? getStage1EntityDefinition(registry, selectedEntity.definitionId)
            : undefined);

        if (!selectedEntity || !definition) {
          return null;
        }

        return {
          position: selectedEntity.position,
          footprint: getRotatedGridFootprint(
            definition.footprint,
            selectedEntity.rotation,
          ),
        };
      })
      .filter((area): area is NonNullable<typeof area> => area !== null),
  );

  if (!bounds) {
    return null;
  }

  return projectGridBoundsScreenBox({
    canvasView,
    gridSize: document.documentSettings.gridSize,
    bounds,
  });
}

function deriveAnchoredMoveScreenBox(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedScreenBox | null {
  const {
    workspaceState: { canvasView, document, editor, ui },
    topology,
    registry,
  } = options;
  const moveDraft = editor.session.moveDraft;

  if (
    ui.phase !== "edit" ||
    !moveDraft ||
    moveDraft.interactionMode !== "touch"
  ) {
    return null;
  }

  if (editor.session.draftEntities?.boundsDerived) {
    return projectGridBoundsScreenBox({
      canvasView,
      gridSize: document.documentSettings.gridSize,
      bounds: editor.session.draftEntities.boundsDerived,
    });
  }

  const bounds = getGridBoundingBox(
    moveDraft.entities
      .map((draftEntity) => {
        const entity = document.entities[draftEntity.entityId];
        const definition =
          topology.entityViews[draftEntity.entityId]?.definition ??
          (entity
            ? getStage1EntityDefinition(registry, entity.definitionId)
            : undefined);

        if (!entity || !definition) {
          return null;
        }

        return {
          position: draftEntity.gridPoint,
          footprint: getRotatedGridFootprint(
            definition.footprint,
            draftEntity.rotation,
          ),
        };
      })
      .filter((area): area is NonNullable<typeof area> => area !== null),
  );

  if (!bounds) {
    return null;
  }

  return projectGridBoundsScreenBox({
    canvasView,
    gridSize: document.documentSettings.gridSize,
    bounds,
  });
}

function deriveMarqueeScreenBox(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedScreenBox | null {
  const {
    workspaceState: { canvasView, document, editor, ui },
  } = options;
  const marqueeBounds =
    editor.session.marqueeRange?.bounds ?? editor.session.marqueeDraft?.bounds;

  if (ui.phase !== "edit" || !marqueeBounds) {
    return null;
  }

  return projectGridBoundsScreenBox({
    canvasView,
    gridSize: document.documentSettings.gridSize,
    bounds: marqueeBounds,
  });
}

export function deriveRenderDerivedState(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedState {
  const {
    workspaceState: { canvasView, document, editor, ui },
    topology,
    registry,
  } = options;
  const worldBoundsPx = deriveRenderWorldBoundsPx({
    document,
    topology,
    registry,
    placementPreview: ui.phase === "edit" ? editor.session.placementPreview : null,
    moveDraft: ui.phase === "edit" ? editor.session.moveDraft : null,
  });

  return {
    cellSizePx: document.documentSettings.gridSize * canvasView.zoom,
    worldBoundsPx,
    cameraTransform: {
      zoom: canvasView.zoom,
      viewportOffset: canvasView.offset,
    },
    anchoredPlacementScreenBox: deriveAnchoredPlacementScreenBox(options),
    anchoredMoveScreenBox: deriveAnchoredMoveScreenBox(options),
    anchoredSelectionScreenBox: deriveAnchoredSelectionScreenBox(options),
    marqueeScreenBox: deriveMarqueeScreenBox(options),
  };
}

export function deriveWorkspaceDerivedState(
  options: DeriveRenderDerivedStateOptions,
): WorkspaceDerivedState {
  return {
    render: deriveRenderDerivedState(options),
  };
}
