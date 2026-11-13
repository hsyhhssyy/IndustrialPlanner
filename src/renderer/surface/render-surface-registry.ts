// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// import type { RenderSurface } from "./render-surface"
//
// export type RenderSurfaceLifecycleState = "initializing" | "active" | "disposed"
//
// interface RenderSurfaceEntry {
//   readonly id: string
//   state: RenderSurfaceLifecycleState
//   surface: RenderSurface | null
// }
//
// export interface RenderSurfaceRegistry {
//   beginInitializing(id: string): void
//   activate(surface: RenderSurface): boolean
//   dispose(id: string): void
//   get(id: string): RenderSurface | null
//   listActive(): readonly RenderSurface[]
//   getState(id: string): RenderSurfaceLifecycleState | null
//   destroy(): void
// }
//
// export function createRenderSurfaceRegistry(): RenderSurfaceRegistry {
//   const entries = new Map<string, RenderSurfaceEntry>()
//   let destroyed = false
//
//   return {
//     beginInitializing: (id) => {
//       if (destroyed) {
//         throw new Error("Cannot initialize a render surface after registry destruction.")
//       }
//       if (entries.has(id)) {
//         throw new Error(`Render surface already exists: ${id}`)
//       }
//
//       entries.set(id, {
//         id,
//         state: "initializing",
//         surface: null,
//       })
//     },
//     activate: (surface) => {
//       const entry = entries.get(surface.id)
//       if (destroyed || entry === undefined || entry.state !== "initializing") {
//         surface.destroy()
//         return false
//       }
//
//       entry.surface = surface
//       entry.state = "active"
//       return true
//     },
//     dispose: (id) => {
//       const entry = entries.get(id)
//       if (entry === undefined || entry.state === "disposed") {
//         return
//       }
//
//       entry.state = "disposed"
//       const surface = entry.surface
//       entry.surface = null
//       entries.delete(id)
//       surface?.destroy()
//     },
//     get: (id) => {
//       const entry = entries.get(id)
//       return entry?.state === "active" ? entry.surface : null
//     },
//     listActive: () => [...entries.values()].flatMap((entry) => (
//       entry.state === "active" && entry.surface !== null ? [entry.surface] : []
//     )),
//     getState: (id) => entries.get(id)?.state ?? null,
//     destroy: () => {
//       if (destroyed) {
//         return
//       }
//
//       destroyed = true
//       const destroyErrors: unknown[] = []
//       for (const entry of entries.values()) {
//         entry.state = "disposed"
//         try {
//           entry.surface?.destroy()
//         } catch (error) {
//           destroyErrors.push(error)
//         }
//         entry.surface = null
//       }
//       entries.clear()
//       if (destroyErrors.length > 0) {
//         throw destroyErrors[0]
//       }
//     },
//   }
// }
//
