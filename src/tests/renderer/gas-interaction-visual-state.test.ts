import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import {
  createGasInteractionDefinitionIndex,
  resolveGasInteractionVisualState,
} from "@/renderer/gas-interaction-visual-state";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);
const definitionIndex = createGasInteractionDefinitionIndex(
  registry.recipeDefinitions,
);

describe("resolveGasInteractionVisualState", () => {
  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights only fully contained gas-dependent devices during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createPreviewEntity("vaporizer-preview", "vaporizer_1", 0, 0),
    //       createEntity("fully-contained-oven", "xiranite_oven_1", 3, 0),
    //       createEntity("fully-contained-reactor", "gas_reactor_1", 3, 3),
    //       createEntity("partially-covered-oven", "xiranite_oven_1", 4, 0),
    //       createEntity("unrelated-storage", "storager_1", 3, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-01-variant-1.schema6.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["vaporizer-preview"],
      ghostEntityIds: activeTool === "move" ? ["vaporizer-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "fully-contained-oven",
      "fully-contained-reactor",
    ]));
  });

  it.each([
    { activeTool: "single-placement" as const, moveKind: null },
    { activeTool: "move" as const, moveKind: "ordinary" as const },
  ])("highlights every gas diffuser fully covering a gas-dependent preview during $activeTool", ({
    activeTool,
    moveKind,
  }) => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("vaporizer-a", "vaporizer_1", 0, 0),
    //       createEntity("vaporizer-b", "vaporizer_1", 2, 0),
    //       createEntity("partially-covering-vaporizer", "vaporizer_1", 9, 0),
    //       createPreviewEntity("oven-preview", "xiranite_oven_1", 3, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-02-variant-1.schema6.json"));

    const state = resolveState({
      activeTool,
      moveKind,
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: activeTool === "move" ? ["oven-original"] : [],
    });

    expect(state.highlightedEntityIds).toEqual(new Set([
      "vaporizer-a",
      "vaporizer-b",
    ]));
  });

  it("does not activate the interaction during a batch move", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("vaporizer", "vaporizer_1", 0, 0),
    //       createPreviewEntity("oven-preview", "xiranite_oven_1", 3, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-03-variant-1.schema6.json"));

    const state = resolveState({
      activeTool: "move",
      moveKind: "batch",
      entities,
      previewEntityIds: ["oven-preview"],
      ghostEntityIds: ["oven-original"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });

  it("does not activate the interaction for multiple preview entities", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("vaporizer", "vaporizer_1", 0, 0),
    //       createPreviewEntity("oven-preview-a", "xiranite_oven_1", 3, 0),
    //       createPreviewEntity("oven-preview-b", "xiranite_oven_1", 3, 1),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-04-variant-1.schema6.json"));

    const state = resolveState({
      activeTool: "single-placement",
      moveKind: null,
      entities,
      previewEntityIds: ["oven-preview-a", "oven-preview-b"],
    });

    expect(state.highlightedEntityIds).toEqual(new Set());
  });
});

function resolveState(options: {
  activeTool: "single-placement" | "move";
  moveKind: "ordinary" | "batch" | null;
  entities: readonly WorldEntity[];
  previewEntityIds: readonly string[];
  ghostEntityIds?: readonly string[];
}) {
  return resolveGasInteractionVisualState({
    activeTool: options.activeTool,
    moveKind: options.moveKind,
    entities: options.entities,
    previewEntityIds: options.previewEntityIds,
    ghostEntityIds: options.ghostEntityIds ?? [],
    entityDefinitionMap,
    definitionIndex,
  });
}

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/gas-interaction-visual-state/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json。
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
// Replacement: src/tests/fixtures/blueprints/simulation/gas-interaction-visual-state/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/index.json。
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
