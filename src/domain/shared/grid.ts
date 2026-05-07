export type GridRotation = 0 | 90 | 180 | 270;

export type GridEdge = "NORTH" | "EAST" | "SOUTH" | "WEST";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface GridFloatPoint {
  readonly x: number;
  readonly y: number;
}

export interface GridRectSize {
  readonly width: number;
  readonly height: number;
}

export interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
