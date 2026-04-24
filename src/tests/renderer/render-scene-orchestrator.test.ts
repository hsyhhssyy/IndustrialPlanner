import { describe, expect, it, vi } from "vitest"

import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import {
  applyViewportSize,
  resolveGenericDeviceSpriteTexturePath,
  resolveWorldEntitySpriteLayout,
  resolveWorldGridLineAxes,
} from "@/renderer/scene/render-scene-orchestrator"
import type { RenderHost } from "@/renderer/renderer-host"

describe("applyViewportSize", () => {
  it("resizes the renderer when device pixel ratio changes", () => {
    const resize = vi.fn()

    applyViewportSize(
      {
        renderer: {
          width: 640,
          height: 480,
          resolution: 1,
          resize,
        },
      } as unknown as RenderHost["app"],
      {
        width: 640,
        height: 480,
        resolution: 2,
      },
    )

    expect(resize).toHaveBeenCalledWith(640, 480, 2)
  })

  it("skips renderer resize when viewport size and resolution are unchanged", () => {
    const resize = vi.fn()

    applyViewportSize(
      {
        renderer: {
          width: 640,
          height: 480,
          resolution: 2,
          resize,
        },
      } as unknown as RenderHost["app"],
      {
        width: 640,
        height: 480,
        resolution: 2,
      },
    )

    expect(resize).not.toHaveBeenCalled()
  })
})

describe("resolveWorldEntitySpriteLayout", () => {
  it("projects the dummy belt entity into viewport space using registry footprint", () => {
    const document = createDummyWorldDocument()
    const entity = document.entities["dummy-entity-1"]
    const registry = createRegistryContract()

    expect(entity).toBeDefined()

    if (!entity) {
      throw new Error("Expected dummy belt entity to be present in document.")
    }

    const definition = registry.entityDefinitions.find(
      (item) => item.id === entity.definitionId,
    )

    expect(definition).toBeDefined()

    if (!definition) {
      throw new Error("Expected belt definition to be present in registry.")
    }

    const layout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      viewportBounds: {
        left: 12.5,
        top: 12.5,
        width: 392,
        height: 392,
      },
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridSize: 1,
    })

    expect(layout).toEqual({
      x: 400.5,
      y: 336.5,
      width: 16,
      height: 16,
      rotation: 0,
    })
  })
})

describe("resolveGenericDeviceSpriteTexturePath", () => {
  it("maps known device sprites to the scene sprite asset directory", () => {
    expect(resolveGenericDeviceSpriteTexturePath("item_port_storager_1")).toBe(
      "/sprites/item_port_storager_1.webp",
    )
  })

  it("resolves aliased sprite ids to the shipped sprite asset name", () => {
    expect(
      resolveGenericDeviceSpriteTexturePath("item_port_liquid_filling_pd_mc_1"),
    ).toBe("/sprites/item_port_filling_pd_mc_1.webp")
  })

  it("returns null when no default scene sprite asset exists", () => {
    expect(resolveGenericDeviceSpriteTexturePath("pipe_straight_1x1")).toBeNull()
  })
})

describe("resolveWorldGridLineAxes", () => {
  it("shifts visible grid lines with world viewport center", () => {
    const centeredAxes = resolveWorldGridLineAxes({
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridSize: 1,
    })

    const shiftedAxes = resolveWorldGridLineAxes({
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: {
        x: 0.5,
        y: 0.5,
      },
      gridSize: 1,
    })

    expect(centeredAxes.vertical.slice(0, 3)).toEqual([8, 24, 40])
    expect(centeredAxes.horizontal.slice(0, 3)).toEqual([8, 24, 40])
    expect(shiftedAxes.vertical.slice(0, 3)).toEqual([0, 16, 32])
    expect(shiftedAxes.horizontal.slice(0, 3)).toEqual([0, 16, 32])
  })
})
