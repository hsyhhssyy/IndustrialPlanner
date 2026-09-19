import { describe, expect, it } from "vitest";

import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { ensureProtocolCoreEntity } from "@/editor/ensure-protocol-core";
import { createRegistryContract } from "@/registry";

function createProtocolCore(
  id: string,
  definitionId: "sp_hub_1" | "sp_sub_hub_1",
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 7, y: 9 },
    rotation: 180,
    config: { retained: true },
    tags: ["retained"],
  };
}

describe("ensureProtocolCoreEntity", () => {
  const queries = createRegistryContract().queries;

  it.each([
    ["wuling_protocol_core", "sp_hub_1"],
    ["valley4_protocol_core", "sp_hub_1"],
    ["wuling_tianwangping_aid", "sp_sub_hub_1"],
    ["wuling_heart_repair_station", "sp_sub_hub_1"],
    ["stm_hongs_3", "sp_sub_hub_1"],
    ["valley4_refugee_shelter", "sp_sub_hub_1"],
    ["valley4_infra_outpost", "sp_sub_hub_1"],
    ["valley4_rebuilt_command", "sp_sub_hub_1"],
  ])("injects the expected protocol core for %s", (baseId, definitionId) => {
    const result = ensureProtocolCoreEntity({
      document: createWorldDocument({ baseId }),
      queries,
    });

    expect(result.entityOrder).toEqual([`protocol-core:${baseId}`]);
    expect(result.entities[`protocol-core:${baseId}`]?.definitionId).toBe(definitionId);
  });

  it("retains the expected core and removes duplicate cores", () => {
    const legacy = createProtocolCore("legacy-core", "sp_hub_1");
    const retained = createProtocolCore("retained-core", "sp_sub_hub_1");
    const document = {
      ...createWorldDocument({ baseId: "valley4_infra_outpost" }),
      entities: {
        [legacy.id]: legacy,
        [retained.id]: retained,
      },
      entityOrder: [legacy.id, retained.id],
      slotLinks: [{
        id: "retained-link",
        linkType: "share-all" as const,
        source: { entityId: retained.id, storageSlotGroupId: "source", slotId: "slot" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item" },
      }],
    };

    const result = ensureProtocolCoreEntity({ document, queries });

    expect(result.entities).toEqual({ [retained.id]: retained });
    expect(result.entityOrder).toEqual([retained.id]);
    expect(result.slotLinks).toEqual(document.slotLinks);
  });

  it("preserves identity, transform, config, tags, order and links while replacing a wrong core", () => {
    const core = createProtocolCore("legacy-core", "sp_hub_1");
    const document = {
      ...createWorldDocument({ baseId: "wuling_tianwangping_aid" }),
      entities: { [core.id]: core },
      entityOrder: [core.id],
      slotLinks: [{
        id: "retained-link",
        linkType: "share-all" as const,
        source: { entityId: core.id, storageSlotGroupId: "source", slotId: "slot" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item" },
      }],
    };

    const result = ensureProtocolCoreEntity({ document, queries });

    expect(result.entities[core.id]).toEqual({
      ...core,
      definitionId: "sp_sub_hub_1",
    });
    expect(result.entityOrder).toEqual(document.entityOrder);
    expect(result.slotLinks).toEqual(document.slotLinks);
  });
});
