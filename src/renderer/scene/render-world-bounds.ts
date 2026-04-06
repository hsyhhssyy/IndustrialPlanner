import { getStage1BaseDefinition } from "@/domain/base/stage1-bases";
import type { WorldDocument } from "@/domain/document/world-document";
import {
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type {
  MovePreviewState,
  PlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

export interface RenderWorldBoundsPx {
  width: number;
  height: number;
}

interface DeriveRenderWorldBoundsPxOptions {
  document: WorldDocument;
  topology: CompiledTopology;
  registry: Stage1Registry;
  placementPreview: PlacementPreviewState | null;
  movePreview: MovePreviewState | null;
}

const RENDER_WORLD_PADDING_CELLS = 3;

function getPlacementPreviewBoundsPx(
  options: DeriveRenderWorldBoundsPxOptions,
): RenderWorldBoundsPx | null {
  const preview = options.movePreview ?? options.placementPreview;

  if (!preview) {
    return null;
  }

  const definition = getStage1EntityDefinition(
    options.registry,
    preview.definitionId,
  );

  if (!definition) {
    return null;
  }

  const { gridSize } = options.document.documentSettings;
  const footprint = getRotatedGridFootprint(
    definition.footprint,
    preview.rotation,
  );

  return {
    width:
      preview.gridPoint.x * gridSize +
      footprint.width * gridSize +
      gridSize * RENDER_WORLD_PADDING_CELLS,
    height:
      preview.gridPoint.y * gridSize +
      footprint.height * gridSize +
      gridSize * RENDER_WORLD_PADDING_CELLS,
  };
}

export function deriveRenderWorldBoundsPx(
  options: DeriveRenderWorldBoundsPxOptions,
): RenderWorldBoundsPx {
  const { document, topology, registry } = options;
  const { gridSize } = document.documentSettings;
  const base = getStage1BaseDefinition(document.baseId);
  const baseWorldSize = base.placeableSize * gridSize;
  const previewBounds = getPlacementPreviewBoundsPx(options);
  let width = Math.max(baseWorldSize, previewBounds?.width ?? 0);
  let height = Math.max(baseWorldSize, previewBounds?.height ?? 0);

  for (const entityId of document.entityOrder) {
    const entity = document.entities[entityId];
    const definition =
      topology.entityViews[entityId]?.definition ??
      (entity
        ? getStage1EntityDefinition(registry, entity.definitionId)
        : undefined);

    if (!entity || !definition) {
      continue;
    }

    const footprint = getRotatedGridFootprint(
      definition.footprint,
      entity.rotation,
    );

    width = Math.max(
      width,
      entity.position.x * gridSize +
        footprint.width * gridSize +
        gridSize * RENDER_WORLD_PADDING_CELLS,
    );
    height = Math.max(
      height,
      entity.position.y * gridSize +
        footprint.height * gridSize +
        gridSize * RENDER_WORLD_PADDING_CELLS,
    );
  }

  return {
    width,
    height,
  };
}
