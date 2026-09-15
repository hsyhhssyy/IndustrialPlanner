import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, expect, it, vi } from "vitest";
// AI-REMOVED 2026-09-08:
// Reason: describe 已由统一仿真引擎矩阵入口封装，保留本地导入会触发 ESLint unused-vars。
// Trigger: invalid-placement-compile 接入 describeSimulationEngineMatrix。
// Evidence: ESLint 报告 describe is defined but never used。
// Replacement: src/tests/simulation/simulation-engine-matrix.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  buildBaseBuiltinEntityId,
  type BaseBuiltinEntityDefinition,
} from "@/domain/registry/types/base-definition";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createWarehouseSlotLink } from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

const TEST_BUILTIN_BASE_ID = "test_simulation_builtin_base";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/invalid-placement-compile/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/index.json。
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

function createDocumentWithEntities(
  entities: readonly WorldEntity[],
  baseId?: string,
): WorldDocument {
  return {
    ...createWorldDocument({ baseId }),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };
}

function registerBuiltinBase(
  workspace: WorkspaceContract,
  builtinEntities: readonly BaseBuiltinEntityDefinition[],
): void {
  workspace.registry.baseDefinitions = [
    ...workspace.registry.baseDefinitions,
    {
      id: TEST_BUILTIN_BASE_ID,
      name: "测试仿真内置设备基地",
      placeableArea: { width: 40, height: 40 },
      outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
      tag: "测试",
      tags: [],
      builtinEntities,
    },
  ];
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describeSimulationEngineMatrix("invalid placement simulation compile", (engineKind) => {
  it("treats invalid placement entities as absent when compiling topology", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //       createEntity("outside-belt", "belt_straight_1x1", -1, 0),
    //       createEntity("valid-pipe", "pipe_straight_1x1", 4, 0),
    //     ]
    const document = createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-01-variant-1.schema6.json")));

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["outside-belt"]);

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();

      expect(result.status).toBe("started");
      expect(topology?.devices["device:outside-belt"]).toBeUndefined();
      expect(topology?.devices["device:valid-pipe"]).toBeDefined();
    } finally {
      simulationHost.dispose();
    }
  });

  it("compiles base builtin entities and resolves document slot links to them", async () => {
    const workspace = createWorkspace();
    const builtinEntityId = buildBaseBuiltinEntityId({
      baseId: TEST_BUILTIN_BASE_ID,
      builtinEntityId: "storage",
    });
    registerBuiltinBase(workspace, [
      {
        id: "storage",
        definitionId: "storager_1",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    const editorHost = createEditorHost(workspace);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         createEntity("document-storage", "storager_1", 10, 0),
    //       ]
    const document = {
      ...createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-02-variant-1.schema6.json")), TEST_BUILTIN_BASE_ID),
      slotLinks: [
        {
          id: "builtin-storage-link",
          linkType: "share-all",
          source: {
            entityId: builtinEntityId,
            storageSlotGroupId: "storage_slot_1",
            slotId: "slot_1",
          },
          target: {
            entityId: "document-storage",
            storageSlotGroupId: "storage_slot_1",
            slotId: "slot_1",
          },
        },
      ],
    } satisfies WorldDocument;

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.document.getSnapshot().entities[builtinEntityId]).toBeUndefined();

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();

      expect(result.status).toBe("started");
      expect(topology?.devices[`device:${builtinEntityId}`]).toBeDefined();
      expect(topology?.devices["device:document-storage"]).toBeDefined();
      expect(topology?.links["document-link:builtin-storage-link"]).toBeDefined();
    } finally {
      simulationHost.dispose();
    }
  });

  it("keeps warehouse ports connected to valley4 non-core builtin bus seeds in simulation topology", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         createEntity("unloader", "unloader_1", 2, 0),
    //       ]
    const document = {
      ...createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/invalid-placement-compile/scene-03-variant-1.schema6.json")), "valley4_infra_outpost"),
      slotLinks: [
        createWarehouseSlotLink("unloader", "item_plant_moss_3"),
      ],
    } satisfies WorldDocument;

    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.state.collections[EntityCollectionType.invalidPlacement].contains("unloader"))
      .toBe(false);

    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();
      const warehouseLink = topology?.links["document-link:warehouse-link:unloader:unloader_buffer:slot_1"];

      expect(result.status).toBe("started");
      expect(topology?.devices["device:unloader"]).toBeDefined();
      expect(warehouseLink).toBeDefined();
      expect(warehouseLink?.sourceSlotIds.length).toBeGreaterThan(0);
      expect(warehouseLink?.targetSlotIds.length).toBeGreaterThan(0);
    } finally {
      simulationHost.dispose();
    }
  });
});
