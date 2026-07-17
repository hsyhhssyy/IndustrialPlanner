import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createPixiRenderDiagnostics,
  PIXI_RENDER_ANTIALIAS_STORAGE_KEY,
  PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY,
  resolveMainRendererAntialias,
} from "@/renderer/pixi-render-diagnostics"

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(PIXI_RENDER_ANTIALIAS_STORAGE_KEY)
  localStorage.removeItem(PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY)
})

describe("resolveMainRendererAntialias", () => {
  it("only honors the antialias override while debug mode is enabled", () => {
    localStorage.setItem(PIXI_RENDER_ANTIALIAS_STORAGE_KEY, "off")
    const getItem = vi.spyOn(Storage.prototype, "getItem")

    expect(resolveMainRendererAntialias(false)).toBe(true)
    expect(getItem).not.toHaveBeenCalled()
    expect(resolveMainRendererAntialias(true)).toBe(false)

    localStorage.setItem(PIXI_RENDER_ANTIALIAS_STORAGE_KEY, "on")
    expect(resolveMainRendererAntialias(true)).toBe(true)
  })
})

describe("createPixiRenderDiagnostics", () => {
  it("installs hooks only in debug mode, records one render, and restores all state", () => {
    const draw = vi.fn()
    const batchBreak = vi.fn()
    const updateGpuContext = vi.fn((context: { dirty: boolean }) => {
      context.dirty = false
      return {}
    })
    const rebuildGraphics = vi.fn()
    const executeStencilMask = vi.fn()
    const executeAlphaMask = vi.fn()
    const pipeFlow = createVisibilityTarget()
    const samples = new Map<string, number>()
    const app = {
      renderer: {
        uid: 7,
        resolution: 2,
        screen: { width: 640, height: 360 },
        canvas: { width: 1280, height: 720 },
        view: { antialias: true },
        geometry: { draw },
        graphicsContext: { updateGpuContext },
        renderPipes: {
          batch: { break: batchBreak },
          graphics: { _rebuild: rebuildGraphics },
          stencilMask: { execute: executeStencilMask },
          alphaMask: { execute: executeAlphaMask },
        },
      },
    }
    const stage = {
      visible: true,
      children: [],
    }
    localStorage.setItem(PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY, "without-pipe-flow")
    const getItem = vi.spyOn(Storage.prototype, "getItem")

    const diagnostics = createPixiRenderDiagnostics({
      app: app as never,
      layers: {
        stage: stage as never,
        pipeFlow: pipeFlow as never,
        beltFlow: createVisibilityTarget() as never,
        beltInsertion: createVisibilityTarget() as never,
        beltCargo: createVisibilityTarget() as never,
        entities: [createVisibilityTarget() as never],
      },
    })
    const profiler = {
      count: (name: string, value = 1) => samples.set(name, value),
    }

    diagnostics.syncDebugState(false)
    expect(app.renderer.geometry.draw).toBe(draw)
    expect(getItem).not.toHaveBeenCalled()

    diagnostics.syncDebugState(true)
    expect(getItem).toHaveBeenCalledTimes(1)
    expect(app.renderer.geometry.draw).not.toBe(draw)
    diagnostics.beforeRender(profiler)
    expect(pipeFlow.visible).toBe(false)

    app.renderer.geometry.draw()
    app.renderer.renderPipes.batch.break()
    app.renderer.graphicsContext.updateGpuContext({ dirty: true })
    app.renderer.renderPipes.graphics._rebuild()
    app.renderer.renderPipes.stencilMask.execute({ action: "pushMaskBegin" })
    app.renderer.renderPipes.stencilMask.execute({ action: "popMaskBegin" })
    app.renderer.renderPipes.alphaMask.execute({ action: "pushMaskBegin" })
    app.renderer.renderPipes.alphaMask.execute({ action: "popMaskEnd" })
    diagnostics.afterRender(profiler)

    expect(pipeFlow.visible).toBe(true)
    expect(samples.get("pixi.webgl.drawCalls")).toBe(1)
    expect(samples.get("pixi.batch.explicitBreakCalls")).toBe(1)
    expect(samples.get("pixi.graphics.contextRebuilds")).toBe(1)
    expect(samples.get("pixi.graphics.renderableRebuilds")).toBe(1)
    expect(samples.get("pixi.mask.stencilPushes")).toBe(1)
    expect(samples.get("pixi.mask.stencilPops")).toBe(1)
    expect(samples.get("pixi.mask.alphaPushes")).toBe(1)
    expect(samples.get("pixi.mask.alphaPops")).toBe(1)

    expect(diagnostics.readSnapshot()).toMatchObject({
      antialias: true,
      resolution: 2,
      logicalWidth: 640,
      logicalHeight: 360,
      framebufferWidth: 1280,
      framebufferHeight: 720,
      framebufferPixels: 921_600,
      layerProfile: "without-pipe-flow",
      gpuTimerMode: "unavailable",
    })

    diagnostics.syncDebugState(false)
    expect(app.renderer.geometry.draw).toBe(draw)
    expect(diagnostics.readSnapshot().layerProfile).toBe("full")
  })
})

function createVisibilityTarget(): { visible: boolean } {
  return { visible: true }
}
