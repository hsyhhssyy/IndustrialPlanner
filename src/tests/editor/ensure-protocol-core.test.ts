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
  const { queries, baseDefinitions } = createRegistryContract();

  it("initializes a draft box once and leaves an existing empty document empty", () => {
    const document = createWorldDocument({ baseId: "draft_box" });
    const initialized = ensureProtocolCoreEntity({ document, queries, baseDefinitions, isNewDocument: true });
    expect(initialized.entityOrder).toEqual(["protocol-core:draft_box"]);
    expect(initialized.entities["protocol-core:draft_box"]?.definitionId).toBe("sp_hub_1");
    expect(ensureProtocolCoreEntity({ document, queries, baseDefinitions })).toBe(document);
  });

  it("preserves multiple draft box cores, their types, configurations and links on load", () => {
    const primary = createProtocolCore("primary", "sp_hub_1");
    const secondary = createProtocolCore("secondary", "sp_sub_hub_1");
    const document = {
      ...createWorldDocument({ baseId: "draft_box" }),
      entities: { primary, secondary }, entityOrder: [primary.id, secondary.id],
      slotLinks: [{ id: "retained-link", linkType: "share-all" as const,
        source: { entityId: primary.id, storageSlotGroupId: "unbuffer_w2", slotId: "slot" },
        target: { entityId: secondary.id, storageSlotGroupId: "inbuffer_n2", slotId: "slot" } }],
    };
    expect(ensureProtocolCoreEntity({ document, queries, baseDefinitions })).toBe(document);
  });

  it("does not inject a core into agricultural land", () => {
    const document = createWorldDocument({ baseId: "wuling_agricultural_land" });
    expect(ensureProtocolCoreEntity({ document, queries, baseDefinitions })).toBe(document);
    expect(document.entityOrder).toEqual([]);
  });

  it("removes both core types from agricultural land and stays empty on subsequent loads", () => {
    const primary = createProtocolCore("primary", "sp_hub_1");
    const secondary = createProtocolCore("secondary", "sp_sub_hub_1");
    const document = {
      ...createWorldDocument({ baseId: "wuling_agricultural_land" }),
      entities: { primary, secondary },
      entityOrder: [primary.id, secondary.id],
    };
    const result = ensureProtocolCoreEntity({ document, queries, baseDefinitions });
    expect(result.entities).toEqual({});
    expect(result.entityOrder).toEqual([]);
    expect(ensureProtocolCoreEntity({ document: result, queries, baseDefinitions })).toBe(result);
    expect(document.entities).toEqual({ primary, secondary });
  });

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
      queries, baseDefinitions,
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

    const result = ensureProtocolCoreEntity({ document, queries, baseDefinitions });

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

    const result = ensureProtocolCoreEntity({ document, queries, baseDefinitions });

    expect(result.entities[core.id]).toEqual({
      ...core,
      definitionId: "sp_sub_hub_1",
    });
    expect(result.entityOrder).toEqual(document.entityOrder);
    expect(result.slotLinks).toEqual(document.slotLinks);
  });
});
