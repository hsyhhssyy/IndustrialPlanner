import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";

function createEntity(options: {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  rotation: WorldEntity["rotation"];
}): WorldEntity {
  return {
    id: options.id,
    definitionId: options.definitionId,
    position: { x: options.x, y: options.y },
    rotation: options.rotation,
    config: {},
    tags: [],
  };
}

function createDefinition(
  id: string,
  footprint: EntityDefinition["footprint"],
): EntityDefinition {
  return {
    id,
    footprint,
  } as EntityDefinition;
}

describe("resolveEntityGridGeometry", () => {
  it("uses rotated device footprints instead of anchor-point spans", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/shared/geometry/entity-grid-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity({
    //         id: "first",
    //         definitionId: "wide",
    //         x: 2,
    //         y: 3,
    //         rotation: 0,
    //       }),
    //       createEntity({
    //         id: "second",
    //         definitionId: "tall-after-rotation",
    //         x: 7,
    //         y: 6,
    //         rotation: 90,
    //       }),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/shared/geometry/entity-grid-geometry/scene-01-variant-1.schema6.json"));
    const entityDefinitionMap = new Map<string, EntityDefinition>([
      ["wide", createDefinition("wide", { width: 3, height: 2 })],
      ["tall-after-rotation", createDefinition("tall-after-rotation", { width: 4, height: 2 })],
    ]);

    expect(resolveEntityGridGeometry({ entities, entityDefinitionMap })?.boundingBox).toEqual({
      left: 2,
      top: 3,
      width: 7,
      height: 7,
    });
  });

  it("ignores entities whose definitions are unavailable", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/entity-grid-geometry/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/shared/geometry/entity-grid-geometry/index.json、src/tests/fixtures/blueprints/collections-extra/shared/geometry/entity-grid-geometry/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const knownEntity = createEntity({
    //       id: "known",
    //       definitionId: "known-definition",
    //       x: 4,
    //       y: 5,
    //       rotation: 0,
    //     });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/entity-grid-geometry/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/shared/geometry/entity-grid-geometry/index.json、src/tests/fixtures/blueprints/collections-extra/shared/geometry/entity-grid-geometry/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const unknownEntity = createEntity({
    //       id: "unknown",
    //       definitionId: "missing-definition",
    //       x: 100,
    //       y: 100,
    //       rotation: 0,
    //     });
    const entityDefinitionMap = new Map<string, EntityDefinition>([
      ["known-definition", createDefinition("known-definition", { width: 2, height: 3 })],
    ]);

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/shared/geometry/entity-grid-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [knownEntity, unknownEntity]
    const geometry = resolveEntityGridGeometry({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/shared/geometry/entity-grid-geometry/scene-01-variant-1.schema6.json")),
      entityDefinitionMap,
    });

    expect(geometry?.entries.map(({ entity }) => entity.id)).toEqual(["known"]);
    expect(geometry?.boundingBox).toEqual({
      left: 4,
      top: 5,
      width: 2,
      height: 3,
    });
  });

  it("returns null when no entity has a registered definition", () => {
    const entity = createEntity({
      id: "unknown",
      definitionId: "missing-definition",
      x: 1,
      y: 2,
      rotation: 0,
    });

    expect(resolveEntityGridGeometry({
      entities: [entity],
      entityDefinitionMap: new Map(),
    })).toBeNull();
  });
});
