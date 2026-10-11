import { describe, expect, it } from "vitest";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import {
  removeForbiddenProtocolCoreEntities,
  resolveProtocolCoreDefinitionIdForBase,
} from "@/shared/protocol-core";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";

function createDocument() {
  const entities: WorldEntity[] = [
    { id: "primary", definitionId: "sp_hub_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
    { id: "secondary", definitionId: "sp_sub_hub_1", position: { x: 50, y: 0 }, rotation: 0, config: {}, tags: [] },
    { id: "belt", definitionId: "belt_straight_1x1", position: { x: 10, y: 10 }, rotation: 0, config: {}, tags: [] },
  ];
  return {
    ...createWorldDocument({ baseId: "wuling_agricultural_land" }),
    entities: Object.fromEntries(entities.map(entity => [entity.id, entity])),
    entityOrder: entities.map(entity => entity.id),
    slotLinks: [
      { id: "core-source", sourceId: "primary", targetId: "warehouse" },
      { id: "core-target", sourceId: "belt", targetId: "secondary" },
      { id: "retained", sourceId: "belt", targetId: "warehouse" },
    ].map(({ id, sourceId, targetId }) => ({
      id, linkType: "share-all" as const,
      source: { entityId: sourceId, storageSlotGroupId: "group", slotId: "slot" },
      target: { entityId: targetId, storageSlotGroupId: "group", slotId: "slot" },
    })),
  };
}

describe("基地协议核心规则", () => {
  it("明确区分无核心基地、主核心、次级核心和未知基地的默认值", () => {
    expect(resolveProtocolCoreDefinitionIdForBase("wuling_agricultural_land")).toBeNull();
    expect(resolveProtocolCoreDefinitionIdForBase("wuling_protocol_core")).toBe("sp_hub_1");
    expect(resolveProtocolCoreDefinitionIdForBase("wuling_tianwangping_aid")).toBe("sp_sub_hub_1");
    expect(resolveProtocolCoreDefinitionIdForBase("unknown-base")).toBe("sp_hub_1");
  });

  it("清理两个区域的两种核心及源端或目标端连线，保留其余内容和输入数据", () => {
    const document = createDocument();
    const original = structuredClone(document);
    const result = removeForbiddenProtocolCoreEntities(document);
    expect(Object.keys(result.entities)).toEqual(["belt"]);
    expect(result.entityOrder).toEqual(["belt"]);
    expect(result.slotLinks.map(link => link.id)).toEqual(["retained"]);
    expect(result.entities.belt).toBe(document.entities.belt);
    expect(result.meta).toBe(document.meta);
    expect(result.documentSettings).toBe(document.documentSettings);
    expect(result.regions).toBe(document.regions);
    expect(document).toEqual(original);
    expect(removeForbiddenProtocolCoreEntities(result)).toBe(result);
  });

  it("空农牧用地和普通基地保持原文档引用", () => {
    const empty = createWorldDocument({ baseId: "wuling_agricultural_land" });
    const ordinary = { ...createDocument(), baseId: "wuling_protocol_core" };
    expect(removeForbiddenProtocolCoreEntities(empty)).toBe(empty);
    expect(removeForbiddenProtocolCoreEntities(ordinary)).toBe(ordinary);
  });

  it("不带目标基地的蓝图数据保留核心，禁放规则由目标基地决定", () => {
    const document = createDocument();
    const blueprintState = {
      entities: document.entities,
      entityOrder: document.entityOrder,
      slotLinks: document.slotLinks,
    };
    expect(removeForbiddenProtocolCoreEntities(blueprintState)).toBe(blueprintState);
  });

  it.each([5, 6, 7])("schema %s 的农牧用地在公共解码入口清理核心，重新解码不会补回", schemaVersion => {
    const document = { ...createDocument(), schemaVersion };
    const result = normalizeWorldDocument(document);
    expect(result?.schemaVersion).toBe(7);
    expect(Object.keys(result?.entities ?? {})).toEqual(["belt"]);
    expect(result?.entityOrder).toEqual(["belt"]);
    expect(result?.slotLinks.map(link => link.id)).toEqual(["retained"]);
    expect(normalizeWorldDocument(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(document.entities.primary?.definitionId).toBe("sp_hub_1");
    expect(document.entities.secondary?.definitionId).toBe("sp_sub_hub_1");
  });
});
