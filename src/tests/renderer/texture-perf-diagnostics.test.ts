import { Texture, TextureSource } from "pixi.js"
import { describe, expect, it } from "vitest"

import { TexturePerfDiagnostics } from "@/renderer/texture/texture-perf-diagnostics"

// AI-REMOVED 2026-09-13:
// Reason: 测试契约从预算选择/即时回收改为全量驻留与 20 秒离屏期限。
// Trigger: 用户明确调整动画驻留规则，执行测试前同步原行为断言。
// Evidence: DeviceAnimationTextureCache 已取消预算与 5 秒回收。
// Replacement: 下方全量驻留诊断快照
// Risk: Low; Human Review: Required
// Original code:
// const residency = { activeSessions: 2, loadingPages: 0, residentDecodedBytes: 1024, residentMasks: 1, residentPages: 1, residency: { budgetBytes: 512, reservedBytes: 512, overBudgetBytes: 0, visibleSessions: 2, visibleAssets: 1, queuedPages: 0, totalsSinceCreation: {}, assets: [], omittedAssets: 0 } }
const residency = { activeSessions: 2, loadingPages: 0, residentDecodedBytes: 1024, residentMasks: 1, residentPages: 1, residency: { mode: "full-set" as const, offscreenGraceMs: 20_000, retainedSetBytes: 512, retainedAssets: 1, visibleSessions: 2, visibleAssets: 1, queuedPages: 0, totalsSinceCreation: {}, assets: [], omittedAssets: 0 } }

describe("TexturePerfDiagnostics", () => {
  it("reports half-resolution upload pixels and preserves the scale after unloading", async () => {
    const profiler = new TexturePerfDiagnostics(() => residency)
    const texture = new Texture({ source: new TextureSource({ width: 3840, height: 3584, resolution: 0.5 }) })
    const path = "/3d-top-view/animations/example/half.webp"
    try {
      profiler.syncDebugState(true)
      await profiler.load(path, () => Promise.resolve(texture))
      profiler.record("texImage2D", texture.source, 5, true, false)
      await profiler.unload(path, texture, async () => { texture.destroy(true) })
      const report = profiler.flush()!
      expect(report.topResources[0]).toMatchObject({
        resource: path, width: 1920, height: 1792, resolution: 0.5,
      })
      expect(report.totals.texImage2D?.rgba8EquivalentBytes).toBe(1920 * 1792 * 4)
    } finally {
      profiler.syncDebugState(false)
      if (!texture.destroyed) texture.destroy(true)
    }
  })

  it("separates loading from uploads and preserves repeat counts across log windows", async () => {
    let now = 0
    const profiler = new TexturePerfDiagnostics(() => residency, () => now)
    const texture = new Texture({ source: new TextureSource({ width: 2048, height: 1024 }) })
    const path = "/3d-top-view/animations/example/open_idle-0.webp"
    try {
      profiler.syncDebugState(true)
      await profiler.load(path, () => { now += 40; return Promise.resolve(texture) })
      const loaded = profiler.flush()!
      expect(loaded.totals.load).toMatchObject({ calls: 1, totalMs: 40 })
      expect(loaded.totals.texImage2D).toBeUndefined()
      expect(loaded.animationResidency).toEqual(residency)

      profiler.record("init", texture.source, 30, true, false)
      profiler.record("texImage2D", texture.source, 24, true, false)
      profiler.record("anisotropyQuery", texture.source, 5, true, false)
      await profiler.unload(path, texture, () => { now += 3; return Promise.resolve() })
      await profiler.load(path, () => { now += 10; return Promise.resolve(texture) })
      profiler.record("texImage2D", texture.source, 20, false, false)
      const uploaded = profiler.flush()!
      expect(uploaded.totals.texImage2D).toEqual({
        calls: 2, failedCalls: 0, totalMs: 44, maxMs: 24, inRenderMs: 24,
        over16Ms: 2, rgba8EquivalentBytes: 2048 * 1024 * 4 * 2,
      })
      expect(uploaded.topResources[0]).toMatchObject({
        resource: path, width: 2048, height: 1024,
        observedSinceEnable: { loads: 2, uploads: 2 },
      })
      expect(uploaded.uploadSizes["<=16MiB"]?.calls).toBe(2)
      expect(uploaded.totals.unload).toMatchObject({ calls: 1, totalMs: 3 })
      expect(profiler.flush()!.totals).toEqual({})
    } finally {
      profiler.syncDebugState(false)
      texture.destroy(true)
    }
  })

  it("does not count an asynchronous completion from an earlier debug session", async () => {
    const profiler = new TexturePerfDiagnostics(() => residency)
    const texture = new Texture({ source: new TextureSource({ width: 8, height: 8 }) })
    let finish!: (texture: Texture) => void
    try {
      profiler.syncDebugState(true)
      const pending = profiler.load("/old.webp", () => new Promise<Texture>((resolve) => { finish = resolve }))
      profiler.syncDebugState(false)
      profiler.syncDebugState(true)
      finish(texture)
      expect(await pending).toBe(texture)
      expect(profiler.flush()!.totals).toEqual({})
      profiler.syncDebugState(false)
      const original = Promise.resolve(texture)
      expect(profiler.load("/disabled.webp", () => original)).toBe(original)
      expect(profiler.flush()).toBeNull()
    } finally {
      profiler.syncDebugState(false)
      texture.destroy(true)
    }
  })

  it("preserves failures, ranks expensive resources, and bounds detail without losing totals", async () => {
    const profiler = new TexturePerfDiagnostics(() => residency)
    profiler.syncDebugState(true)
    const failure = new Error("decode failed")
    await expect(profiler.load("/broken.webp", () => Promise.reject(failure))).rejects.toBe(failure)
    for (let i = 0; i < 1100; i += 1) {
      profiler.record("texImage2D", { label: `/page-${i}.webp`, pixelWidth: 16, pixelHeight: 16 },
        i === 2 ? 100 : 1, true, false)
    }
    const report = profiler.flush()!
    expect(report.totals.load?.failedCalls).toBe(1)
    expect(report.totals.texImage2D?.calls).toBe(1100)
    expect(report.topResources).toHaveLength(20)
    expect(report.topResources[0]?.resource).toBe("/page-2.webp")
    expect(report.resourceCount).toBeLessThanOrEqual(1025)
    expect(report.resourceLimitReached).toBe(true)
    profiler.syncDebugState(false)
  })
})
