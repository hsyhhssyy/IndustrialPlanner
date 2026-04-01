import type { CanvasPoint } from "@/canvas/canvas-host";
import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";

interface HitTestWorldEntityOptions {
  document: WorldDocument;
  topology: CompiledTopology;
  worldPoint: CanvasPoint;
}

export function hitTestWorldEntity(
  options: HitTestWorldEntityOptions,
): string | null {
  const { document, topology, worldPoint } = options;
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
