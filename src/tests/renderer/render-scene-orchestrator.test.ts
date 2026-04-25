import { describe, expect, it, vi } from "vitest"

import { createDummyWorldDocument } from "@/editor/dummy-document"
import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { createRegistryContract } from "@/registry"
import {
  applyViewportSize,
  resolveGenericDeviceSpriteTexturePath,
  resolveWorldEntitySelectionOverlayLayouts,
  resolveWorldEntitySelectionStrokeStyle,
  resolveWorldEntitySelectionStrokeWidth,
  resolveWorldEntitySpriteLayout,
  resolveWorldGridStrokeStyle,
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

describe("resolveWorldEntitySelectionOverlayLayouts", () => {
  it("returns overlay layouts only for selected entities and respects rotated footprints", () => {
    const registry = createRegistryContract()
    const entityDefinitionMap = new Map(
      registry.entityDefinitions.map((definition) => [definition.id, definition]),
    )

    const layouts = resolveWorldEntitySelectionOverlayLayouts({
      document: {
        schemaVersion: 1,
        baseId: "test-world",
        meta: {
          id: "test-world",
          name: "Test World",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        entities: {
          selected: {
            id: "selected",
            definitionId: "item_port_unloader_1",
            position: { x: 4, y: 6 },
            rotation: 90,
            config: {},
            tags: [],
          },
          unselected: {
            id: "unselected",
            definitionId: "item_port_unloader_1",
            position: { x: 8, y: 10 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["selected", "unselected"],
        explicitLinks: [],
        documentSettings: {
          gridSize: 1,
          showDiagnostics: false,
        },
      },
      entityDefinitionMap,
      selectedEntityIds: ["selected", "missing"],
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

    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({
      width: 16,
      height: 48,
      rotation: 90,
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

describe("resolveWorldGridStrokeStyle", () => {
  it("uses a pixel-perfect 1px stroke for the editor grid", () => {
    expect(resolveWorldGridStrokeStyle(AYU_DARK_THEME)).toEqual({
      width: 1,
      color: 0xffffff,
      alpha: 0.12,
      pixelLine: true,
    })
  })

  it("resolves the editor grid color from the current theme renderer key", () => {
    expect(resolveWorldGridStrokeStyle(AYU_LIGHT_THEME).color).toBe(0x5c6773)
  })
})

describe("resolveWorldEntitySelectionStrokeWidth", () => {
  it("scales with zoom and clamps to the configured range", () => {
    expect(resolveWorldEntitySelectionStrokeWidth(0.25)).toBe(1)
    expect(resolveWorldEntitySelectionStrokeWidth(1)).toBe(2)
    expect(resolveWorldEntitySelectionStrokeWidth(3)).toBe(4)
  })
})

describe("resolveWorldEntitySelectionStrokeStyle", () => {
  it("reads the selection outline color from the theme renderer key", () => {
    expect(
      resolveWorldEntitySelectionStrokeStyle({
        theme: AYU_DARK_THEME,
        gridSize: 1,
      }),
    ).toEqual({
      width: 2,
      color: 0xffa500,
    })
  })

  it("keeps the light theme selection outline on the same orange token", () => {
    expect(
      resolveWorldEntitySelectionStrokeStyle({
        theme: AYU_LIGHT_THEME,
        gridSize: 2,
      }).color,
    ).toBe(0xffa500)
  })
})
