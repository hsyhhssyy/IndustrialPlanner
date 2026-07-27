import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveOverlappingEntityCandidatesAtClientPoint } from "@/app/input/gesture/actions/hypergryph/overlap-entity-candidates";

describe("overlap entity candidates logistics suppression", () => {
  it("skips a suppressed pipe admission and exposes the overlapping belt", () => {
    const belt = createEntity("belt", "belt_straight_1x1");
    const pipeAdmission = createEntity("pipe-admission", "pipe_admission");
    const editor = {
      state: {
        suppressBelts: false,
        suppressPipes: true,
      },
      queries: {
        findGridCellForClientPixelPoint: () => ({ x: 5, y: 5 }),
        listEntities: () => [belt, pipeAdmission],
      },
    };
    const appHost = {
      workspace: {
        editor,
        registry: {
          entityDefinitions: [
            createDefinition("belt_straight_1x1"),
            createDefinition("pipe_admission"),
          ],
          queries: createLogisticsQueries(),
        },
      },
    };

    expect(resolveOverlappingEntityCandidatesAtClientPoint({
      appHost: appHost as never,
      editor: editor as never,
      position: { clientX: 0, clientY: 0 } as never,
      pointerEntity: pipeAdmission,
    }).map((entity) => entity.id)).toEqual(["belt"]);
  });

  it("rejects a suppressed pointer fallback when entity listing is unavailable", () => {
    const pipeAdmission = createEntity("pipe-admission", "pipe_admission");
    const editor = {
      state: {
        suppressBelts: false,
        suppressPipes: true,
      },
      queries: {
        findGridCellForClientPixelPoint: () => ({ x: 5, y: 5 }),
      },
    };
    const appHost = {
      workspace: {
        editor,
        registry: {
          entityDefinitions: [createDefinition("pipe_admission")],
          queries: createLogisticsQueries(),
        },
      },
    };

    expect(resolveOverlappingEntityCandidatesAtClientPoint({
      appHost: appHost as never,
      editor: editor as never,
      position: { clientX: 0, clientY: 0 } as never,
      pointerEntity: pipeAdmission,
    })).toEqual([]);
  });
});

function createEntity(id: string, definitionId: string): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 5, y: 5 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function createDefinition(id: string): EntityDefinition {
  return {
    id,
    nameKey: `registry.entity.${id}.name`,
    spriteId: id,
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: 0,
    tags: [],
    placementBehaviors: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    inspectors: [],
  };
}

function createLogisticsQueries() {
  return {
    isBeltFamily: (definitionId: string) => definitionId === "belt_straight_1x1",
    isPipeFamily: (definitionId: string) => definitionId === "pipe_admission",
    isBeltLogistics: () => false,
    isPipeLogistics: (definitionId: string) => definitionId === "pipe_admission",
  };
}
