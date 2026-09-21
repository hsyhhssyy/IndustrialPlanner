import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { applicationState, createRenderSceneOrchestrator } = vi.hoisted(() => ({
  applicationState: {
    init: vi.fn(async () => undefined),
    canvas: document.createElement("canvas"),
    stage: {
      roundPixels: false,
    },
    renderer: {
      generateTexture: vi.fn(),
    },
    destroy: vi.fn(),
    render: vi.fn(),
  },
  createRenderSceneOrchestrator: vi.fn(),
}))

vi.mock("pixi.js", () => {
  class MockApplication {
    public readonly init = applicationState.init
    public readonly canvas = applicationState.canvas
    public readonly stage = applicationState.stage
    public readonly renderer = applicationState.renderer
    public readonly destroy = applicationState.destroy
    public readonly render = applicationState.render
  }

  return {
    Application: MockApplication,
  }
})

vi.mock("@/renderer/scene/render-scene-orchestrator", () => ({
  createRenderSceneOrchestrator,
}))

import { createRenderHost } from "@/renderer/renderer-host"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"

describe("createRenderHost", () => {
  beforeEach(() => {
    applicationState.init.mockClear()
    applicationState.destroy.mockClear()
    applicationState.render.mockClear()
    applicationState.stage.roundPixels = false
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    createRenderSceneOrchestrator.mockReset()
    createRenderSceneOrchestrator.mockReturnValue({
      sync: vi.fn(),
      beforeRender: vi.fn(),
      afterRender: vi.fn(),
      destroy: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("enables autoDensity and roundPixels for high-dpr canvas rendering", async () => {
    const workspace = {
      state: {} as never,
      registry: {} as never,
      app: {
        state: {
          screenProfile: {
            devicePixelRatio: 3,
          },
        },
      },
      editor: {
        state: {
          viewport: {
            clientRect: {
              width: 640,
              height: 480,
            },
          },
        },
      },
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract

    const renderHost = await createRenderHost(workspace)

    expect(applicationState.init).toHaveBeenCalledWith({
      width: 640,
      height: 480,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      autoStart: false,
      resolution: 3,
      preference: "webgl",
    })
    expect(applicationState.stage.roundPixels).toBe(true)
    expect(renderHost.container).toBeInstanceOf(HTMLDivElement)
    expect(renderHost.container.contains(applicationState.canvas)).toBe(true)
    expect(renderHost.internalState.textureConfig).toEqual({
      renderResolution: 3,
      bitmap: {
        scaleLimit: 2,
        sampling: {
          scaleMode: "linear",
          autoGenerateMipmaps: true,
          mipmapFilter: "linear",
          maxAnisotropy: 4,
        },
      },
    })
    expect(createRenderSceneOrchestrator).toHaveBeenCalledWith(
      renderHost,
      renderHost.textureManager.performanceDiagnostics,
    )
    expect(workspace.render).toBe(renderHost)
    renderHost.destroy()
  })

  it("owns orchestrator, texture manager, and app teardown from host.destroy", async () => {
    const orchestratorDestroy = vi.fn()
    createRenderSceneOrchestrator.mockReturnValueOnce({
      sync: vi.fn(),
      beforeRender: vi.fn(),
      afterRender: vi.fn(),
      destroy: orchestratorDestroy,
    })

    const workspace = {
      state: {} as never,
      registry: {} as never,
      app: {
        state: {
          screenProfile: {
            devicePixelRatio: 2,
          },
        },
      },
      editor: {
        state: {
          viewport: {
            clientRect: {
              width: 320,
              height: 240,
            },
          },
        },
      },
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract

    const renderHost = await createRenderHost(workspace)
    const textureManagerDestroy = vi.spyOn(renderHost.textureManager, "destroy")

    renderHost.destroy()

    expect(orchestratorDestroy).toHaveBeenCalledTimes(1)
    expect(textureManagerDestroy).toHaveBeenCalledTimes(1)
    expect(applicationState.destroy).toHaveBeenCalledTimes(1)
  })
})
