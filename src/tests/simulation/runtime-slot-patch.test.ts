import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { expect, it } from "vitest";
// AI-REMOVED 2026-09-08:
// Reason: describe 已由统一仿真引擎矩阵入口封装，保留本地导入会触发 ESLint unused-vars。
// Trigger: runtime-slot-patch 接入 describeSimulationEngineMatrix。
// Evidence: ESLint 报告 describe is defined but never used。
// Replacement: src/tests/simulation/simulation-engine-matrix.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// import { describe, expect, it } from "vitest";

import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import type { WorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/runtime-slot-patch/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
// } from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

describeSimulationEngineMatrix("runtime slot patch", (engineKind) => {
  it("patches current simulation slot state without persisting to initial config", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/runtime-slot-patch/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("runtime-slot-patch", [
    //         createEntity("storage", "storager_1", 20, 20, 0),
    //       ])
    const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(
      loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/runtime-slot-patch/scene-01-runtime-slot-patch-45d43076.schema6.json"),
    ));
    const workspace = createWorkspace(documentStore);
    const simulationHost = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      await simulationHost.actions.start();

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: null,
          count: 0,
          ignoreStock: false,
        });

      await simulationHost.actions.patchRuntimeSlot({
        entityId: "storage",
        storageGroupId: "storage_slot_1",
        slotId: "slot_1",
        itemType: "item_copper_ore",
        count: 11,
        ignoreStock: true,
      });

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: "item_copper_ore",
          count: 11,
          ignoreStock: true,
        });

      simulationHost.actions.stop();
      await simulationHost.actions.start();

      expect(readSlot(simulationHost, "storage", "storage_slot_1", "slot_1"))
        .toMatchObject({
          itemType: null,
          count: 0,
          ignoreStock: false,
        });
    } finally {
      simulationHost.dispose();
    }
  });
});

function createWorkspace(
  documentSnapshot: SnapshotStoreReadWrite<WorldDocument>,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document: documentSnapshot,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
    audio: null,
    blueprintPlanner: null,
  };
}

function readSlot(
  simulationHost: ReturnType<typeof createSimulationHost>,
  entityId: string,
  storageGroupId: string,
  slotId: string,
) {
  const status = simulationHost.queries.getDeviceRuntimeStatus(entityId);
  return status?.slotItems.find((slot) =>
    slot.storageGroupId === storageGroupId && slot.slotId === slotId,
  ) ?? null;
}
