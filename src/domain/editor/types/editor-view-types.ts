import type { WorldDocumentViewportSettings } from "../../document/world-document";
import type { CanvasOperationAvailability, CanvasOperationId } from "../../shared/canvas-operation";
import type { ClientPixelPoint } from "../../shared/client-pixel";
import type { GridRect } from "../../shared/grid";
import type { SceneBounds } from "../../shared/scene-space";

export type { ClientPixelPoint, ClientPixelRect } from "../../shared/client-pixel";
export type { GridFloatPoint, GridPoint, GridRect, GridRotation } from "../../shared/grid";

export type EditorViewBoundsPolicy =
  | { readonly kind: "space"; readonly bounds: SceneBounds; readonly padding: number }
  | { readonly kind: "content"; readonly content: GridRect; readonly padding: number; readonly maxAutoZoom: number };

export interface EditorViewOptions {
  readonly id: string;
  readonly initialViewport: WorldDocumentViewportSettings;
  readonly bounds: EditorViewBoundsPolicy;
  readonly getOperationAvailability: (operation: CanvasOperationId) => CanvasOperationAvailability;
}

export interface MoveViewportByClientPixelVectorOptions {
  readonly startClientPixel: ClientPixelPoint;
  readonly endClientPixel: ClientPixelPoint;
}

export interface ViewFocusOptions {
  readonly durationMs?: number;
  readonly gridSize?: number;
}
