import type { RegionAnnotation } from "../../document/region-annotation";
import type { GridRect } from "../../shared/grid";

export type RegionRectOperation = "add" | "subtract";

export interface RegionMoveChange {
  readonly regionId: string;
  readonly enteredCount: number;
  readonly exitedCount: number;
  readonly boundaryCount: number;
}

export interface RegionMoveFeedback {
  readonly phase: "preview" | "committed";
  readonly changes: readonly RegionMoveChange[];
}

export interface RegionAnnotationEditorState {
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly hiddenIds: readonly string[];
  readonly draft: RegionAnnotation | null;
  readonly draftOperation: RegionRectOperation;
  readonly draftMarqueeGridRect: GridRect | null;
  readonly placementPreview: readonly RegionAnnotation[];
  readonly moveFeedback: RegionMoveFeedback | null;
}
