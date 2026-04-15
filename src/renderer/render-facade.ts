import type { CanvasPoint } from "@/workspace/workspace-state";

export interface RenderFacadeQuery {}

export interface RenderFacadeAction {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomCanvasAt: (screenPoint: CanvasPoint, scaleFactor: number) => void;
  panCanvasBy: (screenDelta: CanvasPoint) => void;
  setCanvasViewportSize: (size: CanvasPoint) => void;
}

export interface RenderFacade {
  readonly query: RenderFacadeQuery;
  readonly action: RenderFacadeAction;
}