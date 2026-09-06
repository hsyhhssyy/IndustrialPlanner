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
import type { SimulationEngineKind } from "@/simulation/simulation-host";

import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";

const CONTRACT_ENGINE_KINDS = ["legacy", "dense-v2"] as const satisfies readonly SimulationEngineKind[];

describe("ST2-RQ-023 dense host regressions", () => {
  it.each([
    { requestedEngineKind: undefined, expectedEngineKind: "legacy" },
    { requestedEngineKind: "legacy", expectedEngineKind: "legacy" },
    { requestedEngineKind: "dense-v2", expectedEngineKind: "dense-v2" },
  ] as const)(
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

  describe.each(CONTRACT_ENGINE_KINDS)("%s topology refresh contract", (engineKind) => {
    it("preserves existing inventory and recipe progress when adding an unrelated building", async () => {
      const document = createWorldDocumentFromBlueprint(createBlueprint(
        `topology-add-${engineKind}`,
        [
          createEntity("pump", "water_pump_1", 0, 0, 0, {
            channelRecipes: { default: "r_pump_water_basic" },
          }),
          createEntity("power", "power_diffuser_1", 4, 0),
          createEntity("stable-storage", "storager_1", 10, 0),
        ],
      ));
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
        const beforeTickNumber = host.internalState.currentSnapshot?.tickNumber ?? 0;
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

        const addedStorage = createEntity("added-storage", "storager_1", 14, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 3,
        });
        documentStore.setSnapshot({
          ...document,
          entities: {
            ...document.entities,
            [addedStorage.id]: addedStorage,
          },
          entityOrder: [...document.entityOrder, addedStorage.id],
        });
        const refreshPromise = host.internalActions.refreshFromCurrentDocument();
        await host.actions.advancePlaybackByDeltaMs(50);
        const refresh = await refreshPromise;

        expect(refresh.status).toBe("started");
        expect(host.internalState.currentSnapshot?.tickNumber).toBeGreaterThanOrEqual(
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
      const document = createWorldDocumentFromBlueprint(createBlueprint(
        `topology-local-reset-${engineKind}`,
        [
          createEntity("stable-storage", "storager_1", 0, 0),
          createEntity("changed-storage", "storager_1", 5, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
            "storageSlotGroups[0].slots[0].initialCount": 4,
          }),
        ],
      ));
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
        const beforeTickNumber = host.internalState.currentSnapshot?.tickNumber ?? 0;

        const changedEntity = document.entities["changed-storage"]!;
        documentStore.setSnapshot({
          ...document,
          entities: {
            ...document.entities,
            "changed-storage": {
              ...changedEntity,
              config: {
                ...changedEntity.config,
                "storageSlotGroups[0].slots[0].initialCount": 2,
              },
            },
          },
        });
        const refresh = await host.internalActions.refreshFromCurrentDocument();

        expect(refresh.status).toBe("started");
        expect(host.internalState.currentSnapshot?.tickNumber).toBe(beforeTickNumber);
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
      const document = createWorldDocumentFromBlueprint(createBlueprint(
        `topology-reservation-${engineKind}`,
        [
          createEntity("source-storage", "storager_1", 0, 0, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
            "storageSlotGroups[0].slots[0].initialCount": 20,
          }),
          createEntity("belt", "belt_straight_1x1", 0, -1, 270),
          createEntity("sink-storage", "storager_1", 0, -4),
        ],
      ));
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
        const beforeTickNumber = host.internalState.currentSnapshot?.tickNumber ?? 0;
        const beforeBelt = host.queries.getDeviceRuntimeStatus("belt");
        expect(beforeBelt?.channelRecipes.default).toMatchObject({
          recipeId: "belt_straight_1x1:dynamic-belt-transfer",
          state: "running",
        });
        expect(beforeBelt?.slotItems.some((slot) => slot.reserved > 0)).toBe(true);

        const addedStorage = createEntity("added-storage", "storager_1", 10, 0);
        documentStore.setSnapshot({
          ...document,
          entities: {
            ...document.entities,
            [addedStorage.id]: addedStorage,
          },
          entityOrder: [...document.entityOrder, addedStorage.id],
        });
        const refresh = await host.internalActions.refreshFromCurrentDocument();

        expect(refresh.status).toBe("started");
        expect(host.internalState.currentSnapshot?.tickNumber).toBe(beforeTickNumber);
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
        const expectedSnapshot = host.internalState.currentSnapshot;
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);

        expect((await host.internalActions.syncToTick(1)).status).toBe("ready");
        expect(host.internalState.currentSnapshot).toEqual(expectedSnapshot);

        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(0)).toBe(true);
        expect(host.internalState.currentSnapshot).toEqual(expectedSnapshot);
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
        await baselineHost.internalActions.syncToTick(1);
        const firstTransfers = baselineHost.internalState.currentSnapshot?.transfers;
        await baselineHost.internalActions.syncToTick(2);
        const expectedSnapshot = baselineHost.internalState.currentSnapshot;
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);
        expect(expectedSnapshot?.transfers).not.toEqual(firstTransfers);

        await presentationHost.actions.start();
        presentationHost.actions.pause();
        await presentationHost.internalActions.syncToTick(1);
        await presentationHost.actions.enableTimeline();
        expect(await presentationHost.actions.seekTimelineToTick(1)).toBe(true);
        expect(presentationHost.internalState.currentSnapshot).toEqual(expectedSnapshot);
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
        await host.internalActions.syncToTick(2);
        const expectedSnapshot = host.internalState.currentSnapshot;
        expect(expectedSnapshot?.standardTickRate).toBe(2);
        expect(expectedSnapshot?.transfers.length).toBeGreaterThan(0);

        await host.internalActions.syncToTick(4);
        expect(host.internalState.currentSnapshot?.transfers).toEqual([]);
        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(1)).toBe(true);
        expect(host.internalState.currentSnapshot).toEqual(expectedSnapshot);
      } finally {
        host.dispose();
      }
    });

    it("后续无传输的检查点不沿用上一帧记录", async () => {
      const host = createDenseTransferCheckpointHost("checkpoint-empty-tick");

      try {
        await host.actions.start();
        host.actions.pause();
        await host.internalActions.syncToTick(2);
        const transferSnapshot = host.internalState.currentSnapshot;
        expect(transferSnapshot?.transfers.length).toBeGreaterThan(0);

        await host.actions.enableTimeline();
        expect(await host.actions.seekTimelineToTick(2)).toBe(true);
        expect(host.internalState.currentSnapshot?.tickNumber).toBe(3);
        expect(host.internalState.currentSnapshot?.transfers).toEqual([]);

        expect((await host.internalActions.syncToTick(3)).status).toBe("ready");
        expect(host.internalState.currentSnapshot?.transfers).toEqual([]);
        expect((await host.internalActions.syncToTick(3)).status).toBe("ready");
        expect(host.internalState.currentSnapshot?.transfers).toEqual([]);

        expect(await host.actions.seekTimelineToTick(1)).toBe(true);
        expect(host.internalState.currentSnapshot).toEqual(transferSnapshot);
        expect(await host.actions.seekTimelineToTick(2)).toBe(true);
        expect(host.internalState.currentSnapshot?.tickNumber).toBe(3);
        expect(host.internalState.currentSnapshot?.transfers).toEqual([]);
      } finally {
        host.dispose();
      }
    });
  });

  it("publishes the Dense 2 TPS timing contract", async () => {
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
        standardTickRate: 2,
        tickRate: 2,
      });
      expect(host.internalState.currentSnapshot).toMatchObject({
        standardTickRate: 2,
        tickRate: 2,
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
      expect(host.internalState.currentSnapshot?.tickNumber).toBeGreaterThanOrEqual(1);
    } finally {
      host.dispose();
    }
  });

  it("starts dense regional simulation after excluding unknown entities from a background base", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_tianwangping_aid" });
    const staleEntity = createEntity("transmuter_2:1", "transmuter_2", 3, 4);
    const protocolCoreDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    protocolCoreDocument.entities = { [staleEntity.id]: staleEntity };
    protocolCoreDocument.entityOrder = [staleEntity.id];
    protocolCoreDocument.slotLinks = [{
      id: "stale-warehouse-link",
      linkType: "share-all",
      source: {
        entityId: staleEntity.id,
        storageSlotGroupId: "output",
        slotId: "slot",
      },
      target: {
        entityId: "warehouse",
        storageSlotGroupId: "warehouse",
        slotId: "item_copper_ore",
      },
    }];
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
    const staleEntity = createEntity("transmuter_2:1", "transmuter_2", 3, 4);
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    currentDocument.entities = { [staleEntity.id]: staleEntity };
    currentDocument.entityOrder = [staleEntity.id];
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

      expect(host.internalState.currentSnapshot?.tickNumber).toBe(5);
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
  const document = createWorldDocumentFromBlueprint(createBlueprint(name, [
    createEntity("source-storage", "liquid_storager_1", 0, 0, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("pipe", "pipe_straight_1x1", 3, 1),
    createEntity("sink-storage", "liquid_storager_1", 4, 0, 180),
  ]));
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
  };
}
