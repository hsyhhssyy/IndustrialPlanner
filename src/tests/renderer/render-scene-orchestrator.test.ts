import { describe, expect, it } from "vitest"

import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import {
  resolveWorldEntitySpriteLayout,
  resolveWorldGridLineAxes,
} from "@/renderer/scene/render-scene-orchestrator"

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