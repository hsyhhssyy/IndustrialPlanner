import { afterEach, describe, expect, it, vi } from "vitest"
import { Texture, TextureSource } from "pixi.js"
import { TexturePerfDiagnostics } from "@/renderer/texture/texture-perf-diagnostics"

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
  it("attributes native uploads, excludes other queries, and restores hooks after an exception", () => {
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const texture = new Texture({ source: new TextureSource({ width: 32, height: 16, label: "/page.webp" }) })
    const profiler = new TexturePerfDiagnostics(() => ({
      activeSessions: 0, loadingPages: 0, residentDecodedBytes: 0, residentMasks: 0, residentPages: 0,
    }))
    const failure = new Error("upload failed")
    let shouldFail = false
    const texImage2D = function (this: unknown, ..._args: unknown[]) {
      expect(this).toBe(gl)
      now += 20
      if (shouldFail) throw failure
      return "uploaded"
    }
    const gl = {
      texImage2D,
      texSubImage2D: vi.fn(),
      generateMipmap: vi.fn(),
      getParameter: vi.fn((parameter: number) => { if (parameter === 0x84FF) now += 3; return 4 }),
      getExtension: () => null,
    }
    const textureSystem = {
      _boundTextures: [texture.source], _activeTextureLocation: 0,
      _initSource(source: unknown) {
        this.onSourceUpdate(source)
        this.updateStyle()
      },
      onSourceUpdate(_source: unknown) { return gl.texImage2D(0, 0, 0, 32, 16, 0, 0, 0, {}) },
      updateStyle() { gl.getParameter(0x84FF) },
    }
    const originalInit = textureSystem._initSource
    const originalSourceUpdate = textureSystem.onSourceUpdate
    const originalQuery = gl.getParameter
    const diagnostics = createPixiRenderDiagnostics({
      app: { renderer: { gl, texture: textureSystem } } as never,
      textureProfiler: profiler,
      layers: { stage: { children: [] }, pipeFlow: {}, beltFlow: {}, beltInsertion: {}, beltCargo: {}, entities: [] } as never,
    })
    try {
      expect(gl.texImage2D).toBe(texImage2D)
      diagnostics.syncDebugState(true)
      expect(textureSystem.onSourceUpdate).toBe(originalSourceUpdate)
      diagnostics.beforeRender({ count: () => undefined })
      textureSystem._initSource(texture.source)
      gl.getParameter(123)
      diagnostics.afterRender({ count: () => undefined })
      const report = diagnostics.readSnapshot().textures!
      expect(report.totals.texImage2D).toMatchObject({ calls: 1, totalMs: 20, inRenderMs: 20, rgba8EquivalentBytes: 2048 })
      expect(report.totals.anisotropyQuery).toMatchObject({ calls: 1, totalMs: 3 })
      expect(report.totals.init).toMatchObject({ calls: 1, totalMs: 23 })
      expect(report.topResources[0]?.resource).toBe("/page.webp")
      shouldFail = true
      expect(() => textureSystem._initSource(texture.source)).toThrow(failure)
      expect(diagnostics.readSnapshot().textures!.totals.texImage2D?.failedCalls).toBe(1)
      diagnostics.syncDebugState(false)
      expect(gl.texImage2D).toBe(texImage2D)
      expect(gl.getParameter).toBe(originalQuery)
      expect(textureSystem._initSource).toBe(originalInit)
      expect(diagnostics.readSnapshot().textures).toBeNull()
    } finally {
      diagnostics.destroy()
      texture.destroy(true)
    }
  })

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
    const pipeFlow = { ...createVisibilityTarget(), label: "logistics-material-flow" }
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
