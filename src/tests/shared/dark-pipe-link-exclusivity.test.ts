import { describe, expect, it } from "vitest";

import type { SlotLinkDefinition } from "@/domain/document/world-document";
import { createWorldDocument } from "@/domain/document/world-document";
import { filterDarkPipeOutletWarehouseLinks, prepareDarkPipeLinkDocument } from "@/shared/dark-pipe-link";
import fixture from "../fixtures/blueprints/collections-extra/app/input/dark-pipe-link-gesture-module/scene-01-variant-1.schema6.json";

const warehouseLink: SlotLinkDefinition = {
  id: "warehouse-link:outlet",
  linkType: "share-all",
  source: { entityId: "outlet", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
  target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item_water" },
};

describe("暗管出口来源互斥", () => {
  it("远端同名出口的仓库引用不属于当前出口", () => {
    const remote = { ...warehouseLink, source: { ...warehouseLink.source, baseId: "remote-base" } };
    const explicitLocal = { ...warehouseLink, source: { ...warehouseLink.source, baseId: "local-base" } };
    expect(filterDarkPipeOutletWarehouseLinks([remote, explicitLocal], "outlet", "local-base")).toEqual([remote]);
  });
  it.each(["warehouse", "warehouse:wuling_protocol_core"])("移除出口指向 %s 的仓库链接，保留其他槽位", (warehouseId) => {
    const targetLink = { ...warehouseLink, target: { ...warehouseLink.target, entityId: warehouseId } };
    const otherEntity = { ...warehouseLink, id: "other", source: { ...warehouseLink.source, entityId: "other" } };
    const otherSlot = { ...warehouseLink, id: "other-slot", source: { ...warehouseLink.source, slotId: "slot_2" } };
    const transport = { ...warehouseLink, id: "transport", source: { ...warehouseLink.source, storageSlotGroupId: "transport_input" } };

    expect(filterDarkPipeOutletWarehouseLinks([targetLink, otherEntity, otherSlot, transport], "outlet"))
      .toEqual([otherEntity, otherSlot, transport]);
  });

  it("跨基地只清理所在文档中的参与端点，且重复处理不产生新快照", () => {
    const document = {
      ...createWorldDocument({ baseId: fixture.baseId }),
      entities: {
        inlet: { ...fixture.entities.inlet, rotation: 0 as const, config: { unrelated: true } },
        outlet: { ...fixture.entities.outlet, rotation: 0 as const, config: { "storageSlotGroups[0].slots[0].ignoreStock": true } },
      },
      entityOrder: [...fixture.entityOrder],
      slotLinks: [warehouseLink],
    };

    const prepared = prepareDarkPipeLinkDocument(document, ["outlet"]);

    expect(prepared.slotLinks).toEqual([]);
    expect(prepared.entities.outlet?.config).toEqual({});
    expect(prepared.entities.inlet).toBe(document.entities.inlet);
    expect(document.slotLinks).toEqual([warehouseLink]);
    expect(prepareDarkPipeLinkDocument(prepared, ["outlet"])).toBe(prepared);
  });
});
