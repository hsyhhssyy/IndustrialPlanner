import type { Application, Container } from "pixi.js"

export const PIXI_RENDER_LAYER_PROFILE_STORAGE_KEY = "industrial-planner:pixi-render-layer-profile"
export const PIXI_RENDER_ANTIALIAS_STORAGE_KEY = "industrial-planner:pixi-render-antialias"

const MAX_PENDING_GPU_TIMER_QUERIES = 8

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
  readonly pipeFlow: Container;
  readonly beltFlow: Container;
  readonly beltInsertion: Container;
  readonly beltCargo: Container;
  readonly entities: readonly Container[];
}

export interface PixiRenderDiagnosticsSnapshot {
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
  beforeRender(profiler: PixiDiagnosticProfiler | null): void;
  afterRender(profiler: PixiDiagnosticProfiler | null): void;
  readSnapshot(): PixiRenderDiagnosticsSnapshot;
  destroy(): void;
}

interface FrameCounters {
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
  readonly layers: PixiRenderDiagnosticLayerTargets;
}): PixiRenderDiagnostics {
  const renderer = options.app.renderer as unknown as RendererInternals
  const counters: FrameCounters = createEmptyFrameCounters()
  const hookRestorers: Array<() => void> = []
  const installedHooks: string[] = []
  const hiddenTargets: Array<{
    readonly target: VisibilityTarget;
    readonly visible: boolean;
  }> = []
  let enabled = false
  let trackingRender = false
  let layerProfile: PixiRenderLayerProfile = "full"
  let gpuTimer: GpuTimerCollector = createUnavailableGpuTimerCollector()
  let msaaSamples: number | null = null

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
    layerProfile = "full"
    msaaSamples = null
    enabled = false
  }

  return {
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

      return {
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
      targets = [layers.pipeFlow]
      break
    case "without-belt-flow":
      targets = [layers.beltFlow]
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
