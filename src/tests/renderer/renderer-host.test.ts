import { describe, expect, it, vi } from "vitest"

const { applicationState, createRenderSceneOrchestrator } = vi.hoisted(() => ({
  applicationState: {
    init: vi.fn(async () => undefined),
    canvas: { tagName: "CANVAS" } as HTMLCanvasElement,
    stage: {
      roundPixels: false,
    },
  },
  createRenderSceneOrchestrator: vi.fn(),
}))

vi.mock("pixi.js", () => {
  class MockApplication {
    public readonly init = applicationState.init
    public readonly canvas = applicationState.canvas
    public readonly stage = applicationState.stage
  }

  return {
    Application: MockApplication,
  }
})

vi.mock("@/renderer/scene/render-scene-orchestrator", () => ({
  createRenderSceneOrchestrator,
}))

import { createRenderHost } from "@/renderer/renderer-host"
import type { WorkspaceContract } from "@/domain/contract/workspace-contract"

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
    expect(createRenderSceneOrchestrator).toHaveBeenCalledWith(renderHost)
    expect(workspace.render).toBe(renderHost)
  })
})
