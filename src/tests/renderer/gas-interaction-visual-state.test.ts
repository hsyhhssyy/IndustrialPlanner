import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import {
  createGasInteractionDefinitionIndex,
  resolveGasInteractionVisualState,
} from "@/renderer/gas-interaction-visual-state";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);
const definitionIndex = createGasInteractionDefinitionIndex(
  registry.recipeDefinitions,
);

describe("resolveGasInteractionVisualState", () => {
  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights only fully contained gas-dependent devices during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = [
      createPreviewEntity("vaporizer-preview", "vaporizer_1", 0, 0),
      createEntity("fully-contained-oven", "xiranite_oven_1", 3, 0),
      createEntity("fully-contained-reactor", "gas_reactor_1", 3, 3),
      createEntity("partially-covered-oven", "xiranite_oven_1", 4, 0),
      createEntity("unrelated-storage", "storager_1", 3, 0),
    ];

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["vaporizer-preview"],
      ghostEntityIds: activeTool === "move" ? ["vaporizer-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "fully-contained-oven",
      "fully-contained-reactor",
    ]));
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every gas diffuser fully covering a gas-dependent preview during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    const entities = [
      createEntity("vaporizer-a", "vaporizer_1", 0, 0),
      createEntity("vaporizer-b", "vaporizer_1", 2, 0),
      createEntity("partially-covering-vaporizer", "vaporizer_1", 9, 0),
      createPreviewEntity("oven-preview", "xiranite_oven_1", 3, 0),
    ];

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: activeTool === "move" ? ["oven-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "vaporizer-a",
      "vaporizer-b",
    ]));
  });

  it("does not activate the interaction during a batch move", () => {
    const entities = [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
      createPreviewEntity("oven-preview", "xiranite_oven_1", 3, 0),
    ];

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: ["oven-original"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it("does not activate the interaction for multiple preview entities", () => {
    const entities = [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
      createPreviewEntity("oven-preview-a", "xiranite_oven_1", 3, 0),
      createPreviewEntity("oven-preview-b", "xiranite_oven_1", 3, 1),
    ];

    const state = resolveState({
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["oven-preview-a", "oven-preview-b"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });
});

function resolveState(options: {
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  return resolveGasInteractionVisualState({
    activeTool: options.activeTool,
    moveKind: options.moveKind,
    entities: options.entities,
    previewEntityIds: options.previewEntityIds,
    ghostEntityIds: options.ghostEntityIds ?? [],
    entityDefinitionMap,
    definitionIndex,
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
