import type { WorldDocument, WorldEntity } from "@/editor-core/document/world-document";
import {
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/industrial-domain/registry/stage1-registry";
import type {
  CompiledEntityView,
  CompiledTopology,
  TopologyDiagnostic,
} from "@/domain-compiler/compiled-topology";

function toCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function addFootprintToOccupancy(
  occupancyIndex: Record<string, string[]>,
  entity: WorldEntity,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellKey = toCellKey(entity.position.x + x, entity.position.y + y);
      occupancyIndex[cellKey] ??= [];
      occupancyIndex[cellKey].push(entity.id);
    }
  }
}

export function compileStage1World(
  document: WorldDocument,
  registry: Stage1Registry,
): CompiledTopology {
  const diagnostics: TopologyDiagnostic[] = [];
  const occupancyIndex: Record<string, string[]> = {};
  const entityViews: Record<string, CompiledEntityView> = {};

  let solidTransportNodes = 0;
  let liquidTransportNodes = 0;
  let warehouseBusNodes = 0;

  for (const entityId of document.entityOrder) {
    const entity = document.entities[entityId];

    if (!entity) {
      diagnostics.push({
        id: `missing-entity:${entityId}`,
        severity: "error",
        entityIds: [entityId],
        message: `Entity "${entityId}" is referenced by order but missing from document.`,
      });
      continue;
    }

    const definition = getStage1EntityDefinition(registry, entity.definitionId);

    if (!definition) {
      diagnostics.push({
        id: `missing-definition:${entity.id}`,
        severity: "error",
        entityIds: [entity.id],
        message: `Unknown definition "${entity.definitionId}".`,
      });
      continue;
    }

    entityViews[entity.id] = {
      entityId: entity.id,
      definition,
      position: entity.position,
    };

    addFootprintToOccupancy(
      occupancyIndex,
      entity,
      definition.footprint.width,
      definition.footprint.height,
    );

    if (definition.capabilityIds.includes("conveyor-track")) {
      solidTransportNodes += 1;
    }

    if (
      definition.capabilityIds.includes("pipe-track") ||
      definition.capabilityIds.includes("external-liquid-source")
    ) {
      liquidTransportNodes += 1;
    }

    if (definition.capabilityIds.includes("warehouse-bus")) {
      warehouseBusNodes += 1;
    }
  }

  for (const [cellKey, entityIds] of Object.entries(occupancyIndex)) {
    if (entityIds.length > 1) {
      diagnostics.push({
        id: `overlap:${cellKey}`,
        severity: "warning",
        entityIds,
        message: `Multiple entities overlap on grid cell ${cellKey}.`,
      });
    }
  }

  if (document.explicitLinks.length === 0) {
    diagnostics.push({
      id: "stage1-scaffold:missing-dark-links",
      severity: "info",
      entityIds: [],
      message:
        "Stage1 scaffold is ready. Dark pipe links, bus graphs and network diagnostics will be refined in later slices.",
    });
  }

  return {
    compileVersion: `${document.schemaVersion}:${document.entityOrder.length}:${document.explicitLinks.length}`,
    entityViews,
    occupancyIndex,
    graphSummary: {
      solidTransportNodes,
      liquidTransportNodes,
      warehouseBusNodes,
      explicitLinks: document.explicitLinks.length,
    },
    diagnostics,
  };
}
