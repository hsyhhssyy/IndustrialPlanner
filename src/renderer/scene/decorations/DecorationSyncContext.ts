import type { Container } from "pixi.js";
import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from "@/shared/logistics-material";
import type { AppTheme } from "@/domain/app/types/theme";
import type { GridRotation } from "@/domain/shared/grid";
// AI-REMOVED 2026-10-13:
// Reason: 统一设备范围声明、几何和交互处理，替代中心正方形专用实现。
// Trigger: 洒水机和定向离体区域支持。
// Evidence: Search-First 确认旧电力、气体各自重复计算范围。
// Replacement: src/renderer/ranges。
// Risk: 保持既有供电与气体规则，需范围回归验证。
// Human Review: Required
// Original code:
// import type { PowerInteractionVisualState } from "@/renderer/power-interaction-visual-state";
import type { RenderSurfaceContext } from "@/renderer/render-surface-context";

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
  renderHost: RenderSurfaceContext;
  theme: AppTheme;
  nowMs: number;
  /** 已由高度特效接管的实际端口，加载完成后撤下旧虚影。 */
  buildingEffectPortKeys?: ReadonlySet<string>;
  logisticsMaterials?: LogisticsMaterialFrameState;
  createLogisticsMaterialView?: (
    assets: Awaited<ReturnType<RenderSurfaceContext["textureManager"]["acquireLogisticsDynamic"]>["ready"]>,
    state: LogisticsMaterialEntityState,
    isCurrent: () => boolean,
  ) => Promise<{
    root: Container;
    sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void;
    destroy(): void;
  } | null>;
// AI-REMOVED 2026-10-13:
// Reason: 统一设备范围声明、几何和交互处理，替代中心正方形专用实现。
// Trigger: 洒水机和定向离体区域支持。
// Evidence: Search-First 确认旧电力、气体各自重复计算范围。
// Replacement: src/renderer/ranges。
// Risk: 保持既有供电与气体规则，需范围回归验证。
// Human Review: Required
// Original code:
//   powerInteractionVisualState?: PowerInteractionVisualState;

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
