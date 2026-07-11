import { describe, expect, it, vi } from "vitest"
import { Text } from "pixi.js"

import { createDummyWorldDocument } from "@/tests/helpers/dummy-document"
import { AYU_DARK_THEME, AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
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
  computeFadeAlpha,
  resolveWorldGridDisconnectedSegmentSpans,
  resolveWorldGridIntersectionDotSize,
  resolveWorldGridLocalViewportBounds,
  resolveWorldGridLineBoundsFromGridRect,
  resolveWorldGridMajorStrokeStyle,
  resolveWorldGridPreviewFocusLineBounds,
  resolveWorldGridRenderState,
  resolveWorldGridStrokeStyle,
  resolveWorldGridLineAxes,
  resolveWorldGridVisibilityScope,
  intersectWorldGridLineBounds,
  WORLD_GRID_ZOOM_THRESHOLD_A,
  WORLD_GRID_ZOOM_THRESHOLD_B,
  WORLD_GRID_ZOOM_THRESHOLD_C,
  WORLD_GRID_ZOOM_THRESHOLD_D,
  WORLD_GRID_ZOOM_THRESHOLD_E,
} from "@/renderer/scene/decorations/GridLineDecoration"
import {
  resolveMarqueeGridRectLayout,
  resolveMarqueeGridRectStrokeStyle,
  resolveWorldAuxiliaryStrokeWidth,
} from "@/renderer/scene/decorations/MarqueeRectDecoration"
import {
  createInvalidPlacementDecoration,
  resolveInvalidPlacementToastReasonText,
} from "@/renderer/scene/decorations/InvalidPlacementDecoration"
import { resolvePowerRangeOutlineLayouts } from "@/renderer/scene/decorations/PowerRangeDecoration"
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

  it("projects entity layout through display rotation without moving world data", () => {
    const layout = resolveWorldEntitySpriteLayout({
      entity: {
        id: "display-rotated",
        definitionId: "custom_2x1",
        position: {
          x: 1,
          y: 0,
        },
        rotation: 0,
        config: {},
        tags: [],
      },
      footprint: {
        width: 2,
        height: 1,
      },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      },
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridCellPixelSize: 10,
      displayRotation: 90,
    })

    expect(layout).toEqual({
      x: 90,
      y: 110,
      width: 10,
      height: 20,
      rotation: 90,
    })
  })

  it("offsets sprite layout when sprite is larger than footprint (water pump at rotation=0)", () => {
    const layout = resolveWorldEntitySpriteLayout({
      entity: {
        id: "water-pump",
        definitionId: "item_port_water_pump_1",
        position: { x: 10, y: 5 },
        rotation: 0,
        config: {},
        tags: [],
      },
      footprint: { width: 3, height: 3 },
      spriteOffset: { x: -2, y: 0, width: 5, height: 3 },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    // rotation=0, offset (-2,0) → sprite at (10-2, 5) = (8, 5), size 5×3
    // viewport: center(200,200), gridCellPixelSize=10
    // corner (8,5) → (200 + 80, 200 + 50) = (280, 250)
    expect(layout).toMatchObject({
      x: 280,
      y: 250,
      width: 50,
      height: 30,
      rotation: 0,
    })
  })

  it("offsets sprite layout when sprite is larger than footprint (water pump at rotation=90)", () => {
    const layout = resolveWorldEntitySpriteLayout({
      entity: {
        id: "water-pump-90",
        definitionId: "item_port_water_pump_1",
        position: { x: 10, y: 5 },
        rotation: 90,
        config: {},
        tags: [],
      },
      footprint: { width: 3, height: 3 },
      spriteOffset: { x: -2, y: 0, width: 5, height: 3 },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    // rotation=90, offset rotates: (-2,0,5,3) → (0,-2,3,5)
    // sprite at (10+0, 5-2) = (10, 3), size 3×5
    // viewport: center(200,200), gridCellPixelSize=10
    // corner (10,3) → (200 + 100, 200 + 30) = (300, 230)
    expect(layout).toMatchObject({
      x: 300,
      y: 230,
      width: 30,
      height: 50,
      rotation: 90,
    })
  })

  it("offsets sprite layout when sprite is larger than footprint (water pump at rotation=180)", () => {
    const layout = resolveWorldEntitySpriteLayout({
      entity: {
        id: "water-pump-180",
        definitionId: "item_port_water_pump_1",
        position: { x: 10, y: 5 },
        rotation: 180,
        config: {},
        tags: [],
      },
      footprint: { width: 3, height: 3 },
      spriteOffset: { x: -2, y: 0, width: 5, height: 3 },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    expect(layout).toMatchObject({
      x: 300,
      y: 250,
      width: 50,
      height: 30,
      rotation: 180,
    })
  })

  it("offsets sprite layout when sprite is larger than footprint (water pump at rotation=270)", () => {
    const layout = resolveWorldEntitySpriteLayout({
      entity: {
        id: "water-pump-270",
        definitionId: "item_port_water_pump_1",
        position: { x: 10, y: 5 },
        rotation: 270,
        config: {},
        tags: [],
      },
      footprint: { width: 3, height: 3 },
      spriteOffset: { x: -2, y: 0, width: 5, height: 3 },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    expect(layout).toMatchObject({
      x: 300,
      y: 250,
      width: 30,
      height: 50,
      rotation: 270,
    })
  })

  it("behaves identically to null offset when spriteOffset is not provided", () => {
    const withNull = resolveWorldEntitySpriteLayout({
      entity: {
        id: "test",
        definitionId: "belt_straight_1x1",
        position: { x: 2, y: 3 },
        rotation: 0,
        config: {},
        tags: [],
      },
      footprint: { width: 2, height: 1 },
      spriteOffset: undefined,
      viewportBounds: {
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    const withoutKey = resolveWorldEntitySpriteLayout({
      entity: {
        id: "test",
        definitionId: "belt_straight_1x1",
        position: { x: 2, y: 3 },
        rotation: 0,
        config: {},
        tags: [],
      },
      footprint: { width: 2, height: 1 },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      },
      viewportCenter: { x: 0, y: 0 },
      gridCellPixelSize: 10,
    })

    expect(withNull).toEqual(withoutKey)
  })
})

describe("resolveInvalidPlacementToastReasonText", () => {
  it("hides the overlap toast for 1x1 invalid placements", () => {
    expect(resolveInvalidPlacementToastReasonText({
      gridRect: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      validation: {
        canPlace: false,
        reasons: [{
          code: "overlap",
          message: "不能与其他设备重叠",
        }],
      },
    })).toBeNull()

    expect(resolveInvalidPlacementToastReasonText({
      gridRect: {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
      },
      validation: {
        canPlace: false,
        reasons: [{
          code: "overlap",
          message: "不能与其他设备重叠",
        }],
      },
    })).toBe("不能与其他设备重叠")

    expect(resolveInvalidPlacementToastReasonText({
      gridRect: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      validation: {
        canPlace: false,
        reasons: [
          {
            code: "outside-base",
            message: "必须放置在基地内",
          },
          {
            code: "overlap",
            message: "不能与其他设备重叠",
          },
        ],
      },
    })).toBe("必须放置在基地内")
  })
})

describe("createInvalidPlacementDecoration", () => {
  it("renders preview invalid placement reason text", () => {
    const decoration = createInvalidPlacementDecoration()
    const preview = createCollection(["preview-water-node"])
    const invalidPlacement = createCollection(["preview-water-node"])
    const registry = createRegistryContract()

    decoration.sync({
      viewportState: {
        width: 320,
        height: 240,
        resolution: 1,
        centerX: 0,
        centerY: 0,
        gridCellPixelSize: 10,
        displayRotation: 0,
      },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 320,
        height: 240,
      },
      renderHost: {
        workspace: {
          app: null,
          registry,
          editor: {
            state: {
              collections: {
                [EntityCollectionType.preview]: preview,
                [EntityCollectionType.invalidPlacement]: invalidPlacement,
              },
            },
            queries: {
              getEntityById: (entityId: string) =>
                entityId === "preview-water-node"
                  ? {
                    id: entityId,
                    definitionId: "item_water_purifier_node_1",
                    position: { x: 0, y: 0 },
                    rotation: 0,
                    config: {},
                    tags: [],
                  }
                  : null,
              getEntityPlacementValidation: () => ({
                canPlace: false,
                reasons: [{
                  code: "outside-base",
                  message: "必须靠近地图边缘放置",
                }],
              }),
            },
          },
        },
      } as unknown as RenderHost,
      theme: AYU_DARK_THEME,
      nowMs: 0,
    })

    const reasonText = decoration.container.children.find((child): child is Text =>
      child instanceof Text,
    )

    expect(reasonText?.text).toBe("必须靠近地图边缘放置")
    expect(reasonText?.visible).toBe(true)

    decoration.destroy()
  })
})

function createCollection(entityIds: readonly string[]) {
  const collection = [...entityIds] as string[] & {
    contains(entityId: string): boolean;
  }
  collection.contains = (entityId: string) => collection.includes(entityId)
  return collection
}

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

  it("projects marquee grid rects through display rotation", () => {
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
        displayRotation: 90,
      }),
    ).toEqual({
      x: 136,
      y: 216,
      width: 32,
      height: 48,
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

describe("resolvePowerRangeOutlineLayouts", () => {
  it("keeps rendering a power range when the power pole body is outside the viewport", () => {
    const registry = createRegistryContract()
    const entityDefinitionMap = new Map(
      registry.entityDefinitions.map((definition) => [definition.id, definition]),
    )

    const layouts = resolvePowerRangeOutlineLayouts({
      entities: [{
        id: "pole",
        definitionId: "item_port_power_diffuser_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      }],
      entityDefinitionMap,
      visibleWorldRect: {
        left: 6.5,
        top: 0,
        right: 10,
        bottom: 3,
      },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      },
      viewportCenter: {
        x: 8,
        y: 1.5,
      },
      gridCellPixelSize: 10,
    })

    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({
      width: 120,
      height: 120,
    })
  })

  it("culls power range outlines only after the range itself leaves the viewport", () => {
    const registry = createRegistryContract()
    const entityDefinitionMap = new Map(
      registry.entityDefinitions.map((definition) => [definition.id, definition]),
    )

    expect(resolvePowerRangeOutlineLayouts({
      entities: [{
        id: "pole",
        definitionId: "item_port_power_diffuser_1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      }],
      entityDefinitionMap,
      visibleWorldRect: {
        left: 8,
        top: 0,
        right: 10,
        bottom: 3,
      },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      },
      viewportCenter: {
        x: 9,
        y: 1.5,
      },
      gridCellPixelSize: 10,
    })).toEqual([])
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

  it("hides fine grid lines once zoom reaches threshold D", () => {
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
      gridCellPixelSize: WORLD_GRID_ZOOM_THRESHOLD_D,
    })

    expect(axes.vertical.fine).toEqual([])
    expect(axes.horizontal.fine).toEqual([])
    expect(axes.vertical.major.length).toBeGreaterThan(0)
    expect(axes.horizontal.major.length).toBeGreaterThan(0)
  })

  it("keeps fine grid lines visible above threshold D", () => {
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
      gridCellPixelSize: (WORLD_GRID_ZOOM_THRESHOLD_C + WORLD_GRID_ZOOM_THRESHOLD_D) / 2,
    })

    expect(axes.vertical.fine.length).toBeGreaterThan(0)
    expect(axes.horizontal.fine.length).toBeGreaterThan(0)
    expect(axes.vertical.major.length).toBeGreaterThan(0)
    expect(axes.horizontal.major.length).toBeGreaterThan(0)
  })

  it("returns no visible axes at or below threshold E", () => {
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
      gridCellPixelSize: WORLD_GRID_ZOOM_THRESHOLD_E,
    })

    expect(axes).toEqual({
      vertical: {
        fine: [],
        major: [],
      },
      horizontal: {
        fine: [],
        major: [],
      },
    })
  })
})

describe("computeFadeAlpha", () => {
  it("linearly interpolates alpha across the configured interval", () => {
    expect(computeFadeAlpha(WORLD_GRID_ZOOM_THRESHOLD_C, WORLD_GRID_ZOOM_THRESHOLD_C, WORLD_GRID_ZOOM_THRESHOLD_D)).toBe(1)
    expect(computeFadeAlpha(
      (WORLD_GRID_ZOOM_THRESHOLD_C + WORLD_GRID_ZOOM_THRESHOLD_D) / 2,
      WORLD_GRID_ZOOM_THRESHOLD_C,
      WORLD_GRID_ZOOM_THRESHOLD_D,
    )).toBeCloseTo(0.5)
    expect(computeFadeAlpha(WORLD_GRID_ZOOM_THRESHOLD_D, WORLD_GRID_ZOOM_THRESHOLD_C, WORLD_GRID_ZOOM_THRESHOLD_D)).toBe(0)
  })
})

describe("resolveWorldGridRenderState", () => {
  it("switches pixel snapping in two stages across the upper three levels", () => {
    expect(resolveWorldGridRenderState(WORLD_GRID_ZOOM_THRESHOLD_A)).toMatchObject({
      finePixelLine: false,
      majorPixelLine: false,
      majorWidth: 2,
      dotMaxSize: 2,
    })

    expect(resolveWorldGridRenderState(
      (WORLD_GRID_ZOOM_THRESHOLD_A + WORLD_GRID_ZOOM_THRESHOLD_B) / 2,
    )).toMatchObject({
      finePixelLine: true,
      majorPixelLine: false,
      majorWidth: 2,
      dotMaxSize: 2,
    })

    expect(resolveWorldGridRenderState(
      (WORLD_GRID_ZOOM_THRESHOLD_B + WORLD_GRID_ZOOM_THRESHOLD_C) / 2,
    )).toMatchObject({
      finePixelLine: true,
      majorPixelLine: true,
      majorWidth: 2,
      dotMaxSize: 2,
    })
  })

  it("fades fine lines before coarse lines and dots", () => {
    const state = resolveWorldGridRenderState(
      (WORLD_GRID_ZOOM_THRESHOLD_C + WORLD_GRID_ZOOM_THRESHOLD_D) / 2,
    )

    expect(state.fineVisible).toBe(true)
    expect(state.fineAlpha).toBeCloseTo(0.5)
    expect(state.majorVisible).toBe(true)
    expect(state.majorAlpha).toBe(1)
    expect(state.majorWidth).toBe(1)
    expect(state.dotVisible).toBe(true)
    expect(state.dotAlpha).toBe(1)
    expect(state.dotMaxSize).toBe(1)
  })

  it("fades coarse grid elements to zero between D and E", () => {
    const fadingState = resolveWorldGridRenderState(
      (WORLD_GRID_ZOOM_THRESHOLD_D + WORLD_GRID_ZOOM_THRESHOLD_E) / 2,
    )
    const hiddenState = resolveWorldGridRenderState(WORLD_GRID_ZOOM_THRESHOLD_E)

    expect(fadingState.fineVisible).toBe(false)
    expect(fadingState.majorVisible).toBe(true)
    expect(fadingState.majorAlpha).toBeCloseTo(0.5)
    expect(fadingState.dotVisible).toBe(true)
    expect(fadingState.dotAlpha).toBeCloseTo(0.5)

    expect(hiddenState).toMatchObject({
      fineVisible: false,
      majorVisible: false,
      dotVisible: false,
      majorAlpha: 0,
      dotAlpha: 0,
    })
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

describe("resolveWorldGridLineBoundsFromGridRect", () => {
  it("converts a grid rect into line bounds using the exclusive right and bottom edge", () => {
    expect(resolveWorldGridLineBoundsFromGridRect({
      x: -7,
      y: -7,
      width: 94,
      height: 94,
    })).toEqual({
      left: -7,
      top: -7,
      right: 87,
      bottom: 87,
    })
  })

  it("returns null for invalid grid rects", () => {
    expect(resolveWorldGridLineBoundsFromGridRect({
      x: 0,
      y: 0,
      width: 0,
      height: 10,
    })).toBeNull()
  })
})

describe("intersectWorldGridLineBounds", () => {
  it("clips preview-local grid visibility to the base warning bounds", () => {
    expect(intersectWorldGridLineBounds(
      {
        left: -7,
        top: -7,
        right: 87,
        bottom: 87,
      },
      {
        left: 80,
        top: 80,
        right: 100,
        bottom: 100,
      },
    )).toEqual({
      left: 80,
      top: 80,
      right: 87,
      bottom: 87,
    })
  })

  it("returns null when the requested local region is fully outside the base warning bounds", () => {
    expect(intersectWorldGridLineBounds(
      {
        left: -7,
        top: -7,
        right: 87,
        bottom: 87,
      },
      {
        left: 90,
        top: 90,
        right: 100,
        bottom: 100,
      },
    )).toBeNull()
  })
})

describe("resolveWorldGridIntersectionDotSize", () => {
  it("caps dot size by the active grid level instead of a fixed min and max", () => {
    expect(resolveWorldGridIntersectionDotSize(WORLD_GRID_ZOOM_THRESHOLD_C)).toBe(2)
    expect(resolveWorldGridIntersectionDotSize(
      (WORLD_GRID_ZOOM_THRESHOLD_C + WORLD_GRID_ZOOM_THRESHOLD_D) / 2,
    )).toBe(1)
    expect(resolveWorldGridIntersectionDotSize(
      (WORLD_GRID_ZOOM_THRESHOLD_D + WORLD_GRID_ZOOM_THRESHOLD_E) / 2,
    )).toBe(1)
  })
})

describe("resolveWorldGridStrokeStyle", () => {
  it("uses a 1px base stroke for fine grid lines", () => {
    expect(resolveWorldGridStrokeStyle(AYU_DARK_THEME)).toEqual({
      width: 1,
      color: 0xffffff,
      alpha: 0.30,
    })
  })

  it("resolves the editor grid color from the current theme renderer key", () => {
    expect(resolveWorldGridStrokeStyle(AYU_LIGHT_THEME).color).toBe(0x5c6773)
  })

  it("uses a 2px stroke for major grid lines and forwards pixelLine when requested", () => {
    expect(resolveWorldGridMajorStrokeStyle(AYU_DARK_THEME)).toEqual({
      width: 2,
      color: 0xffffff,
      alpha: 0.30,
    })

    expect(resolveWorldGridMajorStrokeStyle(AYU_DARK_THEME, {
      alpha: 0.15,
      pixelLine: true,
    })).toEqual({
      width: 2,
      color: 0xffffff,
      alpha: 0.15,
      pixelLine: true,
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
