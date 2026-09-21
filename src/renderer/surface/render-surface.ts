import type { Application } from "pixi.js"

export interface RenderFrameTime {
  readonly nowMs: number
  readonly deltaMs: number
}

export interface RenderSurfaceScene {
  sync(frameTime: RenderFrameTime): void
  beforeRender?(): void
  afterRender?(): void
  destroy(): void
}

export interface RenderSurface {
  readonly id: string
  readonly app: Application
  readonly canvas: HTMLCanvasElement
  renderFrame(frameTime: RenderFrameTime): void
  destroy(): void
}

export function createRenderSurface(options: {
  readonly id: string
  readonly app: Application
  readonly scene: RenderSurfaceScene
  readonly destroyResources: () => void
}): RenderSurface {
  let destroyed = false

  return {
    id: options.id,
    app: options.app,
    canvas: options.app.canvas,
    renderFrame: (frameTime) => {
      if (destroyed) {
        return
      }

      options.scene.sync(frameTime)
      options.scene.beforeRender?.()
      try {
        options.app.render()
      } finally {
        options.scene.afterRender?.()
      }
    },
    destroy: () => {
      if (destroyed) {
        return
      }

      destroyed = true
      try {
        options.scene.destroy()
      } finally {
        options.destroyResources()
      }
    },
  }
}
