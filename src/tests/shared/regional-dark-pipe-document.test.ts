import { describe, expect, it } from "vitest";

import { BLUEPRINT_SCHEMA_VERSION, createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createWorldDocument, WORLD_DOCUMENT_SCHEMA_VERSION } from "@/domain/document/world-document";
import type { SlotLinkDefinition } from "@/domain/shared/slot-link";
import { createDarkPipeSlotLink, findDarkPipeSlotLinkForEntity, listDocumentRegionalDarkPipeLinks } from "@/shared/dark-pipe-link";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import fixture from "../fixtures/blueprints/collections-extra/app/input/dark-pipe-link-gesture-module/scene-01-variant-1.schema6.json";

const baseId = fixture.baseId;
const localLink = createDarkPipeSlotLink({ inletEntityId: "inlet", outletEntityId: "outlet" });
const remoteLink: SlotLinkDefinition = {
  ...localLink,
  id: "remote-link",
  target: { ...localLink.target, baseId: "another-base" },
};

function documentWithLinks(slotLinks: SlotLinkDefinition[]) {
  const blueprint = normalizeBlueprintDocument(fixture)!;
  return {
    ...createWorldDocument({ baseId }),
    entities: blueprint.entities,
    entityOrder: blueprint.entityOrder,
    slotLinks,
  };
}

describe("文档中的跨基地暗管引用", () => {
  it("出口文档产生唯一关系，入口无需镜像；远端同名入口不会成为普通链接", () => {
    const outletDocument = documentWithLinks([remoteLink]);
    const inletDocument = { ...documentWithLinks([]), baseId: "another-base" };

    expect(listDocumentRegionalDarkPipeLinks([outletDocument, inletDocument])).toEqual([{
      id: remoteLink.id,
      outlet: { baseId, entityId: "outlet" },
      inlet: { baseId: "another-base", entityId: "inlet" },
    }]);
    expect(findDarkPipeSlotLinkForEntity(outletDocument, "outlet")).toBeNull();
    expect(findDarkPipeSlotLinkForEntity(outletDocument, "inlet")).toBeNull();
    expect(normalizeWorldDocument(outletDocument)?.slotLinks).toEqual([remoteLink]);
  });

  it("本地显式基地引用仍可解析为普通链接", () => {
    const explicitLocal = { ...localLink, target: { ...localLink.target, baseId } };
    const document = documentWithLinks([explicitLocal]);
    expect(findDarkPipeSlotLinkForEntity(document, "inlet")).toBe(explicitLocal);
    expect(listDocumentRegionalDarkPipeLinks([document])).toEqual([]);
  });

  it("蓝图过滤两端外部引用，保留内部连接并转为相对端点，源文档不变", () => {
    const explicitLocal = {
      ...localLink,
      source: { ...localLink.source, baseId },
      target: { ...localLink.target, baseId },
    };
    const foreignSource = { ...localLink, id: "foreign-source", source: { ...localLink.source, baseId: "another-base" } };
    const source = documentWithLinks([remoteLink, explicitLocal, foreignSource]);
    const before = JSON.stringify(source);
    const blueprint = createBlueprintDocument({ ...fixture, entities: source.entities, slotLinks: source.slotLinks });

    expect(blueprint.slotLinks).toEqual([localLink]);
    expect(blueprint.slotLinks[0]?.source).not.toHaveProperty("baseId");
    expect(blueprint.slotLinks[0]?.target).not.toHaveProperty("baseId");
    expect(JSON.stringify(source)).toBe(before);
    expect(blueprint.schemaVersion).toBe(6);
  });

  it.each([5, 6])("schema %i 蓝图读取仍以当前 6 为目标，世界文档不丢失跨基地引用", (schemaVersion) => {
    const input = { ...fixture, schemaVersion, slotLinks: [remoteLink, localLink] };
    const blueprint = normalizeBlueprintDocument(input);

    expect(BLUEPRINT_SCHEMA_VERSION).toBe(6);
    expect(WORLD_DOCUMENT_SCHEMA_VERSION).toBe(6);
    expect(blueprint?.schemaVersion).toBe(6);
    expect(blueprint?.slotLinks).toEqual([localLink]);
    expect(input.slotLinks).toEqual([remoteLink, localLink]);
    expect(normalizeWorldDocument({ ...documentWithLinks([remoteLink]), schemaVersion })?.slotLinks).toEqual([remoteLink]);
  });
});
