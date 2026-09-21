import type { RenderFrameTime, RenderSurface } from "./render-surface"

const DEFAULT_FIRST_FRAME_DELTA_MS = 1000 / 60
const MAX_FRAME_DELTA_MS = 100

export interface RenderFrameDriver {
  request(callback: FrameRequestCallback): number
  cancel(handle: number): void
}

export interface RenderScheduler {
  start(): void
  destroy(): void
  readonly running: boolean
}

export function createBrowserRenderFrameDriver(): RenderFrameDriver {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  }
}

export function createRenderScheduler(options: {
  readonly listActiveSurfaces: () => readonly RenderSurface[]
  readonly advanceHostFrame: (frameTime: RenderFrameTime) => void
  readonly frameDriver?: RenderFrameDriver
  readonly onSurfaceError?: (surface: RenderSurface, error: unknown) => void
}): RenderScheduler {
  const frameDriver = options.frameDriver ?? createBrowserRenderFrameDriver()
  let frameHandle: number | null = null
  let lastFrameTimeMs: number | null = null
  let running = false

  const requestNextFrame = (): void => {
    if (!running || frameHandle !== null) {
      return
    }
    frameHandle = frameDriver.request(renderFrame)
  }

  const renderFrame = (nowMs: number): void => {
    frameHandle = null
    if (!running) {
      return
    }

    const rawDeltaMs = lastFrameTimeMs === null
      ? DEFAULT_FIRST_FRAME_DELTA_MS
      : Math.max(0, nowMs - lastFrameTimeMs)
    lastFrameTimeMs = nowMs
    const frameTime: RenderFrameTime = {
      nowMs,
      deltaMs: Math.min(MAX_FRAME_DELTA_MS, rawDeltaMs),
    }

    options.advanceHostFrame(frameTime)
    const surfaces = options.listActiveSurfaces()
    for (const surface of surfaces) {
      try {
        surface.renderFrame(frameTime)
      } catch (error) {
        if (options.onSurfaceError !== undefined) {
          options.onSurfaceError(surface, error)
        } else {
          console.error(`[RenderScheduler] Surface frame failed: ${surface.id}`, error)
        }
      }
    }

    requestNextFrame()
  }

  return {
    start: () => {
      if (running) {
        return
      }
      running = true
      lastFrameTimeMs = null
      requestNextFrame()
    },
    destroy: () => {
      if (!running && frameHandle === null) {
        return
      }
      running = false
      lastFrameTimeMs = null
      if (frameHandle !== null) {
        frameDriver.cancel(frameHandle)
        frameHandle = null
      }
    },
    get running() {
      return running
    },
  }
}
