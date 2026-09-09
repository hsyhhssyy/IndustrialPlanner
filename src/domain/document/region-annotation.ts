import type { GridRect } from "../shared/grid";

export interface RegionAnnotation {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly rects: readonly GridRect[];
}
