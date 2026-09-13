import type { Application, Container } from "pixi.js"
import type { TexturePerfDiagnostics } from "./texture"

export const PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY = "industrial-planner:pixi-render-layer-profile"
export const PIXI_RENDER_ANTIALIAS_STORAGE_KEY = "industrial-planner:pixi-render-antialias"

const MAX_PENDING_GPU_TIMER_QUERIES = 8
const MAX_RENDER_GROUP_SOURCES = 48
const MAX_SAMPLED_DIRTY_RENDERABLES = 4096
const MAX_TEXTURE_VALIDATION_SAMPLES = 64
const MAX_BATCH_TEXTURE_SAMPLES = 32

export type PixiRenderLayerProfile =
  | "full"
  | "without-pipe-flow"
  | "without-belt-flow"
  | "without-belt-insertion"
  | "without-belt-cargo"
  | "without-entities"
  | "empty"

interface PixiDiagnosticProfiler {
  count(name: string, value?: number): void;
}

interface VisibilityTarget {
  visible: boolean;
}

export interface PixiRenderDiagnosticLayerTargets {
  readonly stage: Container;
  readonly renderGroups?: readonly Container[];
  readonly pipeFlow: Container;
  readonly beltFlow: Container;
  readonly beltInsertion: Container;
  readonly beltCargo: Container;
  readonly entities: readonly Container[];
}

export interface PixiRenderDiagnosticsSnapshot {
  readonly renderGroups: {
    readonly mode: "layers" | "single";
    readonly sources: readonly RenderGroupSourceSample[];
    readonly textureValidation: {
      readonly failures: number;
      readonly omittedFailures: number;
      readonly samples: readonly TextureValidationSample[];
    };
  };
  readonly textures: ReturnType<TexturePerfDiagnostics["flush"]>;
  readonly backend: "webgl" | "unknown";
  readonly antialias: boolean;
  readonly msaaSamples: number | null;
  readonly resolution: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly framebufferWidth: number;
  readonly framebufferHeight: number;
  readonly framebufferPixels: number;
  readonly layerProfile: PixiRenderLayerProfile;
  readonly gpuTimerMode: GpuTimerMode;
  readonly installedHooks: readonly string[];
}

export interface PixiRenderDiagnostics {
  syncDebugState(enabled: boolean): void;
  measureSceneStage<T>(stage: string, callback: () => T): T;
  beforeRender(profiler: PixiDiagnosticProfiler | null): void;
  afterRender(profiler: PixiDiagnosticProfiler | null): void;
  readSnapshot(): PixiRenderDiagnosticsSnapshot;
  destroy(): void;
}

interface FrameCounters {
  textureValidationFailures: number;
  renderGroupBuilds: number;
  renderGroupBuildMs: number;
  renderGroupBuildFailures: number;
  renderGroupUpdates: number;
  drawCalls: number;
  batchBreakCalls: number;
  graphicsContextRebuilds: number;
  graphicsRenderableRebuilds: number;
  graphicsContextRebuildMs: number;
  stencilMaskPushes: number;
  stencilMaskPops: number;
  alphaMaskPushes: number;
  alphaMaskPops: number;
}

interface RenderGroupSourceSample {
  readonly reason: string;
  readonly source: string;
  calls: number;
  totalMs: number;
}

interface TextureValidationSample {
  calls: number;
  readonly firstFrame: number;
  lastFrame: number;
  last: ReturnType<typeof describeSpriteTextureValidation>;
}

type HookMethod = (this: unknown, ...args: unknown[]) => unknown
type GpuTimerMode = "webgl2" | "webgl1" | "unavailable"

interface GpuTimerPollResult {
  readonly samplesMs: readonly number[];
  readonly disjointCount: number;
}

interface GpuTimerCollector {
  readonly mode: GpuTimerMode;
  readonly pendingCount: number;
  begin(): boolean;
  end(): void;
  poll(): GpuTimerPollResult;
  destroy(): void;
}

interface WebGl2TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface WebGl1TimerQuery {
  readonly id?: unknown;
}

interface WebGl1TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
  readonly QUERY_RESULT_AVAILABLE_EXT: number;
  readonly QUERY_RESULT_EXT: number;
  createQueryEXT(): WebGl1TimerQuery | null;
  deleteQueryEXT(query: WebGl1TimerQuery): void;
  beginQueryEXT(target: number, query: WebGl1TimerQuery): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(query: WebGl1TimerQuery, parameter: number): unknown;
}

interface RendererInternals {
  readonly renderGroup?: unknown;
  readonly texture?: unknown;
  readonly uid?: number;
  readonly resolution?: number;
  readonly width?: number;
  readonly height?: number;
  readonly screen?: { readonly width?: number; readonly height?: number };
  readonly canvas?: { readonly width?: number; readonly height?: number };
  readonly view?: { readonly antialias?: boolean };
  readonly gl?: WebGLRenderingContext | WebGL2RenderingContext;
  readonly geometry?: unknown;
  readonly graphicsContext?: unknown;
  readonly renderPipes?: {
    readonly [key: string]: unknown;
    readonly batch?: unknown;
    readonly graphics?: unknown;
    readonly stencilMask?: unknown;
    readonly alphaMask?: unknown;
  };
}

export function resolveMainRendererAntialias(debugMode: boolean): boolean {
  if (!debugMode) {
    return true
  }

  return readStorageValue(PIXI_RENDER_ANTIALIAS_STORAGE_KEY) !== "off"
}

export function createPixiRenderDiagnostics(options: {
  readonly app: Application;
  readonly textureProfiler?: TexturePerfDiagnostics;
  readonly renderGroupMode?: "layers" | "single";
  readonly layers: PixiRenderDiagnosticLayerTargets;
}): PixiRenderDiagnostics {
  const renderer = options.app.renderer as unknown as RendererInternals
  const counters: FrameCounters = createEmptyFrameCounters()
  const hookRestorers: Array<() => void> = []
  const installedHooks: string[] = []
  const renderGroupSources = new Map<string, RenderGroupSourceSample>()
  const textureValidationSamples = new Map<string, TextureValidationSample>()
  const sceneGroupRoots = [options.layers.stage, ...options.layers.renderGroups ?? []]
  const sceneGroupInvalidations = new WeakMap<Container, number>()
  let textureValidationFailures = 0
  let omittedTextureValidationFailures = 0
  let activeBuildReason = "unclassified"
  let activeRenderGroupRoot: unknown = null
  let sceneInvalidationSerial = 0
  let frameSerial = 0
  let samplePendingGraphics = false
  const hiddenTargets: Array<{
    readonly target: VisibilityTarget;
    readonly visible: boolean;
  }> = []
  let enabled = false
  let trackingRender = false
  let layerProfile: PixiRenderLayerProfile = "full"
  let gpuTimer: GpuTimerCollector = createUnavailableGpuTimerCollector()
  let msaaSamples: number | null = null

  const recordRenderGroupSource = (reason: string, source: string, elapsedMs = 0): void => {
    let key = `${reason}:${source}`
    if (!renderGroupSources.has(key) && renderGroupSources.size >= MAX_RENDER_GROUP_SOURCES) {
      key = "overflow"
      reason = "overflow"
      source = "other"
    }
    let sample = renderGroupSources.get(key)
    if (sample === undefined) {
      sample = { reason, source, calls: 0, totalMs: 0 }
      renderGroupSources.set(key, sample)
    }
    sample.calls += 1
    sample.totalMs += elapsedMs
  }

  const recordTextureValidation = (sprite: unknown): void => {
    counters.textureValidationFailures += 1
    textureValidationFailures += 1
    const detail = describeSpriteTextureValidation(sprite, renderer.uid, activeRenderGroupRoot, options.textureProfiler)
    // 同实体、同资源切换合并计数；UID、UV 与批次保留最近一次实际失败时的标量快照。
    const key = JSON.stringify([detail.group, detail.renderableUid, detail.renderable,
      detail.previous.resource, detail.next.resource, detail.reason])
    const sample = textureValidationSamples.get(key)
    if (sample !== undefined) {
      sample.calls += 1
      sample.lastFrame = frameSerial
      sample.last = detail
    } else if (textureValidationSamples.size < MAX_TEXTURE_VALIDATION_SAMPLES) {
      textureValidationSamples.set(key, { calls: 1, firstFrame: frameSerial, lastFrame: frameSerial, last: detail })
    } else {
      omittedTextureValidationFailures += 1
    }
  }

  const installRendererHooks = (): void => {
    const install = (
      target: unknown,
      key: string,
      name: string,
      wrap: (original: HookMethod) => HookMethod,
    ): void => {
      if (installMethodHook(target, key, wrap, hookRestorers)) {
        installedHooks.push(name)
      }
    }

    install(renderer.renderGroup, "_updateRenderGroups", "renderGroup._updateRenderGroups", (original) => function (...args) {
      const previous = activeBuildReason
      const previousRoot = activeRenderGroupRoot
      activeRenderGroupRoot = asRecord(args[0])?.root
      activeBuildReason = asRecord(args[0])?.structureDidChange === true ? "structure" : "unclassified"
      try {
        if (trackingRender && samplePendingGraphics) {
          const pending = asRecord(asRecord(args[0])?.childrenRenderablesToUpdate)
          const list = pending?.list
          if (Array.isArray(list) && typeof pending?.index === "number") {
            recordRenderGroupSource("pending.sampledGroup", describeRenderObject(asRecord(args[0])?.root))
            const limit = Math.min(pending.index, list.length, MAX_SAMPLED_DIRTY_RENDERABLES)
            for (let index = 0; index < limit; index += 1) {
              if (asRecord(list[index])?.renderPipeId === "graphics") {
                recordRenderGroupSource("pending.graphics", describeRenderObject(list[index]))
              }
            }
            if (pending.index > limit) recordRenderGroupSource("pending.truncated", "dirty-renderables")
          }
        }
        return Reflect.apply(original, this, args)
      } finally {
        activeBuildReason = previous
        activeRenderGroupRoot = previousRoot
      }
    })
    install(renderer.renderGroup, "_buildInstructions", "renderGroup._buildInstructions", (original) => function (...args) {
      if (!trackingRender) return Reflect.apply(original, this, args)
      const startedAtMs = performance.now()
      counters.renderGroupBuilds += 1
      let failed = true
      try {
        const result = Reflect.apply(original, this, args)
        failed = false
        return result
      } finally {
        const elapsedMs = performance.now() - startedAtMs
        counters.renderGroupBuildMs += elapsedMs
        if (failed) counters.renderGroupBuildFailures += 1
        recordRenderGroupSource(`build.${activeBuildReason}`, describeRenderObject(asRecord(args[0])?.root), elapsedMs)
      }
    })
    install(renderer.renderGroup, "_updateRenderables", "renderGroup._updateRenderables", (original) => function (...args) {
      if (trackingRender) {
        counters.renderGroupUpdates += 1
        recordRenderGroupSource("reuse", describeRenderObject(asRecord(args[0])?.root))
      }
      return Reflect.apply(original, this, args)
    })
    // 只记录实际返回 true 的验证；Pixi 在第一个失效对象处停止，不能把它当成全部脏对象清单。
    for (const [pipeId, pipe] of Object.entries(renderer.renderPipes ?? {})) {
      install(pipe, "validateRenderable", `${pipeId}.validateRenderable`, (original) => function (...args) {
        const result = Reflect.apply(original, this, args)
        if (trackingRender && result === true) {
          activeBuildReason = `validation.${pipeId}`
          recordRenderGroupSource(`validation.${pipeId}`, describeRenderObject(args[0]))
          if (pipeId === "sprite") recordTextureValidation(args[0])
        }
        return result
      })
    }

    if (options.textureProfiler !== undefined) {
      const textureSystem = asRecord(renderer.texture)
      let activeSource: unknown = null
      const readSource = (): unknown => activeSource
        ?? asRecord(textureSystem?._boundTextures)?.[String(textureSystem?._activeTextureLocation)]
      // onSourceUpdate 会作为事件监听器注册；保持其身份，普通更新从绑定纹理缓存归属。
      for (const [method, operation] of [["_initSource", "init"], ["updateStyle", null]] as const) {
        install(renderer.texture, method, `texture.${method}`, (original) => function (...args) {
          const previous = activeSource
          activeSource = args[0]
          const startedAtMs = operation === null ? 0 : performance.now()
          let failed = true
          try {
            const result = Reflect.apply(original, this, args)
            failed = false
            return result
          } finally {
            if (operation !== null) options.textureProfiler?.record(operation, activeSource,
              performance.now() - startedAtMs, trackingRender, failed)
            activeSource = previous
          }
        })
      }
      for (const [method, operation] of [
        ["texImage2D", "texImage2D"], ["texSubImage2D", "texSubImage2D"],
        ["generateMipmap", "mipmap"], ["getParameter", "anisotropyQuery"],
      ] as const) {
        install(renderer.gl, method, `gl.${method}`, (original) => function (...args) {
          // MAX_TEXTURE_MAX_ANISOTROPY_EXT；不增加任何 GL 查询或同步操作。
          if (method === "getParameter" && args[0] !== 0x84FF) return Reflect.apply(original, this, args)
          const source = readSource()
          const dimensions: readonly [number, number] | undefined = args.length >= 9
            && (method === "texImage2D" || method === "texSubImage2D")
            ? method === "texImage2D" ? [Number(args[3]), Number(args[4])] : [Number(args[4]), Number(args[5])]
            : undefined
          const startedAtMs = performance.now()
          let failed = true
          try {
            const result = Reflect.apply(original, this, args)
            failed = false
            return result
          } finally {
            options.textureProfiler?.record(operation, source, performance.now() - startedAtMs,
              trackingRender, failed, dimensions)
          }
        })
      }
    }

    install(renderer.geometry, "draw", "geometry.draw", (original) => function (...args) {
      if (trackingRender) {
        counters.drawCalls += 1
      }
      return Reflect.apply(original, this, args)
    })

    install(renderer.renderPipes?.batch, "break", "batch.break", (original) => function (...args) {
      if (trackingRender) {
        counters.batchBreakCalls += 1
      }
      return Reflect.apply(original, this, args)
    })

    install(
      renderer.graphicsContext,
      "updateGpuContext",
      "graphicsContext.updateGpuContext",
      (original) => function (...args) {
        const context = asRecord(args[0])
        const gpuData = asRecord(context?._gpuData)
        const rendererUid = renderer.uid
        const hasGpuContext = rendererUid !== undefined
          && gpuData?.[String(rendererUid)] !== undefined
        const rebuildsContext = trackingRender
          && (context?.dirty === true || !hasGpuContext)
        const startedAtMs = rebuildsContext ? performance.now() : 0
        const result = Reflect.apply(original, this, args)
        if (rebuildsContext) {
          counters.graphicsContextRebuilds += 1
          counters.graphicsContextRebuildMs += performance.now() - startedAtMs
        }
        return result
      },
    )

    install(renderer.renderPipes?.graphics, "_rebuild", "graphics._rebuild", (original) => function (...args) {
      if (trackingRender) {
        counters.graphicsRenderableRebuilds += 1
      }
      return Reflect.apply(original, this, args)
    })

    install(renderer.renderPipes?.stencilMask, "execute", "stencilMask.execute", (original) => function (...args) {
      if (trackingRender) {
        const action = asRecord(args[0])?.action
        if (action === "pushMaskBegin") {
          counters.stencilMaskPushes += 1
        } else if (action === "popMaskBegin") {
          counters.stencilMaskPops += 1
        }
      }
      return Reflect.apply(original, this, args)
    })

    install(renderer.renderPipes?.alphaMask, "execute", "alphaMask.execute", (original) => function (...args) {
      if (trackingRender) {
        const action = asRecord(args[0])?.action
        if (action === "pushMaskBegin") {
          counters.alphaMaskPushes += 1
        } else if (action === "popMaskEnd") {
          counters.alphaMaskPops += 1
        }
      }
      return Reflect.apply(original, this, args)
    })
  }

  const enable = (): void => {
    if (enabled) {
      return
    }

    enabled = true
    options.textureProfiler?.syncDebugState(true)
    layerProfile = readPixiRenderLayerProfile()
    installRendererHooks()
    gpuTimer = createGpuTimerCollector(renderer.gl)
    msaaSamples = readMsaaSamples(renderer.gl)
  }

  const disable = (): void => {
    if (!enabled) {
      return
    }

    trackingRender = false
    restoreHiddenTargets(hiddenTargets)
    gpuTimer.destroy()
    gpuTimer = createUnavailableGpuTimerCollector()
    while (hookRestorers.length > 0) {
      hookRestorers.pop()?.()
    }
    installedHooks.length = 0
    renderGroupSources.clear()
    textureValidationSamples.clear()
    textureValidationFailures = 0
    omittedTextureValidationFailures = 0
    activeBuildReason = "unclassified"
    activeRenderGroupRoot = null
    frameSerial = 0
    samplePendingGraphics = false
    layerProfile = "full"
    msaaSamples = null
    enabled = false
    options.textureProfiler?.syncDebugState(false)
  }

  return {
    measureSceneStage(stage, callback) {
      if (!enabled) return callback()
      const groups = sceneGroupRoots.map((root) => ({
        root, group: root.renderGroup, wasDirty: root.renderGroup?.structureDidChange,
        previousSerial: sceneGroupInvalidations.get(root) ?? 0,
      }))
      try {
        return callback()
      } finally {
        // 仅读取标志；不改写 Pixi 属性、不扫描场景、不抓堆栈。
        // AI-CORRECTION 2026-09-13: 按初始化时固定的粗图层列表读取，每个组单独处理嵌套归因。
        for (const { root, group, wasDirty, previousSerial } of groups) {
          if (wasDirty === false && group?.structureDidChange === true
            && previousSerial === (sceneGroupInvalidations.get(root) ?? 0)) {
            sceneGroupInvalidations.set(root, ++sceneInvalidationSerial)
            recordRenderGroupSource("scene.structure", `${stage} @ ${describeRenderObject(root)}`)
          }
        }
      }
    },

    syncDebugState(nextEnabled): void {
      if (!nextEnabled) {
        disable()
        return
      }

      enable()
    },

    beforeRender(profiler): void {
      if (!enabled || profiler === null) {
        return
      }

      resetFrameCounters(counters)
      // 每六十帧查看一次 Pixi 已有的更新队列，避免逐帧扫描所有对象。
      samplePendingGraphics = frameSerial++ % 60 === 0
      restoreHiddenTargets(hiddenTargets)
      hideProfileTargets(layerProfile, options.layers, hiddenTargets)

      const gpuPoll = gpuTimer.poll()
      for (const sampleMs of gpuPoll.samplesMs) {
        profiler.count("pixi.gpuTime-ms", sampleMs)
      }
      profiler.count("pixi.gpuTimer.disjointResults", gpuPoll.disjointCount)

      trackingRender = true
      if (gpuTimer.mode === "unavailable") {
        profiler.count("pixi.gpuTimer.skippedFrames", 0)
      } else if (!gpuTimer.begin()) {
        profiler.count("pixi.gpuTimer.skippedFrames", 1)
      } else {
        profiler.count("pixi.gpuTimer.skippedFrames", 0)
      }
    },

    afterRender(profiler): void {
      if (!enabled || profiler === null) {
        return
      }

      gpuTimer.end()
      trackingRender = false
      restoreHiddenTargets(hiddenTargets)

      profiler.count("pixi.renderGroup.buildCalls", counters.renderGroupBuilds)
      profiler.count("pixi.renderGroup.build-ms", counters.renderGroupBuildMs)
      profiler.count("pixi.renderGroup.buildFailures", counters.renderGroupBuildFailures)
      profiler.count("pixi.renderGroup.reuseCalls", counters.renderGroupUpdates)
      profiler.count("pixi.sprite.textureValidationFailures", counters.textureValidationFailures)
      profiler.count("pixi.webgl.drawCalls", counters.drawCalls)
      profiler.count("pixi.batch.explicitBreakCalls", counters.batchBreakCalls)
      profiler.count("pixi.graphics.contextRebuilds", counters.graphicsContextRebuilds)
      profiler.count("pixi.graphics.renderableRebuilds", counters.graphicsRenderableRebuilds)
      profiler.count("pixi.graphics.contextRebuild-ms", counters.graphicsContextRebuildMs)
      profiler.count("pixi.mask.stencilPushes", counters.stencilMaskPushes)
      profiler.count("pixi.mask.stencilPops", counters.stencilMaskPops)
      profiler.count("pixi.mask.alphaPushes", counters.alphaMaskPushes)
      profiler.count("pixi.mask.alphaPops", counters.alphaMaskPops)
      profiler.count("pixi.gpuTimer.pendingQueries", gpuTimer.pendingCount)
    },

    readSnapshot(): PixiRenderDiagnosticsSnapshot {
      const logicalWidth = normalizeDimension(renderer.screen?.width ?? renderer.width)
      const logicalHeight = normalizeDimension(renderer.screen?.height ?? renderer.height)
      const framebufferWidth = normalizeDimension(renderer.canvas?.width)
      const framebufferHeight = normalizeDimension(renderer.canvas?.height)
      const sources = [...renderGroupSources.values()]
        .map((sample) => ({ ...sample, totalMs: Math.round(sample.totalMs * 1000) / 1000 }))
        .sort((left, right) => right.calls - left.calls)
      renderGroupSources.clear()
      const textureValidation = {
        failures: textureValidationFailures,
        omittedFailures: omittedTextureValidationFailures,
        samples: [...textureValidationSamples.values()].sort((left, right) => right.calls - left.calls),
      }
      textureValidationSamples.clear()
      textureValidationFailures = 0
      omittedTextureValidationFailures = 0

      return {
        renderGroups: { mode: options.renderGroupMode ?? "single", sources, textureValidation },
        textures: options.textureProfiler?.flush() ?? null,
        backend: renderer.gl === undefined ? "unknown" : "webgl",
        antialias: renderer.view?.antialias === true,
        msaaSamples,
        resolution: normalizeFiniteNumber(renderer.resolution, 1),
        logicalWidth,
        logicalHeight,
        framebufferWidth,
        framebufferHeight,
        framebufferPixels: framebufferWidth * framebufferHeight,
        layerProfile,
        gpuTimerMode: gpuTimer.mode,
        installedHooks: [...installedHooks],
      }
    },

    destroy(): void {
      disable()
    },
  }
}

function createEmptyFrameCounters(): FrameCounters {
  return {
    textureValidationFailures: 0,
    renderGroupBuilds: 0,
    renderGroupBuildMs: 0,
    renderGroupBuildFailures: 0,
    renderGroupUpdates: 0,
    drawCalls: 0,
    batchBreakCalls: 0,
    graphicsContextRebuilds: 0,
    graphicsRenderableRebuilds: 0,
    graphicsContextRebuildMs: 0,
    stencilMaskPushes: 0,
    stencilMaskPops: 0,
    alphaMaskPushes: 0,
    alphaMaskPops: 0,
  }
}

function resetFrameCounters(counters: FrameCounters): void {
  counters.textureValidationFailures = 0
  counters.renderGroupBuilds = 0
  counters.renderGroupBuildMs = 0
  counters.renderGroupBuildFailures = 0
  counters.renderGroupUpdates = 0
  counters.drawCalls = 0
  counters.batchBreakCalls = 0
  counters.graphicsContextRebuilds = 0
  counters.graphicsRenderableRebuilds = 0
  counters.graphicsContextRebuildMs = 0
  counters.stencilMaskPushes = 0
  counters.stencilMaskPops = 0
  counters.alphaMaskPushes = 0
  counters.alphaMaskPops = 0
}

function describeRenderObject(value: unknown): string {
  const parts: string[] = []
  let object = asRecord(value)
  for (let depth = 0; object !== null && depth < 6; depth += 1) {
    const label = typeof object.label === "string" && object.label.length > 0
      ? object.label : typeof object.renderPipeId === "string" ? object.renderPipeId : "container"
    parts.push(label.slice(0, 160))
    object = asRecord(object.parent)
  }
  return parts.reverse().join("/") || "unknown"
}

/** 只在实际验证失败后读取已有 CPU 侧批次；不重新验证，不同步查询 GL。 */
function describeSpriteTextureValidation(
  value: unknown,
  rendererUid: number | undefined,
  groupRoot: unknown,
  textureProfiler: TexturePerfDiagnostics | undefined,
) {
  const sprite = asRecord(value)
  const gpuSprite = asRecord(asRecord(sprite?._gpuData)?.[String(rendererUid)])
  const batch = asRecord(gpuSprite?._batch)
  const textures = asRecord(batch?.textures)
  const sourceDescription = (source: unknown) => {
    const record = asRecord(source)
    const path = textureProfiler?.describe(source).resource ?? record?.label ?? record?._sourceOrigin
    return {
      sourceUid: diagnosticNumber(record?.uid),
      resource: typeof path === "string" ? path.replace(/^https?:\/\/[^/]+/, "").slice(0, 512) : "<unattributed>",
      width: diagnosticNumber(record?.pixelWidth), height: diagnosticNumber(record?.pixelHeight),
      resolution: diagnosticNumber(record?.resolution), destroyed: record?.destroyed === true,
    }
  }
  const textureDescription = (texture: unknown) => {
    const record = asRecord(texture)
    const frame = asRecord(record?.frame)
    return {
      textureUid: diagnosticNumber(record?.uid),
      ...sourceDescription(record?._source),
      frame: { x: diagnosticNumber(frame?.x), y: diagnosticNumber(frame?.y),
        width: diagnosticNumber(frame?.width), height: diagnosticNumber(frame?.height) },
    }
  }
  const previous = textureDescription(gpuSprite?.texture)
  const next = textureDescription(sprite?._texture)
  const ids = asRecord(textures?.ids)
  const textureIndex = next.sourceUid === null ? null : diagnosticNumber(ids?.[String(next.sourceUid)])
  const count = diagnosticNumber(textures?.count)
  const list = Array.isArray(textures?.textures) ? textures.textures : []
  const limit = Math.min(list.length, Math.max(0, count ?? 0), MAX_BATCH_TEXTURE_SAMPLES)
  return {
    reason: ids === null || next.sourceUid === null ? "missing-batch-data"
      : textureIndex === null ? "source-not-in-batch" : "unclassified",
    renderable: describeRenderObject(value), renderableUid: diagnosticNumber(sprite?.uid),
    group: describeRenderObject(groupRoot), previous, next,
    batch: {
      batcherUid: diagnosticNumber(asRecord(gpuSprite?._batcher)?.uid),
      start: diagnosticNumber(batch?.start), size: diagnosticNumber(batch?.size),
      textureCount: count, nextSourceTextureIndex: textureIndex,
      textures: list.slice(0, limit).map(sourceDescription),
      omittedTextures: Math.max(0, (count ?? 0) - limit),
    },
  }
}

function diagnosticNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function installMethodHook(
  target: unknown,
  key: string,
  wrap: (original: HookMethod) => HookMethod,
  restorers: Array<() => void>,
): boolean {
  const record = asRecord(target)
  const originalValue = record?.[key]
  if (record === null || typeof originalValue !== "function") {
    return false
  }

  const original = originalValue as HookMethod
  const wrapped = wrap(original)
  try {
    record[key] = wrapped
  } catch {
    return false
  }

  if (record[key] !== wrapped) {
    return false
  }

  restorers.push(() => {
    if (record[key] === wrapped) {
      record[key] = original
    }
  })
  return true
}

function hideProfileTargets(
  profile: PixiRenderLayerProfile,
  layers: PixiRenderDiagnosticLayerTargets,
  hiddenTargets: Array<{
    readonly target: VisibilityTarget;
    readonly visible: boolean;
  }>,
): void {
  let targets: readonly VisibilityTarget[] = []
  switch (profile) {
    case "full":
      return
    case "without-pipe-flow":
      targets = collectLogisticsMaterialFlowTargets(layers.pipeFlow)
      break
    case "without-belt-flow":
      targets = collectLogisticsMaterialFlowTargets(layers.beltFlow)
      break
    case "without-belt-insertion":
      targets = [layers.beltInsertion]
      break
    case "without-belt-cargo":
      targets = [layers.beltCargo]
      break
    case "without-entities":
      targets = layers.entities
      break
    case "empty":
      targets = layers.stage.children
      break
  }

  const visited = new Set<VisibilityTarget>()
  for (const target of targets) {
    if (visited.has(target)) {
      continue
    }
    visited.add(target)
    hiddenTargets.push({ target, visible: target.visible })
    target.visible = false
  }
}

function restoreHiddenTargets(
  hiddenTargets: Array<{
    readonly target: VisibilityTarget;
    readonly visible: boolean;
  }>,
): void {
  while (hiddenTargets.length > 0) {
    const entry = hiddenTargets.pop()
    if (entry !== undefined) {
      entry.target.visible = entry.visible
    }
  }
}

function readPixiRenderLayerProfile(): PixiRenderLayerProfile {
  const value = readStorageValue(PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY)
  switch (value) {
    case "without-pipe-flow":
    case "without-belt-flow":
    case "without-belt-insertion":
    case "without-belt-cargo":
    case "without-entities":
    case "empty":
      return value
    default:
      return "full"
  }
}

function readStorageValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function createGpuTimerCollector(
  gl: WebGLRenderingContext | WebGL2RenderingContext | undefined,
): GpuTimerCollector {
  if (gl === undefined) {
    return createUnavailableGpuTimerCollector()
  }

  const webGl2 = gl as WebGL2RenderingContext
  if (
    typeof webGl2.createQuery === "function"
    && typeof webGl2.beginQuery === "function"
    && typeof webGl2.getQueryParameter === "function"
  ) {
    const extension = webGl2.getExtension("EXT_disjoint_timer_query_webgl2") as WebGl2TimerExtension | null
    if (extension !== null) {
      return createWebGl2GpuTimerCollector(webGl2, extension)
    }
  }

  const webGl1Extension = gl.getExtension("EXT_disjoint_timer_query") as WebGl1TimerExtension | null
  if (webGl1Extension !== null) {
    return createWebGl1GpuTimerCollector(gl, webGl1Extension)
  }

  return createUnavailableGpuTimerCollector()
}

function createWebGl2GpuTimerCollector(
  gl: WebGL2RenderingContext,
  extension: WebGl2TimerExtension,
): GpuTimerCollector {
  const pending: WebGLQuery[] = []
  let activeQuery: WebGLQuery | null = null

  return {
    mode: "webgl2",
    get pendingCount(): number {
      return pending.length
    },
    begin(): boolean {
      if (activeQuery !== null || pending.length >= MAX_PENDING_GPU_TIMER_QUERIES) {
        return false
      }
      activeQuery = gl.createQuery()
      if (activeQuery === null) {
        return false
      }
      gl.beginQuery(extension.TIME_ELAPSED_EXT, activeQuery)
      return true
    },
    end(): void {
      if (activeQuery === null) {
        return
      }
      gl.endQuery(extension.TIME_ELAPSED_EXT)
      pending.push(activeQuery)
      activeQuery = null
    },
    poll(): GpuTimerPollResult {
      const samplesMs: number[] = []
      let disjointCount = 0
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) === true
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const query = pending[index]
        if (query === undefined || gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true) {
          continue
        }
        pending.splice(index, 1)
        if (disjoint) {
          disjointCount += 1
        } else {
          const elapsedNanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT))
          if (Number.isFinite(elapsedNanoseconds) && elapsedNanoseconds >= 0) {
            samplesMs.push(elapsedNanoseconds / 1_000_000)
          }
        }
        gl.deleteQuery(query)
      }
      return { samplesMs, disjointCount }
    },
    destroy(): void {
      if (activeQuery !== null) {
        gl.endQuery(extension.TIME_ELAPSED_EXT)
        gl.deleteQuery(activeQuery)
        activeQuery = null
      }
      for (const query of pending) {
        gl.deleteQuery(query)
      }
      pending.length = 0
    },
  }
}

function createWebGl1GpuTimerCollector(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  extension: WebGl1TimerExtension,
): GpuTimerCollector {
  const pending: WebGl1TimerQuery[] = []
  let activeQuery: WebGl1TimerQuery | null = null

  return {
    mode: "webgl1",
    get pendingCount(): number {
      return pending.length
    },
    begin(): boolean {
      if (activeQuery !== null || pending.length >= MAX_PENDING_GPU_TIMER_QUERIES) {
        return false
      }
      activeQuery = extension.createQueryEXT()
      if (activeQuery === null) {
        return false
      }
      extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, activeQuery)
      return true
    },
    end(): void {
      if (activeQuery === null) {
        return
      }
      extension.endQueryEXT(extension.TIME_ELAPSED_EXT)
      pending.push(activeQuery)
      activeQuery = null
    },
    poll(): GpuTimerPollResult {
      const samplesMs: number[] = []
      let disjointCount = 0
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) === true
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const query = pending[index]
        if (
          query === undefined
          || extension.getQueryObjectEXT(query, extension.QUERY_RESULT_AVAILABLE_EXT) !== true
        ) {
          continue
        }
        pending.splice(index, 1)
        if (disjoint) {
          disjointCount += 1
        } else {
          const elapsedNanoseconds = Number(
            extension.getQueryObjectEXT(query, extension.QUERY_RESULT_EXT),
          )
          if (Number.isFinite(elapsedNanoseconds) && elapsedNanoseconds >= 0) {
            samplesMs.push(elapsedNanoseconds / 1_000_000)
          }
        }
        extension.deleteQueryEXT(query)
      }
      return { samplesMs, disjointCount }
    },
    destroy(): void {
      if (activeQuery !== null) {
        extension.endQueryEXT(extension.TIME_ELAPSED_EXT)
        extension.deleteQueryEXT(activeQuery)
        activeQuery = null
      }
      for (const query of pending) {
        extension.deleteQueryEXT(query)
      }
      pending.length = 0
    },
  }
}

function createUnavailableGpuTimerCollector(): GpuTimerCollector {
  return {
    mode: "unavailable",
    pendingCount: 0,
    begin: () => false,
    end: () => undefined,
    poll: () => ({ samplesMs: [], disjointCount: 0 }),
    destroy: () => undefined,
  }
}

function readMsaaSamples(
  gl: WebGLRenderingContext | WebGL2RenderingContext | undefined,
): number | null {
  if (gl === undefined) {
    return null
  }

  try {
    return normalizeFiniteNumber(gl.getParameter(gl.SAMPLES), 0)
  } catch {
    return null
  }
}

function normalizeDimension(value: unknown): number {
  return Math.max(0, Math.round(normalizeFiniteNumber(value, 0)))
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null
}

/** 材质 Mesh 位于实体内部，诊断时只隐藏流动层，保留底图和管壳。 */
function collectLogisticsMaterialFlowTargets(root: Container): VisibilityTarget[] {
  const result: VisibilityTarget[] = []
  const visit = (node: Container): void => {
    if (node.label === "logistics-material-flow") result.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return result
}
