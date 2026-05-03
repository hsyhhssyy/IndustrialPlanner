import { describe, expect, it, vi } from "vitest"

import { createDummyWorldDocument } from "@/editor/dummy-document"
import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { createRegistryContract } from "@/registry"
import {
  applyViewportSize,
  resolveWorldEntitySelectionOverlayLayouts,
  resolveWorldEntitySelectionStrokeStyle,
  resolveWorldEntitySelectionStrokeWidth,
  resolveWorldEntitySpriteLayout,
} from "@/renderer/scene/render-scene-orchestrator"
import {
  clipWorldGridLineAxesToViewportBounds,
  resolveWorldGridDisconnectedSegmentSpans,
  resolveWorldGridIntersectionDotSize,
  resolveWorldGridLocalViewportBounds,
  resolveWorldGridMajorStrokeStyle,
  resolveWorldGridPreviewFocusLineBounds,
  resolveWorldGridStrokeStyle,
  resolveWorldGridLineAxes,
  resolveWorldGridVisibilityScope,
} from "@/renderer/scene/decorations/GridLineDecoration"
import {
  resolveMarqueeGridRectLayout,
  resolveMarqueeGridRectStrokeStyle,
  resolveWorldAuxiliaryStrokeWidth,
} from "@/renderer/scene/decorations/MarqueeRectDecoration"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
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
      gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
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
      entities: [
        {
          id: "selected",
          definitionId: "item_port_unloader_1",
          position: { x: 4, y: 6 },
          rotation: 90,
          config: {},
          tags: [],
        },
        {
          id: "unselected",
          definitionId: "item_port_unloader_1",
          position: { x: 8, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
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
      gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
    })

    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({
      width: 16,
      height: 48,
      rotation: 90,
    })
  })

  it("returns overlay layouts for selected draft-only entities", () => {
    const registry = createRegistryContract()
    const entityDefinitionMap = new Map(
      registry.entityDefinitions.map((definition) => [definition.id, definition]),
    )

    const layouts = resolveWorldEntitySelectionOverlayLayouts({
      entities: [
        {
          id: "draft-only",
          definitionId: "belt_straight_1x1",
          position: { x: 2, y: 3 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
      entityDefinitionMap,
      selectedEntityIds: ["draft-only"],
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
      gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
    })

    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({
      width: 16,
      height: 16,
      rotation: 0,
    })
  })
})

describe("resolveMarqueeGridRectLayout", () => {
  it("projects marquee grid rects into viewport space", () => {
    expect(
      resolveMarqueeGridRectLayout({
        gridRect: {
          x: 1,
          y: 2,
          width: 3,
          height: 2,
        },
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
        gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
      }),
    ).toEqual({
      x: 216,
      y: 232,
      width: 48,
      height: 32,
    })
  })

  it("returns null for invalid marquee grid rects", () => {
    expect(
      resolveMarqueeGridRectLayout({
        gridRect: {
          x: 1,
          y: 2,
          width: 0,
          height: 2,
        },
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
        gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
      }),
    ).toBeNull()
  })
})

describe("resolveMarqueeGridRectStrokeStyle", () => {
  it("uses theme-aware stroke color with 1.5x auxiliary stroke width", () => {
    const baseWidth = resolveWorldAuxiliaryStrokeWidth(WORLD_GRID_CELL_PIXEL_SIZE)
    expect(resolveMarqueeGridRectStrokeStyle(WORLD_GRID_CELL_PIXEL_SIZE, AYU_DARK_THEME)).toEqual({
      width: baseWidth * 1.5,
      color: 0xffffff,
    })
    expect(resolveMarqueeGridRectStrokeStyle(WORLD_GRID_CELL_PIXEL_SIZE, AYU_LIGHT_THEME)).toEqual({
      width: baseWidth * 1.5,
      color: 0x000000,
    })
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
      gridCellPixelSize: 80,
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
      gridCellPixelSize: 80,
    })

    expect(centeredAxes.vertical.fine).toEqual([40, 120, 280, 360])
    expect(centeredAxes.horizontal.fine).toEqual([40, 120, 280, 360])
    expect(centeredAxes.vertical.major).toEqual([200])
    expect(centeredAxes.horizontal.major).toEqual([200])
    expect(shiftedAxes.vertical.fine).toEqual([0, 80, 240, 320, 400])
    expect(shiftedAxes.horizontal.fine).toEqual([0, 80, 240, 320, 400])
    expect(shiftedAxes.vertical.major).toEqual([160])
    expect(shiftedAxes.horizontal.major).toEqual([160])
  })

  it("hides fine grid lines when cells are smaller than 10 pixels", () => {
    const axes = resolveWorldGridLineAxes({
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
      gridCellPixelSize: 9,
    })

    expect(axes.vertical.fine).toEqual([])
    expect(axes.horizontal.fine).toEqual([])
    expect(axes.vertical.major.slice(0, 3)).toEqual([20, 65, 110])
    expect(axes.horizontal.major.slice(0, 3)).toEqual([20, 65, 110])
  })

  it("keeps fine grid lines visible at 10 pixels", () => {
    const axes = resolveWorldGridLineAxes({
      viewportBounds: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      },
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridCellPixelSize: 10,
    })

    expect(axes.vertical.fine).toEqual([10, 20, 30, 40, 60, 70, 80, 90])
    expect(axes.horizontal.fine).toEqual([10, 20, 30, 40, 60, 70, 80, 90])
    expect(axes.vertical.major).toEqual([0, 50, 100])
    expect(axes.horizontal.major).toEqual([0, 50, 100])
  })
})

describe("resolveWorldGridDisconnectedSegmentSpans", () => {
  it("centers a short segment inside every gap between visible axes", () => {
    expect(
      resolveWorldGridDisconnectedSegmentSpans({
        axisPositions: [40, 120, 200],
        viewportStart: 0,
        viewportSpan: 240,
      }),
    ).toEqual([
      { start: 10, end: 30 },
      { start: 60, end: 100 },
      { start: 140, end: 180 },
      { start: 210, end: 230 },
    ])
  })

  it("keeps edge spans stable when an axis sits on the viewport boundary", () => {
    expect(
      resolveWorldGridDisconnectedSegmentSpans({
        axisPositions: [100, 0, 50],
        viewportStart: 0,
        viewportSpan: 100,
      }),
    ).toEqual([
      { start: 12.5, end: 37.5 },
      { start: 62.5, end: 87.5 },
    ])
  })
})

describe("resolveWorldGridPreviewFocusLineBounds", () => {
  it("uses the larger range between expanded preview bounds and the minimum center span", () => {
    expect(
      resolveWorldGridPreviewFocusLineBounds({
        x: 10,
        y: 20,
        width: 2,
        height: 3,
      }),
    ).toEqual({
      left: 3,
      top: 13,
      right: 20,
      bottom: 30,
    })
  })

  it("keeps larger previews on their expanded bounding range", () => {
    expect(
      resolveWorldGridPreviewFocusLineBounds({
        x: 10,
        y: 4,
        width: 30,
        height: 2,
      }),
    ).toEqual({
      left: 6,
      top: -3,
      right: 44,
      bottom: 14,
    })
  })
})

describe("resolveWorldGridVisibilityScope", () => {
  it("keeps the existing full-grid behavior when always-show is enabled", () => {
    expect(
      resolveWorldGridVisibilityScope({
        alwaysShowGridLines: true,
        activeTool: "select",
        previewGridRect: null,
      }),
    ).toEqual({ kind: "all" })
  })

  it("shows the full grid in marquee mode even when always-show is disabled", () => {
    expect(
      resolveWorldGridVisibilityScope({
        alwaysShowGridLines: false,
        activeTool: "marquee",
        previewGridRect: null,
      }),
    ).toEqual({ kind: "all" })
  })

  it("hides the grid outside marquee mode when there is no preview", () => {
    expect(
      resolveWorldGridVisibilityScope({
        alwaysShowGridLines: false,
        activeTool: "single-placement",
        previewGridRect: null,
      }),
    ).toEqual({ kind: "hidden" })
  })

  it("returns a local focus window when preview content exists", () => {
    expect(
      resolveWorldGridVisibilityScope({
        alwaysShowGridLines: false,
        activeTool: "move",
        previewGridRect: {
          x: 10,
          y: 20,
          width: 2,
          height: 3,
        },
      }),
    ).toEqual({
      kind: "local",
      lineBounds: {
        left: 3,
        top: 13,
        right: 20,
        bottom: 30,
      },
    })
  })
})

describe("resolveWorldGridLocalViewportBounds", () => {
  it("projects local world line bounds into clipped viewport pixel bounds", () => {
    expect(
      resolveWorldGridLocalViewportBounds({
        viewportBounds: {
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        },
        viewportCenter: {
          x: 0,
          y: 0,
        },
        gridCellPixelSize: 10,
        lineBounds: {
          left: -2,
          top: -1,
          right: 3,
          bottom: 2,
        },
      }),
    ).toEqual({
      left: 30,
      top: 40,
      width: 50,
      height: 30,
    })
  })

  it("clips local grid lines from the full viewport without shifting them", () => {
    const viewportBounds = {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    }
    const drawViewportBounds = resolveWorldGridLocalViewportBounds({
      viewportBounds,
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridCellPixelSize: 10,
      lineBounds: {
        left: -2,
        top: -1,
        right: 3,
        bottom: 2,
      },
    })

    expect(drawViewportBounds).not.toBeNull()

    const lineAxes = clipWorldGridLineAxesToViewportBounds({
      lineAxes: resolveWorldGridLineAxes({
        viewportBounds,
        viewportCenter: {
          x: 0,
          y: 0,
        },
        gridCellPixelSize: 10,
      }),
      viewportBounds: drawViewportBounds!,
    })

    expect(lineAxes.vertical.fine).toEqual([30, 40, 60, 70, 80])
    expect(lineAxes.vertical.major).toEqual([50])
    expect(lineAxes.horizontal.fine).toEqual([40, 60, 70])
    expect(lineAxes.horizontal.major).toEqual([50])
  })
})

describe("resolveWorldGridIntersectionDotSize", () => {
  it("uses a single dot size rule for the current zoom level", () => {
    expect(resolveWorldGridIntersectionDotSize(8)).toBe(2.5)
    expect(resolveWorldGridIntersectionDotSize(15)).toBe(3.5999999999999996)
    expect(resolveWorldGridIntersectionDotSize(40)).toBe(4.5)
  })
})

describe("resolveWorldGridStrokeStyle", () => {
  it("uses a pixel-perfect 1.5px stroke for the editor grid", () => {
    expect(resolveWorldGridStrokeStyle(AYU_DARK_THEME)).toEqual({
      width: 1.5,
      color: 0xffffff,
      alpha: 0.30,
    })
  })

  it("resolves the editor grid color from the current theme renderer key", () => {
    expect(resolveWorldGridStrokeStyle(AYU_LIGHT_THEME).color).toBe(0x5c6773)
  })

  it("uses a 3x stroke for major grid lines", () => {
    expect(resolveWorldGridMajorStrokeStyle(AYU_DARK_THEME)).toEqual({
      width: 3,
      color: 0xffffff,
      alpha: 0.30,
    })
  })
})

describe("resolveWorldEntitySelectionStrokeWidth", () => {
  it("scales with zoom and clamps to the configured range", () => {
    expect(resolveWorldEntitySelectionStrokeWidth(WORLD_GRID_CELL_PIXEL_SIZE / 4)).toBe(1)
    expect(resolveWorldEntitySelectionStrokeWidth(WORLD_GRID_CELL_PIXEL_SIZE)).toBe(2)
    expect(resolveWorldEntitySelectionStrokeWidth(WORLD_GRID_CELL_PIXEL_SIZE * 3)).toBe(4)
  })
})

describe("resolveWorldEntitySelectionStrokeStyle", () => {
  it("reads the selection outline color from the theme renderer key", () => {
    expect(
      resolveWorldEntitySelectionStrokeStyle({
        theme: AYU_DARK_THEME,
        gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
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
        gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE * 2,
      }).color,
    ).toBe(0xffa500)
  })
})
