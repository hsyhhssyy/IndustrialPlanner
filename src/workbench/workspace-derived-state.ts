import {
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
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
}

export interface WorkspaceDerivedState {
  render: RenderDerivedState;
}

interface DeriveRenderDerivedStateOptions {
  workspaceState: WorkspaceState;
  topology: CompiledTopology;
  registry: Stage1Registry;
}

function deriveAnchoredPlacementScreenBox(
  options: DeriveRenderDerivedStateOptions,
): RenderDerivedScreenBox | null {
  const {
    workspaceState: { canvasView, document, editor, ui },
    registry,
  } = options;
  const preview = editor.session.placementPreview;

  if (ui.mode !== "edit" || !preview || preview.strategy !== "anchored-confirm") {
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

  return {
    left: (preview.gridPoint.x * gridSize - canvasView.offset.x) * canvasView.zoom,
    top: (preview.gridPoint.y * gridSize - canvasView.offset.y) * canvasView.zoom,
    width: footprint.width * gridSize * canvasView.zoom,
    height: footprint.height * gridSize * canvasView.zoom,
  };
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
    placementPreview: ui.mode === "edit" ? editor.session.placementPreview : null,
  });

  return {
    cellSizePx: document.documentSettings.gridSize * canvasView.zoom,
    worldBoundsPx,
    cameraTransform: {
      zoom: canvasView.zoom,
      viewportOffset: canvasView.offset,
    },
    anchoredPlacementScreenBox: deriveAnchoredPlacementScreenBox(options),
  };
}

export function deriveWorkspaceDerivedState(
  options: DeriveRenderDerivedStateOptions,
): WorkspaceDerivedState {
  return {
    render: deriveRenderDerivedState(options),
  };
}
