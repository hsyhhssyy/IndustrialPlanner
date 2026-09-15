import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
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
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [original]
    const initial = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-01-variant-1.schema6.json")),
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const draftAtFirstPosition = entity("move-draft:admission", "log_admission", 4);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [draftAtFirstPosition]
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [original, draftAtFirstPosition]
    const whileMoving = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-02-variant-1.schema6.json")),
      previewEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-03-variant-1.schema6.json")),
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    const draftAtSecondPosition = entity("move-draft:admission", "log_admission", 8);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [draftAtSecondPosition]
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [original, draftAtSecondPosition]
    const afterMoving = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-04-variant-1.schema6.json")),
      previewEntities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-05-variant-1.schema6.json")),
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [original]
    const afterCancel = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-06-variant-1.schema6.json")),
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
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/configured-item-icon-entity-cache/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const admission = entity("admission", "log_admission", 0);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [admission]
    const first = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-07-variant-1.schema6.json")),
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [admission]
    const second = cache.resolve({
      documentSnapshot,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-08-variant-1.schema6.json")),
      previewEntities: [],
      isConfiguredItemIconDefinition: (definitionId) => CONFIGURED_ITEM_ICON_DEFINITION_IDS.has(definitionId),
    });

    expect(second).toBe(first);
  });

  it("同时筛选准入口与仓库取货口，并排除无关设备", () => {
    const cache = createConfiguredItemIconEntityCache();
    const admission = entity("admission", "log_admission", 0);
    const warehousePickup = entity("pickup", "unloader_1", 4);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/configured-item-icon-entity-cache/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const unrelated = entity("belt", "belt_straight_1x1", 8);

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [admission, warehousePickup, unrelated]
    const result = cache.resolve({
      documentSnapshot: {},
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/configured-item-icon-entity-cache/scene-09-variant-1.schema6.json")),
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
