import type { RenderHost } from "@/renderer/renderer-host";

export interface RenderViewportState {
  width: number;
  height: number;
  resolution: number;
  centerX: number;
  centerY: number;
  gridCellPixelSize: number;
}

export interface DecorationViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DecorationSyncContext {
  viewportState: RenderViewportState;
  viewportBounds: DecorationViewportBounds;
  renderHost: RenderHost;
  nowMs: number;
}
