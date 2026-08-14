import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { collectConnectedStrictLogisticsEntityIds } from "@/shared/transport-component";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);

describe("transport component collection", () => {
  it("does not include an adjacent pipe without reciprocal ports in whole-segment operations", () => {
    const selected = createPipe("selected", 0, 0, 0);
    const adjacentButDisconnected = createPipe("adjacent-disconnected", 1, 0, 90);

    expect(collectPipeSegment([selected, adjacentButDisconnected], selected.id)).toEqual(
      new Set([selected.id]),
    );
  });

  it("includes an adjacent pipe when both endpoint positions match", () => {
    const selected = createPipe("selected", 0, 0, 0);
    const connected = createPipe("connected", 1, 0, 0);

    expect(collectPipeSegment([selected, connected], selected.id)).toEqual(
      new Set([selected.id, connected.id]),
    );
  });
});

function collectPipeSegment(
  entities: readonly WorldEntity[],
  startEntityId: string,
): ReadonlySet<string> {
  const document = {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };

  return collectConnectedStrictLogisticsEntityIds({
    startEntityId,
    document,
    entityDefinitionMap,
    isDedicatedLogisticsDevice:
      registry.queries.isDedicatedLogisticsDevice.bind(registry.queries),
    resolveDedicatedLogisticsKind:
      registry.queries.resolveDedicatedLogisticsKind.bind(registry.queries),
    directions: ["input", "output"],
  });
}

function createPipe(
  id: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"],
): WorldEntity {
  return {
    id,
    definitionId: "pipe_straight_1x1",
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}
