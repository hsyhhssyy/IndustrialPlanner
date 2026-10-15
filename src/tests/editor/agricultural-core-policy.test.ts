import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { createEditorHost } from "@/editor/editor-host";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("无核心基地过滤蓝图中两种核心及其链接，保留跨区域普通设备并持久化", async () => {
  const { app, workspace } = createAppTestWorkspace();
  let editor = createEditorHost(workspace);
  try {
    await editor.internalDocuments.ready();
    expect(await editor.actions.loadLatestBaseDocument("wuling_agricultural_land")).toBe(true);
    expect(editor.document.getSnapshot().entityOrder).toEqual([]);
    // 被测动作就是蓝图摆放。当前地图两块区域从 x=0、104 起步，旧 E2E 的 50 偏移已过时。
    const entities: WorldEntity[] = [
      { id: "primary", definitionId: "sp_hub_1", position: { x: 0, y: 0 } },
      { id: "secondary", definitionId: "sp_sub_hub_1", position: { x: 104, y: 0 } },
      { id: "left", definitionId: "belt_straight_1x1", position: { x: 12, y: 12 } },
      { id: "right", definitionId: "belt_straight_1x1", position: { x: 116, y: 12 } },
    ].map(entity => ({ ...entity, rotation: 0, config: {}, tags: [] }));
    const blueprint = createBlueprintDocument({
      name: "核心过滤", baseId: "wuling_protocol_core", initialGridPoint: { x: 64, y: 12 },
      entities: Object.fromEntries(entities.map(entity => [entity.id, entity])),
      entityOrder: entities.map(entity => entity.id),
      slotLinks: [{ id: "core-warehouse-link", linkType: "share-all",
        source: { entityId: "primary", storageSlotGroupId: "unbuffer_w2", slotId: "output_w2_slot_1" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item" } }],
    });
    editor.actions.createBlueprintPlacementDraft!(blueprint, { x: 64, y: 12 });
    expect(editor.internalState.drafts.map(entity => entity.definitionId))
      .toEqual(["belt_straight_1x1", "belt_straight_1x1"]);
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    editor.actions.cancelPlacementDraft();
    const placed = editor.document.getSnapshot();
    expect(placed.slotLinks).toEqual([]);
    expect(Object.values(placed.entities).map(entity => entity.definitionId))
      .toEqual(["belt_straight_1x1", "belt_straight_1x1"]);
    expect(Object.values(placed.entities).map(entity => entity.position))
      .toEqual([{ x: 12, y: 12 }, { x: 116, y: 12 }]);
    await editor.internalHistory.flush();
    await editor.internalDocuments.flush();
    await editor.internalDocuments.settleMaintenance();
    editor.dispose();
    editor = createEditorHost(workspace);
    await editor.internalDocuments.ready();
    expect(await editor.actions.loadLatestBaseDocument("wuling_agricultural_land")).toBe(true);
    const restored = editor.document.getSnapshot();
    expect(restored.baseId).toBe(placed.baseId);
    expect(restored.entities).toEqual(placed.entities);
    expect(restored.entityOrder).toEqual(placed.entityOrder);
    expect(restored.slotLinks).toEqual([]);
  } finally {
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally { editor.dispose(); app.dispose(); }
  }
});
