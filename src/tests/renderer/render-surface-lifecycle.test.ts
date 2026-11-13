import { describe, expect, it, vi } from "vitest"

// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// import {
//   createRenderScheduler,
//   createRenderSurface,
//   createRenderSurfaceRegistry,
//   type RenderFrameDriver,
//   type RenderSurface,
// } from "@/renderer/surface"
import { createRenderSurface, type RenderSurface } from "@/renderer/surface"

// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// function createManualFrameDriver(): RenderFrameDriver & {
//   readonly callbacks: FrameRequestCallback[]
// } {
//   const callbacks: FrameRequestCallback[] = []
//   return {
//     callbacks,
//     request: (callback) => {
//       callbacks.push(callback)
//       return callbacks.length
//     },
//     cancel: vi.fn(),
//   }
// }


// AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// function createFakeSurface(id: string): RenderSurface {
//   return {
//     id,
//     app: {} as RenderSurface["app"],
//     canvas: document.createElement("canvas"),
//     renderFrame: vi.fn(),
//     needsContinuousFrame: () => false,
//     destroy: vi.fn(),
//   }
// }


describe("RenderSurface lifecycle", () => {
  // AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// it("renders every active surface in stable registration order and advances the host once", () => {
//     const registry = createRenderSurfaceRegistry()
//     const first = createFakeSurface("first")
//     const second = createFakeSurface("second")
//     registry.beginInitializing(first.id)
//     registry.beginInitializing(second.id)
//     registry.activate(first)
//     registry.activate(second)
//
//     const frameDriver = createManualFrameDriver()
//     const advanceHostFrame = vi.fn()
//     const scheduler = createRenderScheduler({
//       listActiveSurfaces: registry.listActive,
//       advanceHostFrame,
//       frameDriver,
//     })
//
//     scheduler.start()
//     frameDriver.callbacks.shift()?.(100)
//
//     expect(advanceHostFrame).toHaveBeenCalledTimes(1)
//     expect(first.renderFrame).toHaveBeenCalledTimes(1)
//     expect(second.renderFrame).toHaveBeenCalledTimes(1)
//     expect(first.renderFrame).toHaveBeenCalledWith({
//       nowMs: 100,
//       deltaMs: 1000 / 60,
//     })
//     expect(second.renderFrame).toHaveBeenCalledWith({
//       nowMs: 100,
//       deltaMs: 1000 / 60,
//     })
//
//     scheduler.destroy()
//   })


  // AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// it("destroys a late surface immediately when initialization was already disposed", () => {
//     const registry = createRenderSurfaceRegistry()
//     const surface = createFakeSurface("late-preview")
//
//     registry.beginInitializing(surface.id)
//     registry.dispose(surface.id)
//
//     expect(registry.activate(surface)).toBe(false)
//     expect(surface.destroy).toHaveBeenCalledTimes(1)
//     expect(registry.get(surface.id)).toBeNull()
//   })


  // AI-REMOVED 2026-11-12:
// Reason: 全局持续 scheduler/registry 已被逐 View 生命周期和调用方帧驱动替代。
// Trigger: REQ-048 固定时间、挂起恢复、显式更新与播放 owner 分离。
// Evidence: 当前生产入口只有 createRenderHost，旧实现仅由退出的预览测试引用。
// Replacement: renderer-host.tsx、shared/timing 与 renderer-host.test.ts 的顺序/取消/释放用例。
// Risk: 跨 View 资源共享仍须真实浏览器验收；Human Review: Required
// Original code:
// it("destroys every registered surface even when one teardown fails", () => {
//     const registry = createRenderSurfaceRegistry()
//     const failure = new Error("first surface failed")
//     const first = createFakeSurface("first")
//     const second = createFakeSurface("second")
//     vi.mocked(first.destroy).mockImplementation(() => {
//       throw failure
//     })
//     registry.beginInitializing(first.id)
//     registry.activate(first)
//     registry.beginInitializing(second.id)
//     registry.activate(second)
//
//     expect(() => registry.destroy()).toThrow(failure)
//     expect(first.destroy).toHaveBeenCalledTimes(1)
//     expect(second.destroy).toHaveBeenCalledTimes(1)
//     expect(registry.listActive()).toEqual([])
//     expect(() => registry.destroy()).not.toThrow()
//   })


  it("owns scene, render, and resource teardown as one idempotent surface boundary", () => {
    const calls: string[] = []
    const scene = {
      sync: vi.fn(() => calls.push("sync")),
      beforeRender: vi.fn(() => calls.push("before-render")),
      afterRender: vi.fn(() => calls.push("after-render")),
      destroy: vi.fn(() => calls.push("scene-destroy")),
    }
    const app = {
      canvas: document.createElement("canvas"),
      render: vi.fn(() => calls.push("render")),
    } as unknown as RenderSurface["app"]
    const destroyResources = vi.fn(() => calls.push("resources-destroy"))
    const surface = createRenderSurface({
      id: "surface",
      app,
      scene,
      destroyResources,
    })

    surface.renderFrame({ nowMs: 10, deltaMs: 5 })
    surface.destroy()
    surface.destroy()

    expect(calls).toEqual([
      "sync",
      "before-render",
      "render",
      "after-render",
      "scene-destroy",
      "resources-destroy",
    ])
    expect(scene.destroy).toHaveBeenCalledTimes(1)
    expect(destroyResources).toHaveBeenCalledTimes(1)
  })

  it("releases renderer resources even when scene teardown fails", () => {
    const failure = new Error("scene teardown failed")
    const destroyResources = vi.fn()
    const surface = createRenderSurface({
      id: "failing-surface",
      app: {
        canvas: document.createElement("canvas"),
        render: vi.fn(),
      } as unknown as RenderSurface["app"],
      scene: {
        sync: vi.fn(),
        destroy: vi.fn(() => {
          throw failure
        }),
      },
      destroyResources,
    })

    expect(() => surface.destroy()).toThrow(failure)
    expect(destroyResources).toHaveBeenCalledTimes(1)
    expect(() => surface.destroy()).not.toThrow()
  })
})
