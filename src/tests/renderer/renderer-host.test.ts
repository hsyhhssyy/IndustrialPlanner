import { describe, expect, it, vi } from "vitest"

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
    expect(renderHost.internalState.logisticsSuppression).toBeNull()
    renderHost.actions.setLogisticsSuppression?.("pipe")
    expect(renderHost.internalState.logisticsSuppression).toBe("pipe")
    renderHost.actions.setLogisticsSuppression?.(null)
    expect(renderHost.internalState.logisticsSuppression).toBeNull()
    expect(createRenderSceneOrchestrator).toHaveBeenCalledWith(renderHost)
    expect(workspace.render).toBe(renderHost)
  })

  it("owns orchestrator, texture manager, and app teardown from host.destroy", async () => {
    const orchestratorDestroy = vi.fn()
    createRenderSceneOrchestrator.mockReturnValueOnce({
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
