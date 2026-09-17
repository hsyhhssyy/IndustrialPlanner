import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/power-range-query/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/editor/power-range-query/index.json。
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { createWorldDocument } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";

describe("EditorQuery.listPowerRangeProvidersCoveringGridRect", () => {
  let editorHost: ReturnType<typeof createEditorHost> | null = null;

  afterEach(() => {
    editorHost?.dispose();
    editorHost = null;
    localStorage.clear();
  });

  it("returns every power pole whose range intersects the queried footprint", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/editor/power-range-query/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("power-a", "power_diffuser_1", 0, 0),
    //       createEntity("power-b", "power_diffuser_1", 8, 0),
    //       createEntity("power-outside", "power_diffuser_1", 24, 0),
    //       createEntity("storage", "storager_1", 5, 0),
    //     ]
    const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/editor/power-range-query/scene-01-variant-1.schema6.json"));
    const document = createWorldDocument();
    document.entities = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
    document.entityOrder = entities.map((entity) => entity.id);
    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.queries.listPowerRangeProvidersCoveringGridRect({
      x: 5,
      y: 0,
      width: 3,
      height: 3,
    }).map((entity) => entity.id)).toEqual(["power-a", "power-b"]);
  });
});

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    blueprintPlanner: null,
  };
}

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/power-range-query/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/editor/power-range-query/index.json。
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
