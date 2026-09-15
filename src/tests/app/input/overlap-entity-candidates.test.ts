import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveOverlappingEntityCandidatesAtClientPoint } from "@/app/input/gesture/actions/hypergryph/overlap-entity-candidates";

describe("overlap entity candidates logistics suppression", () => {
  it("skips a suppressed pipe admission and exposes the overlapping belt", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/overlap-entity-candidates/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/overlap-entity-candidates/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const belt = createEntity("belt", "belt_straight_1x1");
    const pipeAdmission = createEntity("pipe-admission", "pipe_admission");
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/overlap-entity-candidates/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [belt, pipeAdmission]
    const editor = {
      state: {
        suppressBelts: false,
        suppressPipes: true,
      },
      queries: {
        findGridCellForClientPixelPoint: () => ({ x: 5, y: 5 }),
        listEntities: () => getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/overlap-entity-candidates/scene-01-variant-1.schema6.json")),
      },
    };
    const appHost = {
      workspace: {
        editor,
        registry: {
          entityDefinitions: [
            createDefinition("belt_straight_1x1"),
            createDefinition("pipe_admission"),
          ],
          queries: createLogisticsQueries(),
        },
      },
    };

    expect(resolveOverlappingEntityCandidatesAtClientPoint({
      appHost: appHost as never,
      editor: editor as never,
      position: { clientX: 0, clientY: 0 } as never,
      pointerEntity: pipeAdmission,
    }).map((entity) => entity.id)).toEqual(["belt"]);
  });

  it("rejects a suppressed pointer fallback when entity listing is unavailable", () => {
    const pipeAdmission = createEntity("pipe-admission", "pipe_admission");
    const editor = {
      state: {
        suppressBelts: false,
        suppressPipes: true,
      },
      queries: {
        findGridCellForClientPixelPoint: () => ({ x: 5, y: 5 }),
      },
    };
    const appHost = {
      workspace: {
        editor,
        registry: {
          entityDefinitions: [createDefinition("pipe_admission")],
          queries: createLogisticsQueries(),
        },
      },
    };

    expect(resolveOverlappingEntityCandidatesAtClientPoint({
      appHost: appHost as never,
      editor: editor as never,
      position: { clientX: 0, clientY: 0 } as never,
      pointerEntity: pipeAdmission,
    })).toEqual([]);
  });
});

function createEntity(id: string, definitionId: string): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 5, y: 5 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function createDefinition(id: string): EntityDefinition {
  return {
    id,
    nameKey: `registry.entity.${id}.name`,
    spriteId: id,
    iconPath: `device-icons/${id}.webp`,
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: 0,
    tags: [],
    placementBehaviors: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    inspectors: [],
  };
}

function createLogisticsQueries() {
  return {
    isBeltFamily: (definitionId: string) => definitionId === "belt_straight_1x1",
    isPipeFamily: (definitionId: string) => definitionId === "pipe_admission",
    isBeltLogistics: () => false,
    isPipeLogistics: (definitionId: string) => definitionId === "pipe_admission",
  };
}
