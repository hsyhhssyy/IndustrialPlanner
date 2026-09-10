import type { Container } from "pixi.js";
import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from "@/shared/logistics-material";
import type { AppTheme } from "@/domain/app/types/theme";
import type { GridRotation } from "@/domain/shared/grid";
import type { PowerInteractionVisualState } from "@/renderer/power-interaction-visual-state";
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
  logisticsMaterials?: LogisticsMaterialFrameState;
  createLogisticsMaterialView?: (
    assets: Awaited<ReturnType<RenderHost["textureManager"]["acquireLogisticsDynamic"]>["ready"]>,
    state: LogisticsMaterialEntityState,
    isCurrent: () => boolean,
  ) => Promise<{
    root: Container;
    sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void;
    destroy(): void;
  } | null>;
  powerInteractionVisualState?: PowerInteractionVisualState;
  profiler?: DecorationProfiler;
  /** renderer 内部维护的分层失效版本。 */
  versions?: {
    readonly document: number;
    readonly viewport: number;
    readonly collections: number;
    readonly presentation: number;
    readonly simulation: number;
  };
}
