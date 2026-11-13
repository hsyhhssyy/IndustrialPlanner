import { RenderAction } from "./render-action";
import { RenderQuery } from "./render-query";


export interface RenderContract {
  // AI-MODIFIED 2026-05-21: 对外暴露 renderer-owned DOM container；Pixi canvas 与 DOM overlay 都由 renderer 内部管理。
  // AI-CORRECTION 2026-11-12: container 现归每个 View 所有，通过 getViewContainer(handle) 查询。
// AI-REMOVED 2026-11-12:
// Reason: 渲染契约统一为 SceneSource 与独立 View，退出专用预览接口。
// Trigger: REQ-048 D5/D6 已确认整体迁移。
// Evidence: 所有图形消费者需要相同的时间、失效和生命周期语义。
// Replacement: RenderQuery.getViewContainer
// Risk: 旧调用方需整体迁移。
// Human Review: Required
// Original code:
//   container: HTMLDivElement;

  queries: RenderQuery;
  actions: RenderAction;
  destroy(): void;
}
