import { afterEach, describe, expect, it, vi } from "vitest"
import { Batch, BatchableSprite, Batcher, Container, Rectangle, Sprite, SpritePipe, Texture, TextureSource } from "pixi.js"
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
  it("捕获真实 SpritePipe 的纹理批次失效，保留设备路径、旧新页与批次槽位，限制窗口容量", () => {
    const oldSource = new TextureSource({ width: 16, height: 16, label: "/animations/device/page-0.webp" })
    const nextSource = new TextureSource({ width: 16, height: 16, label: "/animations/device/page-1.webp" })
    const oldTexture = new Texture({ source: oldSource, frame: new Rectangle(0, 0, 8, 8) })
    const samePageTexture = new Texture({ source: oldSource, frame: new Rectangle(8, 0, 8, 8) })
    const nextTexture = new Texture({ source: nextSource, frame: new Rectangle(0, 8, 8, 8) })
    const stage = new Container({ label: "scene.stage" })
    const layer = stage.addChild(new Container({ label: "scene.entity", isRenderGroup: true }))
    const owner = layer.addChild(new Container({ label: "entity.device-1.definition-1.entity" }))
    const sprite = owner.addChild(new Sprite({ texture: oldTexture, label: "device.body" }))
    const batch = new Batch()
    batch.textures.textures[0] = oldSource
    batch.textures.ids[oldSource.uid] = 0
    batch.textures.count = 1
    batch.start = 12
    batch.size = 6
    const gpuSprite = new BatchableSprite()
    gpuSprite.texture = oldTexture
    gpuSprite._batch = batch
    // 只提供 GPU 批次的 CPU 侧状态；验证与槽位查找执行 Pixi 原实现。
    gpuSprite._batcher = { uid: 91, checkAndUpdateTexture: Batcher.prototype.checkAndUpdateTexture } as never
    sprite._gpuData[7] = gpuSprite
    const pipe = new SpritePipe({ uid: 7 } as never)
    const originalValidate = pipe.validateRenderable
    const renderGroup = { _updateRenderGroups: (_group: unknown) => pipe.validateRenderable(sprite) }
    const diagnostics = createPixiRenderDiagnostics({
      app: { renderer: { uid: 7, renderGroup, renderPipes: { sprite: pipe } } } as never,
      layers: { stage, renderGroups: [layer], entities: [] } as never,
      renderGroupMode: "layers",
    })
    const counts = new Map<string, number>()
    const profiler = { count: (name: string, value = 1) => counts.set(name, value) }
    try {
      diagnostics.syncDebugState(true)
      diagnostics.beforeRender(profiler)
      sprite.texture = samePageTexture
      expect(renderGroup._updateRenderGroups(layer.renderGroup)).toBe(false)
      expect(diagnostics.readSnapshot().renderGroups.textureValidation.failures).toBe(0)
      sprite.texture = nextTexture
      expect(renderGroup._updateRenderGroups(layer.renderGroup)).toBe(true)
      expect(renderGroup._updateRenderGroups(layer.renderGroup)).toBe(true)
      diagnostics.afterRender(profiler)
      expect(counts.get("pixi.sprite.textureValidationFailures")).toBe(2)
      const report = diagnostics.readSnapshot().renderGroups.textureValidation
      expect(report).toMatchObject({ failures: 2, omittedFailures: 0, samples: [{ calls: 2 }] })
      expect(report.samples[0]?.last).toMatchObject({
        reason: "source-not-in-batch", renderableUid: sprite.uid,
        renderable: "scene.stage/scene.entity/entity.device-1.definition-1.entity/device.body",
        group: "scene.stage/scene.entity",
        previous: { textureUid: samePageTexture.uid, sourceUid: oldSource.uid, resource: oldSource.label,
          frame: { x: 8, y: 0, width: 8, height: 8 } },
        next: { textureUid: nextTexture.uid, sourceUid: nextSource.uid, resource: nextSource.label,
          frame: { x: 0, y: 8, width: 8, height: 8 } },
        batch: { batcherUid: 91, start: 12, size: 6, textureCount: 1, nextSourceTextureIndex: null,
          textures: [{ sourceUid: oldSource.uid, resource: oldSource.label }], omittedTextures: 0 },
      })
      expect(diagnostics.readSnapshot().renderGroups.textureValidation).toEqual({ failures: 0, omittedFailures: 0, samples: [] })
      diagnostics.beforeRender(profiler)
      for (let index = 0; index < 70; index += 1) {
        sprite.label = `device.body-${index}`
        expect(renderGroup._updateRenderGroups(layer.renderGroup)).toBe(true)
      }
      diagnostics.afterRender(profiler)
      const bounded = diagnostics.readSnapshot().renderGroups.textureValidation
      expect(bounded.failures).toBe(70)
      expect(bounded.samples).toHaveLength(64)
      expect(bounded.omittedFailures).toBe(6)
      diagnostics.syncDebugState(false)
      expect(pipe.validateRenderable).toBe(originalValidate)
      expect(diagnostics.readSnapshot().renderGroups.textureValidation.samples).toEqual([])
    } finally {
      diagnostics.destroy()
      pipe.destroy()
      stage.destroy({ children: true })
      batch.destroy()
      oldTexture.destroy()
      samePageTexture.destroy()
      nextTexture.destroy()
      oldSource.destroy()
      nextSource.destroy()
    }
  })

  it("分别归因嵌套阶段对不同渲染组的结构失效", () => {
    const stage = new Container({ label: "stage", isRenderGroup: true })
    const first = stage.addChild(new Container({ label: "first", isRenderGroup: true }))
    const second = stage.addChild(new Container({ label: "second", isRenderGroup: true }))
    const diagnostics = createPixiRenderDiagnostics({
      app: { renderer: {} } as never,
      layers: { stage, renderGroups: [first, second], entities: [] } as never,
    })
    try {
      for (const root of [stage, first, second]) root.renderGroup.structureDidChange = false
      diagnostics.syncDebugState(true)
      diagnostics.measureSceneStage("outer", () => {
        diagnostics.measureSceneStage("inner", () => { first.renderGroup.structureDidChange = true })
        second.renderGroup.structureDidChange = true
      })
      expect(diagnostics.readSnapshot().renderGroups.sources).toEqual([
        { reason: "scene.structure", source: "inner @ stage/first", calls: 1, totalMs: 0 },
        { reason: "scene.structure", source: "outer @ stage/second", calls: 1, totalMs: 0 },
      ])
    } finally {
      diagnostics.destroy()
      stage.destroy({ children: true })
    }
  })

  it("区分结构失效、验证失败和指令复用，保持调用语义并清理诊断窗口", () => {
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const group = {
      structureDidChange: false, root: { label: "stage" },
      childrenRenderablesToUpdate: { list: [] as unknown[], index: 0 },
    }
    const target = { label: "decoration.boundary", parent: group.root, renderPipeId: "graphics" }
    group.childrenRenderablesToUpdate = {
      list: [target, { label: "decoration.other", parent: group.root, renderPipeId: "graphics" }],
      index: 2,
    }
    let invalid = true
    let failBuild = false
    const failure = new Error("build failed")
    const graphics = { validateRenderable: (_target: unknown) => invalid }
    const renderGroup = {
      _buildInstructions(value: unknown) {
        expect(this).toBe(renderGroup)
        expect(value).toBe(group)
        now += 5
        if (failBuild) throw failure
        return "built"
      },
      _updateRenderables: () => "reused",
      _updateRenderGroups(value: typeof group) {
        if (!value.structureDidChange) value.structureDidChange = graphics.validateRenderable(target)
        if (value.structureDidChange) {
          value.structureDidChange = false
          return this._buildInstructions(value)
        }
        return this._updateRenderables()
      },
    }
    const originalBuild = renderGroup._buildInstructions
    const originalValidate = graphics.validateRenderable
    const diagnostics = createPixiRenderDiagnostics({
      app: { renderer: { renderGroup, renderPipes: { graphics } } } as never,
      layers: { stage: { label: "stage", renderGroup: group }, pipeFlow: {}, beltFlow: {}, entities: [] } as never,
    })
    const samples = new Map<string, number>()
    const profiler = { count: (name: string, value = 1) => samples.set(name, value) }
    try {
      diagnostics.syncDebugState(true)
      diagnostics.beforeRender(profiler)
      expect(renderGroup._updateRenderGroups(group)).toBe("built")
      invalid = false
      expect(renderGroup._updateRenderGroups(group)).toBe("reused")
      diagnostics.afterRender(profiler)
      expect(samples.get("pixi.renderGroup.buildCalls")).toBe(1)
      expect(samples.get("pixi.renderGroup.build-ms")).toBe(5)
      expect(samples.get("pixi.renderGroup.reuseCalls")).toBe(1)
      expect(diagnostics.readSnapshot().renderGroups.sources).toEqual(expect.arrayContaining([
        { reason: "validation.graphics", source: "stage/decoration.boundary", calls: 1, totalMs: 0 },
        { reason: "build.validation.graphics", source: "stage", calls: 1, totalMs: 5 },
        { reason: "pending.graphics", source: "stage/decoration.other", calls: 2, totalMs: 0 },
      ]))
      expect(diagnostics.readSnapshot().renderGroups.sources).toEqual([])
      diagnostics.measureSceneStage("outer", () => diagnostics.measureSceneStage("inner", () => {
        group.structureDidChange = true
      }))
      diagnostics.beforeRender(profiler)
      failBuild = true
      expect(() => renderGroup._updateRenderGroups(group)).toThrow(failure)
      diagnostics.afterRender(profiler)
      expect(samples.get("pixi.renderGroup.buildFailures")).toBe(1)
      const failureSources = diagnostics.readSnapshot().renderGroups.sources
      expect(failureSources.some((source) => source.reason === "pending.graphics")).toBe(false)
      expect(failureSources).toEqual(expect.arrayContaining([
        { reason: "scene.structure", source: "inner @ stage", calls: 1, totalMs: 0 },
        { reason: "build.structure", source: "stage", calls: 1, totalMs: 5 },
      ]))
      diagnostics.syncDebugState(false)
      expect(renderGroup._buildInstructions).toBe(originalBuild)
      expect(graphics.validateRenderable).toBe(originalValidate)
      expect(diagnostics.readSnapshot().renderGroups.sources).toEqual([])
    } finally {
      diagnostics.destroy()
    }
  })

  it("attributes native uploads, excludes other queries, and restores hooks after an exception", () => {
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const texture = new Texture({ source: new TextureSource({ width: 32, height: 16, label: "/page.webp" }) })
    const profiler = new TexturePerfDiagnostics(() => ({
      activeSessions: 0, loadingPages: 0, residentDecodedBytes: 0, residentMasks: 0, residentPages: 0,
      // AI-REMOVED 2026-09-13:
      // Reason: 测试契约从预算选择/即时回收改为全量驻留与 20 秒离屏期限。
      // Trigger: 用户明确调整动画驻留规则，执行测试前同步原行为断言。
      // Evidence: DeviceAnimationTextureCache 已取消预算与 5 秒回收。
      // Replacement: 下方全量驻留诊断快照
      // Risk: Low; Human Review: Required
      // Original code:
      // residency: { budgetBytes: 512, reservedBytes: 0, overBudgetBytes: 0, visibleSessions: 0, visibleAssets: 0, queuedPages: 0, totalsSinceCreation: {}, assets: [], omittedAssets: 0 },
      residency: { mode: "full-set" as const, offscreenGraceMs: 20_000, retainedSetBytes: 0, retainedAssets: 0, visibleSessions: 0, visibleAssets: 0, queuedPages: 0, totalsSinceCreation: {}, assets: [], omittedAssets: 0 },
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
