import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { readSimulationSnapshot } from "@/simulation/testkit";
import { describe, expect, it, vi } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { createRegistryContract } from "@/registry";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import {
  DENSE_STANDARD_TICK_RATE_PER_SECOND,
  RECIPE_PHASE_DURATION_SECONDS,
} from "@/simulation/contracts";

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   createWorldDocumentFromBlueprint,
// } from "./blueprint-test-helpers";
import { createEntity, createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import {
  describeSimulationEngineMatrix,
  SIMULATION_ENGINE_MATRIX,
} from "./simulation-engine-matrix";

const DENSE_TIMELINE_ORIGIN_STANDARD_TICK = 1;
const DENSE_TIMELINE_STEP_STANDARD_TICKS =
  DENSE_STANDARD_TICK_RATE_PER_SECOND * RECIPE_PHASE_DURATION_SECONDS;
const DENSE_FIRST_TRANSFER_STANDARD_TICK = DENSE_TIMELINE_ORIGIN_STANDARD_TICK;
const DENSE_SECOND_TRANSFER_STANDARD_TICK =
  DENSE_FIRST_TRANSFER_STANDARD_TICK + DENSE_TIMELINE_STEP_STANDARD_TICKS;
const DENSE_EMPTY_TRANSFER_STANDARD_TICK =
  DENSE_SECOND_TRANSFER_STANDARD_TICK + DENSE_TIMELINE_STEP_STANDARD_TICKS;
const DENSE_SECOND_TRANSFER_TIMELINE_TICK =
  (DENSE_SECOND_TRANSFER_STANDARD_TICK - DENSE_TIMELINE_ORIGIN_STANDARD_TICK)
  / DENSE_TIMELINE_STEP_STANDARD_TICKS;
const DENSE_EMPTY_TRANSFER_TIMELINE_TICK =
  (DENSE_EMPTY_TRANSFER_STANDARD_TICK - DENSE_TIMELINE_ORIGIN_STANDARD_TICK)
  / DENSE_TIMELINE_STEP_STANDARD_TICKS;

describe("ST2-RQ-023 dense host regressions", () => {
  it.each([
    { requestedEngineKind: undefined, expectedEngineKind: "legacy" },
    ...SIMULATION_ENGINE_MATRIX.map((engineKind) => ({
      requestedEngineKind: engineKind,
      expectedEngineKind: engineKind,
    })),
  ])(
    "reports $expectedEngineKind as the current engine for $requestedEngineKind selection",
    ({ requestedEngineKind, expectedEngineKind }) => {
      const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
      const workspace = createDenseTestWorkspace({
        currentDocument,
        readLatestBaseDocuments: async (baseIds) =>
          baseIds.map((baseId) => createWorldDocument({ baseId })),
      });
      const host = createSimulationHost(
        workspace,
        requestedEngineKind === undefined
          ? { workerMode: "runtime" }
          : { engineKind: requestedEngineKind, workerMode: "runtime" },
      );

      try {
        expect(host.engineKind).toBe(expectedEngineKind);
        expect(workspace.simulation?.engineKind).toBe(expectedEngineKind);
      } finally {
        host.dispose();
      }
    },
  );

  describeSimulationEngineMatrix("topology refresh contract", (engineKind) => {
    it("preserves existing inventory and recipe progress when adding an unrelated building", async () => {
      // AI-REMOVED 2026-09-14:
      // Reason: 场景构造已批量固化为带版本的蓝图文件。
      // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
      // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
      // Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
      // Risk: Low；断言与被测动作不变。
      // Human Review: Required
      // Original code:
      // createBlueprint(
      //         `topology-add-${engineKind}`,
      //         [
      //           createEntity("pump", "water_pump_1", 0, 0, 0, {
      //             channelRecipes: { default: "r_pump_water_basic" },
      //           }),
      //           createEntity("power", "power_diffuser_1", 4, 0),
      //           createEntity("stable-storage", "storager_1", 10, 0),
      //         ],
      //       )
      const document = createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json", "scene-01", { engineKind }));
      const documentStore = createSnapshotStore(document);
      const workspace = createDenseTestWorkspace({
        currentDocument: document,
        documentStore,
        readLatestBaseDocuments: async (baseIds) =>
          baseIds.map((baseId) => createWorldDocument({ baseId })),
      });
      const host = createSimulationHost(workspace, {
        engineKind,
        workerMode: "runtime",
      });

      try {
        await host.actions.start();
        await host.actions.advancePlaybackByDeltaMs(500);
        await host.actions.patchRuntimeSlot({
          entityId: "stable-storage",
          storageGroupId: "storage_slot_1",
          slotId: "slot_1",
          itemType: "item_copper_ore",
          count: 11,
          ignoreStock: false,
        });
        const beforePump = host.queries.getDeviceRuntimeStatus("pump");
        const beforeStorage = host.queries.getDeviceRuntimeStatus("stable-storage");
        const beforeTickNumber = readSimulationSnapshot(host)?.tickNumber ?? 0;
        expect(beforePump?.channelRecipes.default).toMatchObject({
          recipeId: "r_pump_water_basic",
          state: "running",
        });
        expect(beforeStorage?.slotItems).toContainEqual(expect.objectContaining({
          storageGroupId: "storage_slot_1",
          slotId: "slot_1",
          itemType: "item_copper_ore",
          count: 11,
        }));

        const addedStorage = createEntity("added-storage", "storager_1", 14, 0, 180, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 3,
        });
        // AI-REMOVED 2026-09-14:
        // Reason: 场景构造已批量固化为带版本的蓝图文件。
        // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
        // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
        // Replacement: src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json
        // Risk: Low；断言与被测动作不变。
        // Human Review: Required
        // Original code:
        // {
        //             ...document.entities,
        //             [addedStorage.id]: addedStorage,
        //           }
        documentStore.setSnapshot({
          ...document,
          entities: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json", "scene-01", { engineKind }).entities,
          entityOrder: [...document.entityOrder, addedStorage.id],
        });
        const refreshPromise = host.internalActions.refreshFromCurrentDocument();
        await host.actions.advancePlaybackByDeltaMs(50);
        const refresh = await refreshPromise;

        expect(refresh.status).toBe("started");
        expect(readSimulationSnapshot(host)?.tickNumber).toBeGreaterThanOrEqual(
          beforeTickNumber,
        );
        expect(host.queries.getDeviceRuntimeStatus("pump")?.channelRecipes.default)
          .toMatchObject({
            recipeId: "r_pump_water_basic",
            state: "running",
            progressSeconds: expect.any(Number),
          });
        expect(
          host.queries.getDeviceRuntimeStatus("pump")?.channelRecipes.default
            ?.progressSeconds,
        ).toBeGreaterThanOrEqual(beforePump?.channelRecipes.default?.progressSeconds ?? 0);
        expect(host.queries.getDeviceRuntimeStatus("stable-storage")?.slotItems)
          .toEqual(beforeStorage?.slotItems);
        expect(host.queries.getDeviceRuntimeStatus("added-storage")?.slotItems)
          .toContainEqual(expect.objectContaining({
            storageGroupId: "storage_slot_1",
            slotId: "slot_1",
            itemType: "item_iron_ore",
            count: 3,
          }));
      } finally {
        host.dispose();
      }
    });

    it("resets only the device whose runtime shape became incompatible", async () => {
      // AI-REMOVED 2026-09-14:
      // Reason: 场景构造已批量固化为带版本的蓝图文件。
      // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
      // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
      // Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
      // Risk: Low；断言与被测动作不变。
      // Human Review: Required
      // Original code:
      // createBlueprint(
      //         `topology-local-reset-${engineKind}`,
      //         [
      //           createEntity("stable-storage", "storager_1", 0, 0),
      //           createEntity("changed-storage", "storager_1", 5, 0, 0, {
      //             "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      //             "storageSlotGroups[0].slots[0].initialCount": 4,
      //           }),
      //         ],
      //       )
      const document = createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json", "scene-02", { engineKind }));
      const documentStore = createSnapshotStore(document);
      const workspace = createDenseTestWorkspace({
        currentDocument: document,
        documentStore,
        readLatestBaseDocuments: async (baseIds) =>
          baseIds.map((baseId) => createWorldDocument({ baseId })),
      });
      const host = createSimulationHost(workspace, {
        engineKind,
        workerMode: "runtime",
      });

      try {
        await host.actions.start();
        await host.actions.advancePlaybackByDeltaMs(500);
        await host.actions.patchRuntimeSlot({
          entityId: "stable-storage",
          storageGroupId: "storage_slot_1",
          slotId: "slot_1",
          itemType: "item_copper_ore",
          count: 11,
          ignoreStock: false,
        });
        await host.actions.patchRuntimeSlot({
          entityId: "changed-storage",
          storageGroupId: "storage_slot_1",
          slotId: "slot_1",
          itemType: "item_copper_ore",
          count: 9,
          ignoreStock: false,
        });
        host.actions.pause();
        const beforeTickNumber = readSimulationSnapshot(host)?.tickNumber ?? 0;

        // AI-REMOVED 2026-09-14:
        // Reason: 场景构造已批量固化为带版本的蓝图文件。
        // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
        // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
        // Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
        // Risk: Low；断言与被测动作不变。
        // Human Review: Required
        // Original code:
        // const changedEntity = document.entities["changed-storage"]!;
        // AI-REMOVED 2026-09-14:
        // Reason: 场景构造已批量固化为带版本的蓝图文件。
        // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
        // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
        // Replacement: src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json
        // Risk: Low；断言与被测动作不变。
        // Human Review: Required
        // Original code:
        // {
        //             ...document.entities,
        //             "changed-storage": {
        //               ...changedEntity,
        //               config: {
        //                 ...changedEntity.config,
        //                 "storageSlotGroups[0].slots[0].initialCount": 2,
        //               },
        //             },
        //           }
        documentStore.setSnapshot({
          ...document,
          entities: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json", "scene-02", { engineKind }).entities,
        });
        const refresh = await host.internalActions.refreshFromCurrentDocument();

        expect(refresh.status).toBe("started");
        expect(readSimulationSnapshot(host)?.tickNumber).toBe(beforeTickNumber);
        expect(host.queries.getDeviceRuntimeStatus("stable-storage")?.slotItems)
          .toContainEqual(expect.objectContaining({
            itemType: "item_copper_ore",
            count: 11,
          }));
        expect(host.queries.getDeviceRuntimeStatus("changed-storage")?.slotItems)
          .toContainEqual(expect.objectContaining({
            itemType: "item_iron_ore",
            count: 2,
          }));
      } finally {
        host.dispose();
      }
    });

    it.runIf(engineKind === "dense-v2")(
      "preserves reserved transport recipes when an unrelated building is added",
      async () => {
      // AI-REMOVED 2026-09-14:
      // Reason: 场景构造已批量固化为带版本的蓝图文件。
      // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
      // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
      // Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
      // Risk: Low；断言与被测动作不变。
      // Human Review: Required
      // Original code:
      // createBlueprint(
      //         `topology-reservation-${engineKind}`,
      //         [
      //           createEntity("source-storage", "storager_1", 0, 0, 0, {
      //             "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      //             "storageSlotGroups[0].slots[0].initialCount": 20,
      //           }),
      //           createEntity("belt", "belt_straight_1x1", 0, -1, 270),
      //           createEntity("sink-storage", "storager_1", 0, -4),
      //         ],
      //       )
      const document = createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json", "scene-03", { engineKind }));
      const documentStore = createSnapshotStore(document);
      const workspace = createDenseTestWorkspace({
        currentDocument: document,
        documentStore,
        readLatestBaseDocuments: async (baseIds) =>
          baseIds.map((baseId) => createWorldDocument({ baseId })),
      });
      const host = createSimulationHost(workspace, {
        engineKind,
        workerMode: "runtime",
      });

      try {
        await host.actions.start();
        await host.actions.advancePlaybackByDeltaMs(500);
        host.actions.pause();
        const beforeTickNumber = readSimulationSnapshot(host)?.tickNumber ?? 0;
        const beforeBelt = host.queries.getDeviceRuntimeStatus("belt");
        expect(beforeBelt?.channelRecipes.default).toMatchObject({
          recipeId: "belt_straight_1x1:dynamic-belt-transfer",
          state: "running",
        });
        expect(beforeBelt?.slotItems.some((slot) => slot.reserved > 0)).toBe(true);

        const addedStorage = createEntity("added-storage", "storager_1", 10, 0, 180);
        // AI-REMOVED 2026-09-14:
        // Reason: 场景构造已批量固化为带版本的蓝图文件。
        // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
        // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
        // Replacement: src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json
        // Risk: Low；断言与被测动作不变。
        // Human Review: Required
        // Original code:
        // {
        //             ...document.entities,
        //             [addedStorage.id]: addedStorage,
        //           }
        documentStore.setSnapshot({
          ...document,
          entities: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/collections/simulation/dense-host-regressions/index.json", "scene-03", { engineKind }).entities,
          entityOrder: [...document.entityOrder, addedStorage.id],
        });
        const refresh = await host.internalActions.refreshFromCurrentDocument();

        expect(refresh.status).toBe("started");
        expect(readSimulationSnapshot(host)?.tickNumber).toBe(beforeTickNumber);
        expect(host.queries.getDeviceRuntimeStatus("belt")?.channelRecipes.default)
          .toEqual(beforeBelt?.channelRecipes.default);
        expect(host.queries.getDeviceRuntimeStatus("belt")?.slotItems)
          .toEqual(beforeBelt?.slotItems);
      } finally {
        host.dispose();
      }
      },
    );
  });

  describe("dense-v2 展示检查点传输记录", () => {
    it("同 tick 重读和时间轴定位保留该帧的实际传输", async () => {
      const host = createDenseTransferCheckpointHost("checkpoint-current-tick");

      try {
        await host.actions.start();
        host.actions.pause();
        expect((await host.internalActions.syncToTick(1)).status).toBe("ready");
        const expectedSnapshot = readSimulationSnapshot(host);
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);

        expect((await host.internalActions.syncToTick(1)).status).toBe("ready");
        expect(readSimulationSnapshot(host)).toEqual(expectedSnapshot);

        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(0)).toBe(true);
        expect(readSimulationSnapshot(host)).toEqual(expectedSnapshot);
      } finally {
        host.dispose();
      }
    });

    it("未来时间轴检查点与逐 tick 正常推进的目标帧一致", async () => {
      const baselineHost = createDenseTransferCheckpointHost("checkpoint-future-tick");
      const presentationHost = createDenseTransferCheckpointHost("checkpoint-future-tick");

      try {
        await baselineHost.actions.start();
        baselineHost.actions.pause();
        await baselineHost.internalActions.syncToTick(DENSE_FIRST_TRANSFER_STANDARD_TICK);
        const firstTransfers = readSimulationSnapshot(baselineHost)?.transfers;
        await baselineHost.internalActions.syncToTick(DENSE_SECOND_TRANSFER_STANDARD_TICK);
        const expectedSnapshot = readSimulationSnapshot(baselineHost);
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);
        expect(expectedSnapshot?.transfers).not.toEqual(firstTransfers);

        await presentationHost.actions.start();
        presentationHost.actions.pause();
        await presentationHost.internalActions.syncToTick(DENSE_FIRST_TRANSFER_STANDARD_TICK);
        await presentationHost.actions.enableTimeline();
        expect(await presentationHost.actions.seekTimelineToTick(
          DENSE_SECOND_TRANSFER_TIMELINE_TICK,
        )).toBe(true);
        expect(readSimulationSnapshot(presentationHost)).toEqual(expectedSnapshot);
      } finally {
        baselineHost.dispose();
        presentationHost.dispose();
      }
    });

    it("精确命中已保存的历史检查点时恢复当时的传输", async () => {
      const host = createDenseTransferCheckpointHost("checkpoint-retained-tick");

      try {
        await host.actions.start();
        host.actions.pause();
        await host.internalActions.syncToTick(DENSE_SECOND_TRANSFER_STANDARD_TICK);
        const expectedSnapshot = readSimulationSnapshot(host);
        expect(expectedSnapshot?.standardTickRate).toBe(
          DENSE_STANDARD_TICK_RATE_PER_SECOND,
        );
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);

        await host.internalActions.syncToTick(DENSE_EMPTY_TRANSFER_STANDARD_TICK);
        expect(readSimulationSnapshot(host)?.transfers).toEqual([]);
        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(
          DENSE_SECOND_TRANSFER_TIMELINE_TICK,
        )).toBe(true);
        expect(readSimulationSnapshot(host)).toEqual(expectedSnapshot);
      } finally {
        host.dispose();
      }
    });

    it("后续无传输的检查点不沿用上一帧记录", async () => {
      const host = createDenseTransferCheckpointHost("checkpoint-empty-tick");

      try {
        await host.actions.start();
        host.actions.pause();
        await host.internalActions.syncToTick(DENSE_SECOND_TRANSFER_STANDARD_TICK);
        const transferSnapshot = readSimulationSnapshot(host);
        expect(transferSnapshot?.transfers.length).toBeGreaterThan(0);

        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(
          DENSE_EMPTY_TRANSFER_TIMELINE_TICK,
        )).toBe(true);
        expect(readSimulationSnapshot(host)?.tickNumber).toBe(DENSE_EMPTY_TRANSFER_STANDARD_TICK);
        expect(readSimulationSnapshot(host)?.transfers).toEqual([]);

        expect((await host.internalActions.syncToTick(DENSE_EMPTY_TRANSFER_STANDARD_TICK)).status)
          .toBe("ready");
        expect(readSimulationSnapshot(host)?.transfers).toEqual([]);
        expect((await host.internalActions.syncToTick(DENSE_EMPTY_TRANSFER_STANDARD_TICK)).status)
          .toBe("ready");
        expect(readSimulationSnapshot(host)?.transfers).toEqual([]);

        expect(await host.actions.seekTimelineToTick(
          DENSE_SECOND_TRANSFER_TIMELINE_TICK,
        )).toBe(true);
        expect(readSimulationSnapshot(host)).toEqual(transferSnapshot);
        expect(await host.actions.seekTimelineToTick(
          DENSE_EMPTY_TRANSFER_TIMELINE_TICK,
        )).toBe(true);
        expect(readSimulationSnapshot(host)?.tickNumber).toBe(DENSE_EMPTY_TRANSFER_STANDARD_TICK);
        expect(readSimulationSnapshot(host)?.transfers).toEqual([]);
      } finally {
        host.dispose();
      }
    });
  });

  it("publishes the Dense 4 TPS timing contract", async () => {
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const workspace = createDenseTestWorkspace({
      currentDocument,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      await host.actions.start();
      expect(host.queries.getDocumentRuntimeStatus()).toMatchObject({
        standardTickRate: 4,
        tickRate: 4,
      });
      await host.actions.advancePlaybackByDeltaMs(1_000);
      expect(host.queries.getPerformanceDiagnostics()).toMatchObject({
        tickPerSecond: 4,
        targetTickPerSecond: 4,
        playbackBufferedFrameCount: 1,
        runtimeRetainedStateCount: expect.any(Number),
        timelineRetainedFrameCount: 0,
        timelineGeneratedFramePerSecond: 0,
      });
      expect(readSimulationSnapshot(host)).toMatchObject({
        standardTickRate: 4,
        tickRate: 4,
      });
    } finally {
      host.dispose();
    }
  });

  it("starts regional multi-base mode through the dense SimulationHost", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      expect(host.state.runningState).toBe("start");
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      expect(host.internalState.runtimeStatus).toMatchObject({
        mode: "running",
        error: null,
      });
      await host.actions.advancePlaybackByDeltaMs(500);
      expect(readSimulationSnapshot(host)?.tickNumber).toBeGreaterThanOrEqual(1);
    } finally {
      host.dispose();
    }
  });

  it("uses one regional Dense graph with a shared warehouse and base-namespaced devices", async () => {
    const registry = createRegistryContract();
    const currentBaseId = "wuling_protocol_core";
    const backgroundBaseId = registry.baseDefinitions.find(
      (definition) => definition.tag === "武陵" && definition.id !== currentBaseId,
    )!.id;
    const blueprint = loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/simulation/regional-long-run/scene-01-region-long-consumer-2d13761d.schema6.json",
    );
    const documentsByBaseId = Object.fromEntries(
      registry.baseDefinitions
        .filter((definition) => definition.tag === "武陵")
        .map((definition) => {
          const document = definition.id === currentBaseId || definition.id === backgroundBaseId
            ? createWorldDocumentFromBlueprint(blueprint)
            : createWorldDocument({ baseId: definition.id });
          document.baseId = definition.id;
          document.documentKey = `dense-regional-shared-${definition.id}`;
          return [definition.id, document];
        }),
    );
    const currentDocument = documentsByBaseId[currentBaseId]!;
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) => baseIds.map(
        (baseId) => documentsByBaseId[baseId]!,
      ),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();
      const snapshot = readSimulationSnapshot(host)!;
      expect(Object.keys(snapshot.devices).filter((deviceId) =>
        deviceId.startsWith("device:warehouse:")
      )).toEqual([`device:warehouse:${currentBaseId}`]);
      expect(Object.keys(snapshot.devices)).not.toContain(
        `device:dense-base:${encodeURIComponent(backgroundBaseId)}:unloader`,
      );
      expect(host.topology.getSnapshot()?.ordering.deviceOrder.some((deviceId) =>
        deviceId.includes("dense-base:")
      )).toBe(false);

      await host.actions.patchRuntimeSlot({
        entityId: `dense-base:${encodeURIComponent(backgroundBaseId)}:unloader`,
        storageGroupId: "unloader_buffer",
        slotId: "slot_1",
        itemType: "item_copper_ore",
        count: 7,
        ignoreStock: false,
      });
      expect(host.queries.getDeviceRuntimeStatus("unloader")?.slotItems).toContainEqual(
        expect.objectContaining({
          storageGroupId: "unloader_buffer",
          slotId: "slot_1",
          itemType: "item_copper_ore",
          count: 1,
        }),
      );
      const backgroundSlot = Object.entries(readSimulationSnapshot(host)!.slots).find(
        ([slotId]) => slotId.includes(
          `dense-base:${encodeURIComponent(backgroundBaseId)}:unloader`,
        ),
      )?.[1];
      expect(backgroundSlot).toBeUndefined();
    } finally {
      host.dispose();
    }
  });

  it("aggregates regional power in the single Dense kernel while projecting only the current base", async () => {
    const registry = createRegistryContract();
    const currentBaseId = "wuling_protocol_core";
    const backgroundBaseId = registry.baseDefinitions.find(
      (definition) => definition.tag === "武陵" && definition.id !== currentBaseId,
    )!.id;
    const documentsByBaseId = Object.fromEntries(
      registry.baseDefinitions
        .filter((definition) => definition.tag === "武陵")
        .map((definition) => {
          const document = definition.id === currentBaseId || definition.id === backgroundBaseId
            ? createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile(
                "src/tests/fixtures/blueprints/simulation/power-system/index.json",
                "scene-01",
                {
                  initialInputCount: 1,
                  name: "powered-grinder",
                  powerX: 4,
                },
              ))
            : createWorldDocument({ baseId: definition.id });
          document.baseId = definition.id;
          document.documentKey = `dense-regional-power-${definition.id}`;
          return [definition.id, document];
        }),
    );
    const workspace = createDenseTestWorkspace({
      currentDocument: documentsByBaseId[currentBaseId]!,
      registry,
      readLatestBaseDocuments: async (baseIds) => baseIds.map(
        (baseId) => documentsByBaseId[baseId]!,
      ),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      const currentBaseDemand = host.topology.getSnapshot()?.totalPowerDemand ?? 0;
      expect(currentBaseDemand).toBeGreaterThan(0);
      expect(readSimulationSnapshot(host)?.totalPowerDemand).toBeGreaterThan(
        currentBaseDemand,
      );
      expect(host.queries.getDeviceRuntimeStatus(
        `dense-base:${encodeURIComponent(backgroundBaseId)}:grinder`,
      )).toBeNull();
    } finally {
      host.dispose();
    }
  });

  it("fills and seeks the regional timeline from the same Dense checkpoint buffer", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();
      await host.actions.enableTimeline();

      expect(host.state.timeline.readiness).toBe("ready");
      expect(host.queries.getPerformanceDiagnostics().timelineRetainedFrameCount)
        .toBeGreaterThan(1);
      expect(await host.actions.seekTimelineToTick(600)).toBe(true);
      expect(readSimulationSnapshot(host)?.tickNumber).toBe(
        DENSE_TIMELINE_ORIGIN_STANDARD_TICK
          + 600 * DENSE_TIMELINE_STEP_STANDARD_TICKS,
      );
    } finally {
      host.dispose();
    }
  });

  it("starts dense regional simulation after excluding unknown entities from a background base", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_tianwangping_aid" });
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/document-scenes/simulation/dense-host-regressions/scene-01-variant-1.schema6.json");
    const staleEntity = blueprint.entities["transmuter_2:1"]!;
    const protocolCoreDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/document-scenes/simulation/dense-host-regressions/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // { [staleEntity.id]: staleEntity }
    protocolCoreDocument.entities = blueprint.entities;
    protocolCoreDocument.entityOrder = blueprint.entityOrder;
    // AI-REMOVED 2026-09-14:
    // Reason: 关联链接也属于完整场景，不能在加载后另行拼装。
    // Trigger: 用户要求场景整体文件化；引用相等断言要求变量引用蓝图中的同一实体。
    // Evidence: 原链接与实体引用已原样写入 scene-01 蓝图。
    // Replacement: blueprint.slotLinks。
    // Risk: Low；保留 toBe 身份断言，不改业务预期。
    // Human Review: Required
    // Original code:
    // protocolCoreDocument.slotLinks = [{
    //   id: "stale-warehouse-link",
    //   linkType: "share-all",
    //   source: {
    //     entityId: staleEntity.id,
    //     storageSlotGroupId: "output",
    //     slotId: "slot",
    //   },
    //   target: {
    //     entityId: "warehouse",
    //     storageSlotGroupId: "warehouse",
    //     slotId: "item_copper_ore",
    //   },
    // }];
    protocolCoreDocument.slotLinks = blueprint.slotLinks;
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) => baseIds.map((baseId) => {
        if (baseId === protocolCoreDocument.baseId) return protocolCoreDocument;
        if (baseId === currentDocument.baseId) return currentDocument;
        return createWorldDocument({ baseId });
      }),
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      expect(host.state.runningState).toBe("start");
      expect(host.internalState.runtimeStatus).toMatchObject({
        mode: "running",
        error: null,
      });
      expect(protocolCoreDocument.entities[staleEntity.id]).toBe(staleEntity);
      expect(protocolCoreDocument.entityOrder).toEqual([staleEntity.id]);
      expect(protocolCoreDocument.slotLinks).toHaveLength(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        "[industrial-planner:dense-simulation-runtime] Dense simulation ignored unknown document entities.",
        {
          baseId: "wuling_protocol_core",
          ignoredEntityCount: 1,
          ignoredEntities: [{
            entityId: "transmuter_2:1",
            definitionId: "transmuter_2",
            position: { x: 3, y: 4 },
            relatedSlotLinkCount: 1,
          }],
        },
      );
    } finally {
      host.dispose();
      consoleWarn.mockRestore();
    }
  });

  it("starts dense single-base simulation with an unknown entity admission warning", async () => {
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/document-scenes/simulation/dense-host-regressions/scene-02-variant-1.schema6.json");
    const staleEntity = blueprint.entities["transmuter_2:1"]!;
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/document-scenes/simulation/dense-host-regressions/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // { [staleEntity.id]: staleEntity }
    currentDocument.entities = blueprint.entities;
    currentDocument.entityOrder = blueprint.entityOrder;
    const workspace = createDenseTestWorkspace({
      currentDocument,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      await host.actions.start();

      expect(host.state.runningState).toBe("start");
      expect(host.topology.getSnapshot()?.diagnostics).toContainEqual({
        severity: "warning",
        code: "ignored-unknown-entity-definition",
        message: "Ignored unknown entity \"transmuter_2:1\" with missing definition \"transmuter_2\".",
        entityId: "transmuter_2:1",
        definitionId: "transmuter_2",
      });
      expect(host.queries.getDeviceRuntimeStatus(staleEntity.id)).toBeNull();
      expect(currentDocument.entities[staleEntity.id]).toBe(staleEntity);
    } finally {
      host.dispose();
      consoleWarn.mockRestore();
    }
  });

  it("keeps a missing dense base-builtin definition as a fatal registry error", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    registry.baseDefinitions = registry.baseDefinitions.map((definition) =>
      definition.id === currentDocument.baseId
        ? {
            ...definition,
            builtinEntities: [{
              id: "broken",
              definitionId: "missing-builtin-definition",
              position: { x: 0, y: 0 },
              rotation: 0,
            }],
          }
        : definition
    );
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      expect(host.state.runningState).toBe("stop");
      expect(host.internalState.runtimeStatus).toMatchObject({
        mode: "error",
        error: "Missing entity definition \"missing-builtin-definition\".",
      });
    } finally {
      host.dispose();
      consoleError.mockRestore();
    }
  });

  it("records a structured error when dense regional startup is rejected", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    registry.baseDefinitions = registry.baseDefinitions.filter((definition) =>
      definition.id === currentDocument.baseId
    );
    const workspace = createDenseTestWorkspace({
      currentDocument,
      registry,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      expect(host.state.runningState).toBe("stop");
      expect(host.internalState.runtimeStatus).toMatchObject({
        mode: "error",
        error: "区域 武陵 至少需要两个基地才能启动多基地仿真。",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[industrial-planner:dense-simulation-runtime] Dense regional simulation start rejected.",
        {
          code: "insufficient-regional-bases",
          currentBaseId: "wuling_protocol_core",
          regionBaseCount: 1,
          regionTag: "武陵",
          error: "区域 武陵 至少需要两个基地才能启动多基地仿真。",
        },
      );
    } finally {
      host.dispose();
      consoleError.mockRestore();
    }
  });

  it("does not rebuild a running dense session for viewport-only document changes", async () => {
    const document = createWorldDocument({ baseId: "wuling_protocol_core" });
    const documentStore = createSnapshotStore(document);
    const workspace = createDenseTestWorkspace({
      currentDocument: document,
      documentStore,
      readLatestBaseDocuments: async (baseIds) =>
        baseIds.map((baseId) => createWorldDocument({ baseId })),
    });
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });

    try {
      await host.actions.start();
      await host.internalActions.syncToTick(5);
      const topologyId = host.internalState.runtimeStatus.topologyId;

      documentStore.setSnapshot({
        ...document,
        documentSettings: {
          ...document.documentSettings,
          viewport: {
            ...document.documentSettings.viewport,
            center: { x: 12, y: -8 },
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(readSimulationSnapshot(host)?.tickNumber).toBe(5);
      expect(host.internalState.runtimeStatus.topologyId).toBe(topologyId);
      expect(host.internalState.runtimeStatus.error).toBeNull();
    } finally {
      host.dispose();
    }
  });
});

function createDenseTransferCheckpointHost(name: string): ReturnType<typeof createSimulationHost> {
  // 两端普通设备不会直接建立运输边；复用 pipe-transport 的真实管道布局。
  // Dense 的 0.5 秒管道周期对应 1 tick：tick 1 入管，tick 2 出管，tick 3 为空。
  // AI-CORRECTION 2026-09-11: 上述 2 TPS 时序已失效；当前 4 TPS 下半秒周期为 2 tick，传输检查点由文件顶部时间常量推导。
  // AI-REMOVED 2026-09-14:
  // Reason: 场景构造已批量固化为带版本的蓝图文件。
  // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
  // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
  // Replacement: src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json
  // Risk: Low；断言与被测动作不变。
  // Human Review: Required
  // Original code:
  // createBlueprint(name, [
  //     createEntity("source-storage", "liquid_storager_1", 0, 0, 180, {
  //       "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
  //       "storageSlotGroups[0].slots[0].initialCount": 1,
  //     }),
  //     createEntity("pipe", "pipe_straight_1x1", 3, 1),
  //     createEntity("sink-storage", "liquid_storager_1", 4, 0, 180),
  //   ])
  const document = createWorldDocumentFromBlueprint(loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/simulation/dense-host-regressions/index.json", "scene-04", { name }));
  const workspace = createDenseTestWorkspace({
    currentDocument: document,
    readLatestBaseDocuments: async (baseIds) =>
      baseIds.map((baseId) => createWorldDocument({ baseId })),
  });
  return createSimulationHost(workspace, {
    engineKind: "dense-v2",
    workerMode: "runtime",
  });
}

function createDenseTestWorkspace(options: {
  readonly currentDocument: ReturnType<typeof createWorldDocument>;
  readonly documentStore?: SnapshotStoreReadWrite<ReturnType<typeof createWorldDocument>>;
  readonly registry?: ReturnType<typeof createRegistryContract>;
  readonly readLatestBaseDocuments: (
    baseIds: readonly string[],
  ) => Promise<readonly ReturnType<typeof createWorldDocument>[]>;
}): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: options.registry ?? createRegistryContract(),
    app: null,
    editor: {
      document: options.documentStore ?? createSnapshotStore(options.currentDocument),
      state: {} as never,
      queries: {
        readLatestBaseDocuments: options.readLatestBaseDocuments,
      } as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
    blueprintPlanner: null,
  };
}
