import type { AppTheme } from "@/domain/app/types/theme";
import type { GridRotation } from "@/domain/shared/grid";
import type { RenderHost } from "@/renderer/renderer-host";

export interface RenderViewportState {
  width: number;
  height: number;
  resolution: number;
  centerX: number;
  centerY: number;
  gridCellPixelSize: number;
  displayRotation: GridRotation;
}

export interface DecorationViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DecorationProfiler {
  count(name: string, value?: number): void;
  measure<T>(stage: string, callback: () => T): T;
}

export interface DecorationSyncContext {
  viewportState: RenderViewportState;
  viewportBounds: DecorationViewportBounds;
  renderHost: RenderHost;
  theme: AppTheme;
  nowMs: number;
  profiler?: DecorationProfiler;
}
