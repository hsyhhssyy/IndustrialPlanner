import type {
  GridEdge,
  GridPoint,
  GridRectSize,
  GridRotation,
} from "@/domain/shared/grid";

export interface LocalPortCellLike {
  readonly localCellX: number;
  readonly localCellY: number;
  readonly edge: GridEdge;
}

export interface RotatedPortGeometry {
  readonly cell: GridPoint;
  readonly edge: GridEdge;
  readonly delta: GridPoint;
  readonly anchor: {
    readonly x: number;
    readonly y: number;
  };
}

const GRID_EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

export function resolveRotatedPortGeometry(options: {
  readonly footprint: GridRectSize;
  readonly port: LocalPortCellLike;
  readonly rotation: GridRotation;
}): RotatedPortGeometry {
  const cell = rotateLocalPortCell({
    footprint: options.footprint,
    port: options.port,
    rotation: options.rotation,
  });
  const edge = rotateGridEdge(options.port.edge, options.rotation);
  const delta = resolveGridEdgeDelta(edge);

  return {
    cell,
    edge,
    delta,
    anchor: {
      x: cell.x + 0.5 + delta.x * 0.58,
      y: cell.y + 0.5 + delta.y * 0.58,
    },
  };
}

export function rotateLocalPortCell(options: {
  readonly footprint: GridRectSize;
  readonly port: Pick<LocalPortCellLike, "localCellX" | "localCellY">;
  readonly rotation: GridRotation;
}): GridPoint {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;

  switch (options.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
}

export function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const currentIndex = GRID_EDGE_ORDER.indexOf(edge);
  const steps = rotation / 90;
  return GRID_EDGE_ORDER[(currentIndex + steps) % GRID_EDGE_ORDER.length] ?? edge;
}

export function resolveGridEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}
