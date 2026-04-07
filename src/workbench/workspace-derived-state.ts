import {
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import { isPlacementInteractionMode } from "@/editor/contracts/interaction-mode";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
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
  anchoredSelectionScreenBox: RenderDerivedScreenBox | null;
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
  } = options;
  const selectionMode = editor.session.currentMode;

  if (
    ui.phase !== "edit" ||
    selectionMode.key !== "select" ||
    isPlacementInteractionMode(editor.session.currentMode) ||
    editor.session.selectionInputMode !== "touch" ||
    editor.session.selection.length !== 1
  ) {
    return null;
  }

  const selectedEntityId = editor.session.selection[0];

  if (!selectedEntityId) {
    return null;
  }

  const selectedEntity = document.entities[selectedEntityId];
  const definition = topology.entityViews[selectedEntityId]?.definition;

  if (!selectedEntity || !definition) {
    return null;
  }

  return projectGridFootprintScreenBox({
    canvasView,
    gridSize: document.documentSettings.gridSize,
    position: selectedEntity.position,
    footprint: getRotatedGridFootprint(
      definition.footprint,
      selectedEntity.rotation,
    ),
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
  });

  return {
    cellSizePx: document.documentSettings.gridSize * canvasView.zoom,
    worldBoundsPx,
    cameraTransform: {
      zoom: canvasView.zoom,
      viewportOffset: canvasView.offset,
    },
    anchoredPlacementScreenBox: deriveAnchoredPlacementScreenBox(options),
    anchoredSelectionScreenBox: deriveAnchoredSelectionScreenBox(options),
  };
}

export function deriveWorkspaceDerivedState(
  options: DeriveRenderDerivedStateOptions,
): WorkspaceDerivedState {
  return {
    render: deriveRenderDerivedState(options),
  };
}
