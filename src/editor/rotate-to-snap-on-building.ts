import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  PLACEMENT_BEHAVIOR_TYPE,
  type EntityPlacementBehaviorDeclaration,
} from "@/domain/registry/types/entity-placement-behavior";
import type { GridEdge, GridRect } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveGridEdgeDelta, rotateGridEdge } from "@/shared/geometry/port";

type RotateToSnapOnBuildingBehavior = Extract<
  EntityPlacementBehaviorDeclaration,
  { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.rotateToSnapOnBuilding }
>;

export interface BuildingShapeEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
}

export function resolveRotateToSnapOnBuildingBehavior(
  definition: EntityDefinition,
): RotateToSnapOnBuildingBehavior | null {
  return definition.placementBehaviors.find(
    (behavior): behavior is RotateToSnapOnBuildingBehavior =>
      behavior.type === PLACEMENT_BEHAVIOR_TYPE.rotateToSnapOnBuilding,
  ) ?? null;
}

export function isEntitySnappedToBuildingShape(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly targetEntries: readonly BuildingShapeEntry[];
}): boolean {
  const oppositePortEdge = resolveOppositePortWorldEdge({
    definition: options.definition,
    rotation: options.entity.rotation,
  });
  if (oppositePortEdge === null) {
    return false;
  }

  const candidateRect = resolveEntityGridRect(options.entity, options.definition);
  if (!isIntegerGridRect(candidateRect)) {
    return false;
  }

  const occupiedTargetCells = resolveOccupiedTargetCells(
    options.targetEntries.filter((entry) => entry.entity.id !== options.entity.id),
  );
  if (occupiedTargetCells.size === 0 || doesRectOverlapOccupiedCells(
    candidateRect,
    occupiedTargetCells,
  )) {
    return false;
  }

  return doesRectEdgeTouchOccupiedCells({
    rect: candidateRect,
    edge: oppositePortEdge,
    occupiedCells: occupiedTargetCells,
  });
}

function resolveOppositePortWorldEdge(options: {
  readonly definition: EntityDefinition;
  readonly rotation: WorldEntity["rotation"];
}): GridEdge | null {
  const portEdges = new Set(
    options.definition.portGroups.flatMap((portGroup) =>
      portGroup.ports.map((port) => port.edge),
    ),
  );
  if (portEdges.size !== 1) {
    return null;
  }

  const portEdge = portEdges.values().next().value;
  if (portEdge === undefined) {
    return null;
  }

  return oppositeGridEdge(rotateGridEdge(portEdge, options.rotation));
}

function resolveOccupiedTargetCells(
  entries: readonly BuildingShapeEntry[],
): Set<string> {
  const occupiedCells = new Set<string>();

  for (const entry of entries) {
    const rect = resolveEntityGridRect(entry.entity, entry.definition);
    if (!isIntegerGridRect(rect)) {
      continue;
    }

    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        occupiedCells.add(gridCellKey(x, y));
      }
    }
  }

  return occupiedCells;
}

function resolveEntityGridRect(
  entity: WorldEntity,
  definition: EntityDefinition,
): GridRect {
  const footprint = getRotatedGridFootprint(definition.footprint, entity.rotation);

  return {
    x: entity.position.x,
    y: entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

function doesRectOverlapOccupiedCells(
  rect: GridRect,
  occupiedCells: ReadonlySet<string>,
): boolean {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (occupiedCells.has(gridCellKey(x, y))) {
        return true;
      }
    }
  }

  return false;
}

function doesRectEdgeTouchOccupiedCells(options: {
  readonly rect: GridRect;
  readonly edge: GridEdge;
  readonly occupiedCells: ReadonlySet<string>;
}): boolean {
  const delta = resolveGridEdgeDelta(options.edge);
  const edgeCells = resolveRectEdgeCells(options.rect, options.edge);

  return edgeCells.some((cell) => options.occupiedCells.has(gridCellKey(
    cell.x + delta.x,
    cell.y + delta.y,
  )));
}

function resolveRectEdgeCells(
  rect: GridRect,
  edge: GridEdge,
): Array<{ readonly x: number; readonly y: number }> {
  const cells: Array<{ x: number; y: number }> = [];

  if (edge === "NORTH" || edge === "SOUTH") {
    const y = edge === "NORTH" ? rect.y : rect.y + rect.height - 1;
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      cells.push({ x, y });
    }
    return cells;
  }

  const x = edge === "WEST" ? rect.x : rect.x + rect.width - 1;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    cells.push({ x, y });
  }
  return cells;
}

function oppositeGridEdge(edge: GridEdge): GridEdge {
  switch (edge) {
    case "NORTH":
      return "SOUTH";
    case "EAST":
      return "WEST";
    case "SOUTH":
      return "NORTH";
    case "WEST":
      return "EAST";
  }
}

function isIntegerGridRect(rect: GridRect): boolean {
  return (
    Number.isInteger(rect.x)
    && Number.isInteger(rect.y)
    && Number.isInteger(rect.width)
    && Number.isInteger(rect.height)
    && rect.width > 0
    && rect.height > 0
  );
}

function gridCellKey(x: number, y: number): string {
  return `${x},${y}`;
}
