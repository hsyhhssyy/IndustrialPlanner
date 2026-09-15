import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import {
  DEFAULT_WORLD_BASE_ID,
  WORLD_DOCUMENT_SCHEMA_VERSION,
  type WorldDocument,
} from "@/domain/document/world-document";

export function createDummyWorldDocument(): WorldDocument {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/common/dummy-world.schema6.json");
  return {
    schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
    documentKey: "11111111-1111-4111-8111-111111111111",
    baseId: DEFAULT_WORLD_BASE_ID,
    meta: {
      id: "dummy-world",
      name: "Dummy World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/common/dummy-world.schema6.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // entities: {
    //       "dummy-entity-1": {
    //         id: "dummy-entity-1",
    //         definitionId: "belt_straight_1x1",
    //         position: {
    //           x: 12,
    //           y: 8,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-2": {
    //         id: "dummy-entity-2",
    //         definitionId: "storager_1",
    //         position: {
    //           x: 4,
    //           y: 4,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-3": {
    //         id: "dummy-entity-3",
    //         definitionId: "grinder_1",
    //         position: {
    //           x: 10,
    //           y: 4,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-4": {
    //         id: "dummy-entity-4",
    //         definitionId: "mix_pool_1",
    //         position: {
    //           x: 16,
    //           y: 3,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-5": {
    //         id: "dummy-entity-5",
    //         definitionId: "filling_pd_mc_1_liquid",
    //         position: {
    //           x: 24,
    //           y: 4,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-6": {
    //         id: "dummy-entity-6",
    //         definitionId: "log_splitter",
    //         position: {
    //           x: 14,
    //           y: 10,
    //         },
    //         rotation: 90,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-7": {
    //         id: "dummy-entity-7",
    //         definitionId: "pipe_straight_1x1",
    //         position: {
    //           x: 20,
    //           y: 11,
    //         },
    //         rotation: 0,
    //         config: {},
    //         tags: [],
    //       },
    //       "dummy-entity-8": {
    //         id: "dummy-entity-8",
    //         definitionId: "udpipe_loader_1",
    //         position: {
    //           x: 26,
    //           y: 10,
    //         },
    //         rotation: 180,
    //         config: {},
    //         tags: [],
    //       },
    //     }
    entities: blueprint.entities,
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/common/dummy-world.schema6.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // entityOrder: [
    //       "dummy-entity-2",
    //       "dummy-entity-3",
    //       "dummy-entity-4",
    //       "dummy-entity-5",
    //       "dummy-entity-1",
    //       "dummy-entity-6",
    //       "dummy-entity-7",
    //       "dummy-entity-8",
    //     ]
    entityOrder: blueprint.entityOrder,
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/common/dummy-world.schema6.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // slotLinks: []
    slotLinks: blueprint.slotLinks,
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/common/dummy-world.schema6.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // regions: []
    regions: blueprint.regions,
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
        displayRotation: 0,
      },
      gridSize: 1,
      showDiagnostics: false,
      powerMode: "infinite",
    },
  };
}
