import type { RenderSurface } from "./render-surface"

export type RenderSurfaceLifecycleState = "initializing" | "active" | "disposed"

interface RenderSurfaceEntry {
  readonly id: string
  state: RenderSurfaceLifecycleState
  surface: RenderSurface | null
}

export interface RenderSurfaceRegistry {
  beginInitializing(id: string): void
  activate(surface: RenderSurface): boolean
  dispose(id: string): void
  get(id: string): RenderSurface | null
  listActive(): readonly RenderSurface[]
  getState(id: string): RenderSurfaceLifecycleState | null
  destroy(): void
}

export function createRenderSurfaceRegistry(): RenderSurfaceRegistry {
  const entries = new Map<string, RenderSurfaceEntry>()
  let destroyed = false

  return {
    beginInitializing: (id) => {
      if (destroyed) {
        throw new Error("Cannot initialize a render surface after registry destruction.")
      }
      if (entries.has(id)) {
        throw new Error(`Render surface already exists: ${id}`)
      }

      entries.set(id, {
        id,
        state: "initializing",
        surface: null,
      })
    },
    activate: (surface) => {
      const entry = entries.get(surface.id)
      if (destroyed || entry === undefined || entry.state !== "initializing") {
        surface.destroy()
        return false
      }

      entry.surface = surface
      entry.state = "active"
      return true
    },
    dispose: (id) => {
      const entry = entries.get(id)
      if (entry === undefined || entry.state === "disposed") {
        return
      }

      entry.state = "disposed"
      const surface = entry.surface
      entry.surface = null
      entries.delete(id)
      surface?.destroy()
    },
    get: (id) => {
      const entry = entries.get(id)
      return entry?.state === "active" ? entry.surface : null
    },
    listActive: () => [...entries.values()].flatMap((entry) => (
      entry.state === "active" && entry.surface !== null ? [entry.surface] : []
    )),
    getState: (id) => entries.get(id)?.state ?? null,
    destroy: () => {
      if (destroyed) {
        return
      }

      destroyed = true
      const destroyErrors: unknown[] = []
      for (const entry of entries.values()) {
        entry.state = "disposed"
        try {
          entry.surface?.destroy()
        } catch (error) {
          destroyErrors.push(error)
        }
        entry.surface = null
      }
      entries.clear()
      if (destroyErrors.length > 0) {
        throw destroyErrors[0]
      }
    },
  }
}
