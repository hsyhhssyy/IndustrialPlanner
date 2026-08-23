import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { resolvePowerInteractionVisualState } from "@/renderer/power-interaction-visual-state";
import {
  areGridRectsIntersecting,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);

describe("resolvePowerInteractionVisualState", () => {
  it("shows every range without power-specific highlights when the setting is enabled", () => {
    const entities = [
      createEntity("power", "power_diffuser_1", 0, 0),
      createPreviewEntity("storage-preview", "storager_1", 3, 0),
    ];

    const state = resolveState({
      alwaysShowPowerRange: true,
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["storage-preview"],
    });

    expect(state.visiblePowerRangeEntityIds).toBeNull();
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every power pole covering a protocol storage footprint during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = [
      createEntity("power-a", "power_diffuser_1", 0, 0),
      createEntity("power-b", "power_diffuser_1", 8, 0),
      createPreviewEntity("storage-preview", "storager_1", 5, 0),
    ];

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: activeTool === "move" ? ["storage"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-a", "power-b"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["power-a", "power-b"]));
  });

  it("does not activate the interaction during a batch move", () => {
    const entities = [
      createEntity("power", "power_diffuser_1", 0, 0),
      createPreviewEntity("storage-preview", "storager_1", 3, 0),
    ];

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: ["storage"],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set());
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every consuming device in a preview power pole range during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = [
      createPreviewEntity("power-preview", "power_diffuser_1", 0, 0),
      createEntity("protocol-storage", "storager_1", 4, 0),
      createEntity("outside-storage", "storager_1", 20, 0),
      createEntity("zero-demand", "power_diffuser_1", 4, 3),
    ];

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["power-preview"],
      ghostEntityIds: activeTool === "move" ? ["power-original"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-preview"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["protocol-storage"]));
  });
});

function resolveState(options: {
  alwaysShowPowerRange?: boolean;
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  return resolvePowerInteractionVisualState({
    alwaysShowPowerRange: options.alwaysShowPowerRange ?? false,
    activeTool: options.activeTool,
    moveKind: options.moveKind,
    entities: options.entities,
    previewEntityIds: options.previewEntityIds,
    ghostEntityIds: options.ghostEntityIds ?? [],
    entityDefinitionMap,
    listPowerRangeProvidersCoveringGridRect: (gridRect) =>
      listPowerRangeProvidersCoveringGridRect(options.entities, gridRect),
  });
}

function listPowerRangeProvidersCoveringGridRect(
  entities: readonly WorldEntity[],
  gridRect: GridRect,
): readonly WorldEntity[] {
  return entities.filter((entity) => {
    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return false;
    }

    const powerRangeGridRect = resolvePowerRangeGridRect({ entity, definition });
    return powerRangeGridRect !== null
      && areGridRectsIntersecting(powerRangeGridRect, gridRect);
  });
}

function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function createPreviewEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
): WorldEntity & { readonly originalEntityId: string } {
  return {
    ...createEntity(id, definitionId, x, y),
    originalEntityId: id,
  };
}
