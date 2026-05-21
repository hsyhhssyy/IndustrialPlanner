import { RenderAction } from "./render-action";
import { RenderQuery } from "./render-query";


export interface RenderContract {
  // AI-MODIFIED 2026-05-21: 对外暴露 renderer-owned DOM container；Pixi canvas 与 DOM overlay 都由 renderer 内部管理。
  container: HTMLDivElement;
  queries: RenderQuery;
  actions: RenderAction;
  destroy(): void;
}
