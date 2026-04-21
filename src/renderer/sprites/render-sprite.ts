import { Container } from "pixi.js";

export type RenderLayerId = "background" | "entity" | "overlay";

export type RenderSpriteId = "dummy-box";

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
}

export interface RenderSprite {
  attach(layers: RenderLayerMap): void;
  syncLayout(layout: RenderSpriteLayout): void;
  destroy(): void;
}