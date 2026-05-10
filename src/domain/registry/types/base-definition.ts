import type { GridRectSize } from "../../shared/grid";

export interface BaseOuterRingDefinition {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BaseDefinition {
  id: string;
  name: string;
  placeableArea: GridRectSize;
  outerRing: BaseOuterRingDefinition;
  tag: string;
}
