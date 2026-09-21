import { describe, expect, it, vi } from "vitest"

import {
  createRenderScheduler,
  createRenderSurface,
  createRenderSurfaceRegistry,
  type RenderFrameDriver,
  type RenderSurface,
} from "@/renderer/surface"

function createManualFrameDriver(): RenderFrameDriver & {
  readonly callbacks: FrameRequestCallback[]
} {
  const callbacks: FrameRequestCallback[] = []
  return {
    callbacks,
    request: (callback) => {
      callbacks.push(callback)
      return callbacks.length
    },
    cancel: vi.fn(),
  }
}

function createFakeSurface(id: string): RenderSurface {
  return {
    id,
    app: {} as RenderSurface["app"],
    canvas: document.createElement("canvas"),
    renderFrame: vi.fn(),
    destroy: vi.fn(),
  }
}

describe("RenderSurface lifecycle", () => {
  it("renders every active surface in stable registration order and advances the host once", () => {
    const registry = createRenderSurfaceRegistry()
    const first = createFakeSurface("first")
    const second = createFakeSurface("second")
    registry.beginInitializing(first.id)
    registry.beginInitializing(second.id)
    registry.activate(first)
    registry.activate(second)

    const frameDriver = createManualFrameDriver()
    const advanceHostFrame = vi.fn()
    const scheduler = createRenderScheduler({
      listActiveSurfaces: registry.listActive,
      advanceHostFrame,
      frameDriver,
    })

    scheduler.start()
    frameDriver.callbacks.shift()?.(100)

    expect(advanceHostFrame).toHaveBeenCalledTimes(1)
    expect(first.renderFrame).toHaveBeenCalledTimes(1)
    expect(second.renderFrame).toHaveBeenCalledTimes(1)
    expect(first.renderFrame).toHaveBeenCalledWith({
      nowMs: 100,
      deltaMs: 1000 / 60,
    })
    expect(second.renderFrame).toHaveBeenCalledWith({
      nowMs: 100,
      deltaMs: 1000 / 60,
    })

    scheduler.destroy()
  })

  it("destroys a late surface immediately when initialization was already disposed", () => {
    const registry = createRenderSurfaceRegistry()
    const surface = createFakeSurface("late-preview")

    registry.beginInitializing(surface.id)
    registry.dispose(surface.id)

    expect(registry.activate(surface)).toBe(false)
    expect(surface.destroy).toHaveBeenCalledTimes(1)
    expect(registry.get(surface.id)).toBeNull()
  })

  it("destroys every registered surface even when one teardown fails", () => {
    const registry = createRenderSurfaceRegistry()
    const failure = new Error("first surface failed")
    const first = createFakeSurface("first")
    const second = createFakeSurface("second")
    vi.mocked(first.destroy).mockImplementation(() => {
      throw failure
    })
    registry.beginInitializing(first.id)
    registry.activate(first)
    registry.beginInitializing(second.id)
    registry.activate(second)

    expect(() => registry.destroy()).toThrow(failure)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(second.destroy).toHaveBeenCalledTimes(1)
    expect(registry.listActive()).toEqual([])
    expect(() => registry.destroy()).not.toThrow()
  })

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
