import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import {
  createConfiguredItemIconEntityCache,
} from "@/renderer/scene/decorations/ConfiguredItemIconEntityCache";

const CONFIGURED_ITEM_ICON_DEFINITION_IDS = new Set([
  "log_admission",
  "pipe_admission",
  "unloader_1",
]);

describe("ConfiguredItemIconEntityCache", () => {
  it("在同一 document 内随移动草稿出现、移动和取消而失效", () => {
    const cache = createConfiguredItemIconEntityCache();
    const documentSnapshot = {};
    const original = entity("admission", "log_admission", 0);
    const initial = cache.resolve({
      documentSnapshot,
      entities: [original],
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const draftAtFirstPosition = entity("move-draft:admission", "log_admission", 4);
    const whileMoving = cache.resolve({
      documentSnapshot,
      entities: [original, draftAtFirstPosition],
      previewEntities: [draftAtFirstPosition],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const draftAtSecondPosition = entity("move-draft:admission", "log_admission", 8);
    const afterMoving = cache.resolve({
      documentSnapshot,
      entities: [original, draftAtSecondPosition],
      previewEntities: [draftAtSecondPosition],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const afterCancel = cache.resolve({
      documentSnapshot,
      entities: [original],
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });

    expect(initial).toEqual([original]);
    expect(whileMoving).toEqual([original, draftAtFirstPosition]);
    expect(afterMoving).toEqual([original, draftAtSecondPosition]);
    expect(afterCancel).toEqual([original]);
  });

  it("在 document 与 preview 都未变化时复用筛选结果", () => {
    const cache = createConfiguredItemIconEntityCache();
    const documentSnapshot = {};
    const admission = entity("admission", "log_admission", 0);
    const first = cache.resolve({
      documentSnapshot,
      entities: [admission],
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const second = cache.resolve({
      documentSnapshot,
      entities: [admission],
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });

    expect(second).toBe(first);
  });

  it("同时筛选准入口与仓库取货口，并排除无关设备", () => {
    const cache = createConfiguredItemIconEntityCache();
    const admission = entity("admission", "log_admission", 0);
    const warehousePickup = entity("pickup", "unloader_1", 4);
    const unrelated = entity("belt", "belt_straight_1x1", 8);

    const result = cache.resolve({
      documentSnapshot: {},
      entities: [admission, warehousePickup, unrelated],
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) =>
        CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });

    expect(result).toEqual([admission, warehousePickup]);
  });
});

function entity(
  id: string,
  definitionId: string,
  x: number,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}
