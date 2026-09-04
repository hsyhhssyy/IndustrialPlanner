import { describe, expect, it } from "vitest";

import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import {
  admitWorldDocumentForSimulation,
  collectUnknownWorldEntityDefinitionIssues,
} from "@/shared/world-document-unknown-entities";

describe("world document unknown entity definitions", () => {
  it("reports unknown definitions with positions and related link counts", () => {
    const document = createUnknownEntityDocument();

    expect(collectUnknownWorldEntityDefinitionIssues({
      document,
      entityDefinitions: [{ id: "storager_1" }],
    })).toEqual([
      {
        entityId: "base-builtin:test:broken",
        definitionId: "missing-builtin",
        position: { x: 8, y: 9 },
        relatedSlotLinkCount: 1,
        origin: "base-builtin",
      },
      {
        entityId: "transmuter_2:1",
        definitionId: "transmuter_2",
        position: { x: 3, y: 4 },
        relatedSlotLinkCount: 1,
        origin: "document",
      },
    ]);
  });

  it("excludes only ordinary unknown entities from a compile copy", () => {
    const document = createUnknownEntityDocument();
    const originalEntities = document.entities;
    const originalEntityOrder = document.entityOrder;
    const originalSlotLinks = document.slotLinks;

    const admission = admitWorldDocumentForSimulation({
      document,
      entityDefinitions: [{ id: "storager_1" }],
    });

    expect(admission.excludedIssues.map((issue) => issue.entityId)).toEqual([
      "transmuter_2:1",
    ]);
    expect(Object.keys(admission.document.entities)).toEqual([
      "storage",
      "base-builtin:test:broken",
    ]);
    expect(admission.document.entityOrder).toEqual([
      "storage",
      "base-builtin:test:broken",
    ]);
    expect(admission.document.slotLinks.map((link) => link.id)).toEqual([
      "builtin-to-warehouse",
    ]);
    expect(document.entities).toBe(originalEntities);
    expect(document.entityOrder).toBe(originalEntityOrder);
    expect(document.slotLinks).toBe(originalSlotLinks);
    expect(document.entities["transmuter_2:1"]).toBeDefined();
  });
});

function createUnknownEntityDocument() {
  const document = createWorldDocument({ baseId: "wuling_protocol_core" });
  const entities: WorldEntity[] = [
    createEntity("storage", "storager_1", 0, 0),
    createEntity("transmuter_2:1", "transmuter_2", 3, 4),
    createEntity("base-builtin:test:broken", "missing-builtin", 8, 9),
  ];
  return {
    ...document,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
    slotLinks: [
      {
        id: "unknown-to-warehouse",
        linkType: "share-all" as const,
        source: {
          entityId: "transmuter_2:1",
          storageSlotGroupId: "output",
          slotId: "slot",
        },
        target: {
          entityId: "warehouse",
          storageSlotGroupId: "warehouse",
          slotId: "item",
        },
      },
      {
        id: "builtin-to-warehouse",
        linkType: "share-all" as const,
        source: {
          entityId: "base-builtin:test:broken",
          storageSlotGroupId: "output",
          slotId: "slot",
        },
        target: {
          entityId: "warehouse",
          storageSlotGroupId: "warehouse",
          slotId: "item",
        },
      },
    ],
  };
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
