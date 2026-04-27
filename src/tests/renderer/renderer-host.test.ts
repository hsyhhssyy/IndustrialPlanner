import { describe, expect, it, vi } from "vitest"

const { applicationState, createRenderSceneOrchestrator, createCustomTexture } = vi.hoisted(() => ({
  applicationState: {
    init: vi.fn(async () => undefined),
    canvas: { tagName: "CANVAS" } as HTMLCanvasElement,
    stage: {
      roundPixels: false,
    },
    renderer: {
      generateTexture: vi.fn(),
    },
  },
  createRenderSceneOrchestrator: vi.fn(),
  createCustomTexture: vi.fn(() => ({
    source: {
      style: {
        wrapMode: "repeat",
      },
    },
  })),
}))

vi.mock("pixi.js", () => {
  class MockApplication {
    public readonly init = applicationState.init
    public readonly canvas = applicationState.canvas
    public readonly stage = applicationState.stage
    public readonly renderer = applicationState.renderer
  }

  return {
    Application: MockApplication,
  }
})

vi.mock("@/renderer/scene/render-scene-orchestrator", () => ({
  createRenderSceneOrchestrator,
}))

vi.mock("@/renderer/texture/create-custom-texture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/texture/create-custom-texture")>()

  return {
    ...actual,
    createCustomTexture,
  }
})

import { createRenderHost } from "@/renderer/renderer-host"
import type { WorkspaceContract } from "@/domain/contract/workspace-contract"
import { CustomTextureKey } from "@/renderer/texture/create-custom-texture"

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
    expect(createCustomTexture).toHaveBeenCalledWith({
      key: CustomTextureKey.whiteScanLines,
      renderer: applicationState.renderer,
      textureConfig: renderHost.internalState.textureConfig,
    })
    expect(renderHost.internalState.textureConfig).toEqual({
      renderResolution: 3,
      bitmap: {
        scaleLimit: 2,
        sampling: {
          scaleMode: "linear",
          mipmap: false,
          mipmapFilter: "linear",
          maxAnisotropy: 1,
        },
      },
      custom: {
        repeatCompatibleResolution: 4,
        whiteScanLineRects: [
          { y: 0, height: 4 },
          { y: 5, height: 4 },
          { y: 10, height: 4 },
          { y: 15, height: 1 },
        ],
      },
    })
    expect(renderHost.internalState.customTextures[CustomTextureKey.whiteScanLines]).toBe(
      createCustomTexture.mock.results[0]?.value,
    )
    expect(createRenderSceneOrchestrator).toHaveBeenCalledWith(renderHost)
    expect(workspace.render).toBe(renderHost)
  })
})
