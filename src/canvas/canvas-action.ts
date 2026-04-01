export interface CanvasAction {
  type: "canvas.viewport.pan" | "canvas.viewport.zoom";
  payload: Record<string, unknown>;
}
