export {
  createRenderSurface,
  type RenderFrameTime,
  type RenderSurface,
  type RenderSurfaceScene,
} from "./render-surface"
// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// export {
//   createRenderSurfaceRegistry,
//   type RenderSurfaceLifecycleState,
//   type RenderSurfaceRegistry,
// } from "./render-surface-registry"

// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// export {
//   createBrowserRenderFrameDriver,
//   createRenderScheduler,
//   type RenderFrameDriver,
//   type RenderScheduler,
// } from "./render-scheduler"
