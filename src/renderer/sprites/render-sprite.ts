import { Container } from "pixi.js";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { AppTheme } from "@/domain/app/types/theme";
import type { GridRotation } from "@/shared/geometry/grid"

export type RenderLayerId = "background" | "entity" | "overlay";

export type BeltRenderSpriteId = "belt_straight_1x1" | "belt_turn_cw_1x1" | "belt_turn_ccw_1x1";

export type PipeRenderSpriteId = "pipe_straight_1x1" | "pipe_turn_cw_1x1" | "pipe_turn_ccw_1x1";

export type RenderSpriteId = BeltRenderSpriteId | PipeRenderSpriteId;

export interface RenderLayerMap {
  background: Container;
  entity: Container;
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
}

export interface RenderSprite {
  attach(layers: RenderLayerMap): void;
  syncLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void;
  destroy(): void;
}
