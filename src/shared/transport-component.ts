import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type {
  LogisticsDraftEndpoint,
  LogisticsKind,
  LogisticsPortDirection,
  LogisticsPortKind,
} from "@/domain/shared/logistics";

import { getRotatedGridFootprint } from "./geometry/grid";
import {
  resolveGridEdgeDelta,
  rotateGridEdge,
  rotateLocalPortCell,
} from "./geometry/port";

type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

export function collectConnectedStrictLogisticsEntityIds(options: {
  startEntityId: string;
  startEntity?: WorldEntity;
  kind?: LogisticsKind;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  isDedicatedLogisticsDevice: (definitionId: string) => boolean;
  resolveDedicatedLogisticsKind: (definitionId: string) => LogisticsKind | null;
  directions?: readonly LogisticsPortDirection[];
}): ReadonlySet<string> {
  const startEntity = options.startEntity ?? options.document.entities[options.startEntityId];
  if (startEntity === undefined) {
    return new Set();
  }

  if (!options.isDedicatedLogisticsDevice(startEntity.definitionId)) {
    return new Set();
  }

  const kind = options.kind ?? options.resolveDedicatedLogisticsKind(startEntity.definitionId);
  if (kind === null) {
    return new Set();
  }

  const directions = options.directions ?? ["input", "output"];
  const visited = new Set<string>();
  const connectedEntityIds = new Set<string>();
  const queue: string[] = [options.startEntityId];
  visited.add(options.startEntityId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const entity = currentId === options.startEntityId
      ? startEntity
      : options.document.entities[currentId];

    if (entity === undefined) {
      continue;
    }

    if (!options.isDedicatedLogisticsDevice(entity.definitionId)) {
      continue;
    }
    if (options.resolveDedicatedLogisticsKind(entity.definitionId) !== kind) {
      continue;
    }

    connectedEntityIds.add(currentId);

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    const adjacentCells = new Set<string>();
    for (const direction of directions) {
      const endpoints = resolveDevicePortEndpoints({
        entity,
        definition,
        kind,
        direction,
      });

      for (const endpoint of endpoints) {
        adjacentCells.add(`${endpoint.outsideGridPoint.x},${endpoint.outsideGridPoint.y}`);
      }
    }

    for (const key of adjacentCells) {
      const [cx, cy] = key.split(",").map(Number) as [number, number];
      const cellPoint: GridPoint = { x: cx, y: cy };

      for (const [otherId, otherEntity] of Object.entries(options.document.entities)) {
        if (visited.has(otherId)) {
          continue;
        }

        if (!options.isDedicatedLogisticsDevice(otherEntity.definitionId)) {
          continue;
        }
        if (options.resolveDedicatedLogisticsKind(otherEntity.definitionId) !== kind) {
          continue;
        }

        const otherDefinition = options.entityDefinitionMap.get(otherEntity.definitionId);
        if (otherDefinition === undefined) {
          continue;
        }

        if (
          isGridPointInsideRect(
            cellPoint,
            resolveEntityGridRect({ entity: otherEntity, definition: otherDefinition }),
          )
        ) {
          visited.add(otherId);
          queue.push(otherId);
        }
      }
    }
  }

  return connectedEntityIds;
}

function resolveDevicePortEndpoints(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
}): DevicePortEndpoint[] {
  const portKind = resolvePortKindForLogisticsKind(options.kind);
  const endpoints: DevicePortEndpoint[] = [];

  for (const portGroup of options.definition.portGroups) {
    if (portGroup.kind !== portKind || portGroup.direction !== options.direction) {
      continue;
    }

    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, options.entity.rotation);
      const insideGridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveGridEdgeDelta(edge);
      const outsideGridPoint = {
        x: insideGridPoint.x + delta.x,
        y: insideGridPoint.y + delta.y,
      };

      endpoints.push({
        type: "device-port",
        entityId: options.entity.id,
        portGroupId: portGroup.id,
        portId: port.id,
        portKind,
        portDirection: options.direction,
        insideGridPoint,
        outsideGridPoint,
        edge,
      });
    }
  }

  return endpoints;
}

function resolvePortKindForLogisticsKind(kind: LogisticsKind): LogisticsPortKind {
  return kind === "belt" ? "item" : "fluid";
}

function resolveEntityGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

function isGridPointInsideRect(point: GridPoint, rect: GridRect): boolean {
  return (
    point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height
  );
}
