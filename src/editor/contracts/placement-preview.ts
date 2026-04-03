import type { GridPoint, GridRotation } from "@/shared/geometry/grid";

export type PlacementPreviewStrategy = "pointer-follow" | "anchored-confirm";

export interface PlacementPreviewState {
  definitionId: string;
  strategy: PlacementPreviewStrategy;
  gridPoint: GridPoint;
  rotation: GridRotation;
  valid: boolean;
}