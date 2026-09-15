import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { resolvePowerInteractionVisualState } from "@/renderer/power-interaction-visual-state";
import {
  areGridRectsIntersecting,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);

describe("resolvePowerInteractionVisualState", () => {
  it("shows every range without power-specific highlights when the setting is enabled", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("power", "power_diffuser_1", 0, 0),
    //       createPreviewEntity("storage-preview", "storager_1", 3, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-01-variant-1.schema6.json"));

    const state = resolveState({
      alwaysShowPowerRange: true,
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["storage-preview"],
    });

    expect(state.visiblePowerRangeEntityIds).toBeNull();
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every power pole covering a protocol storage footprint during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("power-a", "power_diffuser_1", 0, 0),
    //       createEntity("power-b", "power_diffuser_1", 8, 0),
    //       createPreviewEntity("storage-preview", "storager_1", 5, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-02-variant-1.schema6.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: activeTool === "move" ? ["storage"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-a", "power-b"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["power-a", "power-b"]));
  });

  it("does not activate the interaction during a batch move", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("power", "power_diffuser_1", 0, 0),
    //       createPreviewEntity("storage-preview", "storager_1", 3, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-03-variant-1.schema6.json"));

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["storage-preview"],
      ghostEntityIds: ["storage"],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set());
    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every consuming device in a preview power pole range during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createPreviewEntity("power-preview", "power_diffuser_1", 0, 0),
    //       createEntity("protocol-storage", "storager_1", 4, 0),
    //       createEntity("outside-storage", "storager_1", 20, 0),
    //       createEntity("zero-demand", "power_diffuser_1", 4, 3),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/scene-04-variant-1.schema6.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["power-preview"],
      ghostEntityIds: activeTool === "move" ? ["power-original"] : [],
    });

    expect(state.visiblePowerRangeEntityIds).toEqual(new Set(["power-preview"]));
    expect(state.highlightedEntityIds).toEqual(new Set(["protocol-storage"]));
  });
});

function resolveState(options: {
  alwaysShowPowerRange?: boolean;
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  return resolvePowerInteractionVisualState({
    alwaysShowPowerRange: options.alwaysShowPowerRange ?? false,
    activeTool: options.activeTool,
    moveKind: options.moveKind,
    entities: options.entities,
    previewEntityIds: options.previewEntityIds,
    ghostEntityIds: options.ghostEntityIds ?? [],
    entityDefinitionMap,
    listPowerRangeProvidersCoveringGridRect: (gridRect) =>
      listPowerRangeProvidersCoveringGridRect(options.entities, gridRect),
  });
}

function listPowerRangeProvidersCoveringGridRect(
  entities: readonly WorldEntity[],
  gridRect: GridRect,
): readonly WorldEntity[] {
  return entities.filter((entity) => {
    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return false;
    }

    const powerRangeGridRect = resolvePowerRangeGridRect({ entity, definition });
    return powerRangeGridRect !== null
      && areGridRectsIntersecting(powerRangeGridRect, gridRect);
  });
}

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/power-interaction-visual-state/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json。
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// function createEntity(
//   id: string,
//   definitionId: string,
//   x: number,
//   y: number,
// ): WorldEntity {
//   return {
//     id,
//     definitionId,
//     position: { x, y },
//     rotation: 0,
//     config: {},
//     tags: [],
//   };
// }

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/power-interaction-visual-state/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/renderer/power-interaction-visual-state/index.json。
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// function createPreviewEntity(
//   id: string,
//   definitionId: string,
//   x: number,
//   y: number,
// ): WorldEntity & { readonly originalEntityId: string } {
//   return {
//     ...createEntity(id, definitionId, x, y),
//     originalEntityId: id,
//   };
// }
