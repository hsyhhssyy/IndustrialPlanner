import { describe, expect, it } from "vitest";

import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import {
  createEntityDefinitionMap,
  resolveLogisticsDefinitionId,
  resolveLogisticsPathCells,
} from "@/editor/logistics/logistics-utils";
import { createRegistryContract } from "@/registry";

describe("resolveLogisticsPathCells", () => {
  const registry = createRegistryContract();
  const entityDefinitionMap = createEntityDefinitionMap(registry.entityDefinitions);

  it("uses the new E-to-N base rotation for clockwise belt bends", () => {
    const cells = resolveLogisticsPathCells({
      kind: "belt",
      points: [
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      source: null,
      target: null,
      document: createDummyWorldDocument(),
      entityDefinitionMap,
      replacingEntity: null,
      replacingDefinition: null,
    });

    expect(cells[1]).toMatchObject({
      fromEdge: "EAST",
      toEdge: "NORTH",
      shape: "turn-cw",
      rotation: 0,
    });
    expect(resolveLogisticsDefinitionId({ kind: "belt", shape: cells[1]?.shape ?? "straight" })).toBe(
      "belt_turn_cw_1x1",
    );
  });

  it("uses the new N-to-E base rotation for counterclockwise pipe bends", () => {
    const cells = resolveLogisticsPathCells({
      kind: "pipe",
      points: [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      source: null,
      target: null,
      document: createDummyWorldDocument(),
      entityDefinitionMap,
      replacingEntity: null,
      replacingDefinition: null,
    });

    expect(cells[1]).toMatchObject({
      fromEdge: "NORTH",
      toEdge: "EAST",
      shape: "turn-ccw",
      rotation: 0,
    });
    expect(resolveLogisticsDefinitionId({ kind: "pipe", shape: cells[1]?.shape ?? "straight" })).toBe(
      "pipe_turn_ccw_1x1",
    );
  });
});