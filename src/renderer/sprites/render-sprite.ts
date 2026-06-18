import { Container } from "pixi.js";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { AppTheme } from "@/domain/app/types/theme";
import type { GridRotation } from "@/shared/geometry/grid"

export type RenderLayerId = "background" | "entityLow" | "entity" | "entityHigh" | "logisticsBelt" | "logisticsPipe" | "draft" | "overlay";

export type BeltRenderSpriteId = "belt_straight_1x1" | "belt_turn_cw_1x1" | "belt_turn_ccw_1x1";

export type PipeRenderSpriteId = "pipe_straight_1x1" | "pipe_turn_cw_1x1" | "pipe_turn_ccw_1x1";

export type RenderSpriteId = BeltRenderSpriteId | PipeRenderSpriteId;

export interface RenderLayerMap {
  background: Container;
  entityLow: Container;
  entity: Container;
  entityHigh: Container;
  logisticsBelt: Container;
  logisticsPipe: Container;
  draft: Container;
  overlay: Container;
}

export interface RenderSpriteLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: GridRotation;
}

export interface RenderSpriteTimeContext {
  nowMs: number;
  deltaMs: number;
}

export interface RenderSpriteSyncContext {
  theme: AppTheme;
  workspace: WorkspaceContract;
  time: RenderSpriteTimeContext;
  suppressBelts: boolean;
  suppressPipes: boolean;
  /**
   * entityId → 该设备已连接的端口键集合("portGroupId:portId")。
   * 仅物流布设模式(activeTool="logistics-placement")下由 orchestrator 构建，其余模式为 null。
   * sprite 在物流模式下据此过滤已连接端口，不显示箭头或叉号。
   */
  logisticsPortOccupancy: ReadonlyMap<string, ReadonlySet<string>> | null;
  /** true 时端口提示由全局 PortOverlayDecoration 统一绘制。 */
  portOverlayManagedGlobally?: boolean;
}

export interface RenderSprite {
  attach(layers: RenderLayerMap): void;
  syncLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
