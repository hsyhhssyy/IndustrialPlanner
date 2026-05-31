import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { createSimulationHost } from "@/simulation/simulation-host";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import type { CompiledSimulationTopology } from "@/simulation/types";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
  findSlot,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

describe("REQ-084: simulation power system", () => {
  it("runs powered recipes and exposes total power demand through topology and snapshots", async () => {
    const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("powered-grinder", 4),
      registry: createRegistryContract(),
      maxTickNumber: completionTick,
    });

    expect(report.topology.totalPowerDemand).toBe(5);
    expect(getTick(report, 0).totalPowerDemand).toBe(5);
    expect(getDevice(report, 1, "grinder").channelRecipes["default"]).toMatchObject({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(report, completionTick, "grinder", "item_output_buffer", "output_slot_1"))
      .toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
  });

  it("keeps out-of-range devices from starting new recipes", async () => {
    const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("unpowered-grinder", 40),
      registry: createRegistryContract(),
      maxTickNumber: completionTick,
    });

    expect(report.topology.totalPowerDemand).toBe(0);
    expect(getTick(report, completionTick).totalPowerDemand).toBe(0);
    // AI-CORRECTION 2026-05-30: 无供电时 deviceSnapshot.channelRecipes 无 "default" key，
    //   channelRecipes["default"] 返回 undefined（旧代码 flat recipeId 返回 null）。
    expect(getDevice(report, completionTick, "grinder").channelRecipes["default"]).toBeUndefined();
    expect(findSlot(report, completionTick, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
  });

  it("reactivates unpowered device when a new power pole is added mid-simulation", async () => {
    // 复现：已放置但未供电的设备，在仿真运行中新增供电桩后应自动启动。
    // 1. 创建只有研磨机没有供电桩的蓝图
    const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(
      createGrinderOnlyBlueprint("add-pole-late"),
    ));
    const registry = createRegistryContract();
    const workspace = createHeadlessWorkspace(documentStore, registry);
    const host = createSimulationHost(workspace, { workerMode: "runtime" });

    try {
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("out-of-power-range");

      await expectReady(host.internalActions.syncToTick(20));
      // 没电时研磨机不应有产出
      expect(readGrinderRecipeId(host)).toBeNull();

      // 2. 在同一文档中新增供电桩（不替换整个文档，模拟用户放置行为）
      const currentDoc = documentStore.getSnapshot();
      const powerEntity = createEntity("power", "item_port_power_diffuser_1", 4, 0);
      const nextDoc: WorldDocument = {
        ...currentDoc,
        entities: { ...currentDoc.entities, [powerEntity.id]: powerEntity },
        entityOrder: [...currentDoc.entityOrder, powerEntity.id],
      };
      documentStore.setSnapshot(nextDoc);

      // 3. 手动触发仿真刷新（模拟 document.subscribe → refreshFromCurrentDocument）
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("in-power-range");

      // 4. 研磨机应恢复工作并产出（至少需要 2 秒即 40 ticks）
      const completionTick = 3 * STANDARD_TICK_RATE_PER_SECOND + 5; // tick 65
      await expectReady(host.internalActions.syncToTick(completionTick));
      const tickStatus = host.queries.getDeviceRuntimeStatus("grinder");
      console.log("grinder status at completion tick:", JSON.stringify(tickStatus));
      expect(readGrinderSlot(host, "item_output_buffer", "output_slot_1")).toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    } finally {
      host.dispose();
    }
  });

  it("freezes running recipe progress while unpowered and resumes after topology migration restores power", async () => {
    const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(
      createGrinderBlueprint("migration-power-on", 4),
    ));
    const workspace = createHeadlessWorkspace(documentStore, createRegistryContract());
    const host = createSimulationHost(workspace, {
      workerMode: "runtime",
    });

    try {
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      await expectReady(host.internalActions.syncToTick(10));
      const poweredProgressSeconds = readGrinderProgressSeconds(host);

      documentStore.setSnapshot(createWorldDocumentFromBlueprint(
        createGrinderBlueprint("migration-power-off", 40),
      ));
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("out-of-power-range");
      expect(host.topology.getSnapshot()?.totalPowerDemand).toBe(0);

      await expectReady(host.internalActions.syncToTick(30));
      expect(readGrinderProgressSeconds(host)).toBe(poweredProgressSeconds);

      documentStore.setSnapshot(createWorldDocumentFromBlueprint(
        createGrinderBlueprint("migration-power-restored", 4),
      ));
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("in-power-range");
      expect(host.topology.getSnapshot()?.totalPowerDemand).toBe(5);

      await expectReady(host.internalActions.syncToTick(70));
      expect(readGrinderSlot(host, "item_output_buffer", "output_slot_1")).toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    } finally {
      host.dispose();
    }
  });

  // 回归测试：验证 applyPlacementDraft 在 documentWriter.commit 之前清除 placement state。
  // Bug 场景：仿真运行中放置供电桩，预览 draft 与刚放置的正式实体被判定重叠 → 供电桩进入
  // invalidPlacement → resolveSimulationCompileDocument 过滤 → 仿真拓扑缺失供电桩。
  // 修复方案：clearPlacementState 移到 commit 之前，确保 subscribe 回调链不会看到过期的 drafts。
  it("does not filter newly placed power pole from simulation topology due to stale placement drafts", async () => {
    const workspace = createEditorTestWorkspace();
    const editorHost = createEditorHost(workspace);

    // 让 hookDocumentStorage 的异步初始化先执行完毕，避免后续覆盖测试文档。
    // hookDocumentStorage 中 resolveInitialDocument 在 lastDocumentId 为 null 时同步返回
    // createWorldDocument()，因此单次 microtask 即可完成。
    await Promise.resolve();

    // 1. 设置只有研磨机（需要供电）的文档
    const grinder = createTestEntity("grinder", "item_port_grinder_1", 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    });
    editorHost.internalDocument.setSnapshot(
      createTestDocument([grinder]),
    );

    // 2. 创建仿真 host（workerMode: runtime 用于同步测试）
    const simulationHost = createSimulationHost(workspace, {
      workerMode: "runtime",
    });

    try {
      // 3. 启动仿真 — 此时研磨机无供电，应在供电范围外
      await simulationHost.actions.start();
      const topologyBefore = simulationHost.topology.getSnapshot();
      expect(topologyBefore?.devices["device:grinder"]?.powerStatus).toBe(
        "out-of-power-range",
      );

      // 4. 模拟用户放置供电桩：创建 placement draft
      editorHost.actions.createSinglePlacementDraft(
        "item_port_power_diffuser_1",
        { x: 4, y: 0 },
      );

      // 5. 应用 placement — 这是核心测试路径：
      //    applyPlacementDraft → clearPlacementState → commit → subscribe 链
      //    若 clearPlacementState 在 commit 之后，预览 draft 会与供电桩重叠 → invalidPlacement
      const applied = editorHost.actions.applyPlacementDraft();
      expect(applied).toBe(true);

      // 6. 等待 fire-and-forget 的 refreshFromCurrentDocument 完成。
      //    注意：不可在此显式调用 refreshFromCurrentDocument，否则会修正 Bug 导致的错误拓扑。
      //    用 setTimeout 确保所有 microtask（包括 runtime worker 的 loadTopology）已完成。
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 7. 验证：供电桩必须在拓扑中（未被 invalidPlacement 过滤）
      const topology = simulationHost.topology.getSnapshot();
      expect(topology).not.toBeNull();
      expect(topology?.devices["device:grinder"]?.powerStatus).toBe(
        "in-power-range",
      );
      expect(topology?.totalPowerDemand).toBeGreaterThan(0);
    } finally {
      simulationHost.dispose();
    }
  });
});

describe("REQ-089: power generation mode caching bug", () => {
  it("setPowerMode clears cached ticks so new mode takes effect immediately", () => {
    // 拓扑：一个 grinder（requiresPower: true）在供电范围内，无发电设备。
    // demand=40_000kW → 每 tick 消耗 2MJ，100MJ 电池约 50 ticks 耗尽。
    // 配方 durationTicks=100，原料充足，避免电池耗尽前后配方做完导致不可比较。
    const topology: CompiledSimulationTopology = {
      schemaVersion: 4,
      topologyId: "topology:power-mode-cache-test",
      documentKey: "document:test",
      documentHash: "hash:test",
      registryHash: "registry:test",
      standardTickRate: STANDARD_TICK_RATE_PER_SECOND,
      totalPowerDemand: 40_000,
      itemCatalog: {
        item_iron_nugget: { id: "item_iron_nugget", domain: "solid", tags: [] },
        item_iron_powder: { id: "item_iron_powder", domain: "solid", tags: [] },
      },
      recipeCatalog: {
        "r_test": {
          id: "r_test",
          nameKey: "recipe.test",
          durationTicks: 100,
          inputs: [{ itemId: "item_iron_nugget", amount: 1 }],
          outputs: [{ itemId: "item_iron_powder", amount: 1 }],
          machineId: "test_machine",
          recipeType: "immediate-consume",
          tags: [],
          powerOutput: 0,
        },
      },
      devices: {
        "device:grinder": {
          id: "device:grinder",
          sourceEntityId: "grinder",
          definitionId: "test_machine",
          position: null,
          rotation: null,
          tags: [],
          powerStatus: "in-power-range",
          powerDemand: 40_000,
          requiresPower: true,
          transportClass: "anchor",
          transportComponentId: null,
          nodeIds: ["node:input", "node:output"],
          recipeChannels: [{
            id: "main",
            ingredientNodeIds: ["node:input"],
            productNodeIds: ["node:output"],
            manualRecipeOnly: false,
            defaultRecipeId: null,
          }],
          portIds: [],
          routing: {},
          configHash: "config:test",
        },
      },
      nodes: {
        "node:input": {
          id: "node:input", deviceId: "device:grinder",
          sourceStorageSlotGroupId: null, viewRole: "input-view",
          slotIds: ["slot:input"], inputPortIds: [], outputPortIds: [],
          groupOrder: 0,
        },
        "node:output": {
          id: "node:output", deviceId: "device:grinder",
          sourceStorageSlotGroupId: null, viewRole: "output-view",
          slotIds: ["slot:output"], inputPortIds: [], outputPortIds: [],
          groupOrder: 1,
        },
      },
      slots: {
        "slot:input": {
          id: "slot:input", nodeId: "node:input",
          sourceStorageSlotGroupId: null, sourceSlotId: null,
          capacity: 50, domain: "solid", lock: null,
          initialItemType: "item_iron_nugget", initialCount: 20,
          ignoreStock: false, submitMode: "never", submitIntervalTicks: null,
        },
        "slot:output": {
          id: "slot:output", nodeId: "node:output",
          sourceStorageSlotGroupId: null, sourceSlotId: null,
          capacity: 50, domain: "solid", lock: null,
          initialItemType: null, initialCount: 0,
          ignoreStock: false, submitMode: "never", submitIntervalTicks: null,
        },
      },
      ports: {},
      links: {},
      physicalConnections: {},
      transferEdges: {},
      ordering: {
        deviceOrder: ["device:grinder"],
        nodeOrder: ["node:input", "node:output"],
        slotOrder: ["slot:input", "slot:output"],
        portOrder: [],
        physicalConnectionOrder: [],
        edgeOrder: [],
      },
      transportComponents: {},
      diagnostics: [],
    };

    const runtime = new SimulationWorkerRuntime();

    // 1. 真实电力模式启动。电池 100MJ，demand=40_000kW → ~50 ticks 耗尽。
    //    先跑到 tick 10：电池还没耗尽，grinder 应正在运行配方。
    runtime.setPowerMode("real");
    runtime.handleRequest({ type: "load-topology", requestId: 1, topology });
    runtime.advanceToTick(10);

    const earlyResp = runtime.handleRequest({
      type: "get-tick-snapshot", requestId: 99, tickNumber: 10,
    });
    const earlySnap = (earlyResp as Extract<typeof earlyResp, { type: "tick-snapshot-result" }>).result.currentTick!;
    expect(earlySnap.currentPowerGeneration).toBe(0);
    // 电池有电 → grinder 正常运行
    expect(earlySnap.isPowerOutage).toBe(false);
    expect(earlySnap.devices["device:grinder"]?.recipe?.state, "电池有电时 grinder 正常运行").toBe("running");

    // 2. 跑到 tick 100，电池已耗尽（~tick 50 耗尽，之后冻结了 50 tick）
    runtime.advanceToTick(100);
    const outagedResp = runtime.handleRequest({
      type: "get-tick-snapshot", requestId: 100, tickNumber: 100,
    });
    const outagedSnap = (outagedResp as Extract<typeof outagedResp, { type: "tick-snapshot-result" }>).result.currentTick!;
    expect(outagedSnap.currentPowerGeneration).toBe(0);
    expect(outagedSnap.isPowerOutage).toBe(true);
    // 配方已冻结，进度停留在电池耗尽那一刻
    const frozenProgress = outagedSnap.devices["device:grinder"]?.recipe?.progressTicks ?? 0;
    expect(outagedSnap.devices["device:grinder"]?.recipe?.state, "电池耗尽后配方冻结").toBe("running");

    // 3. 切换到无限电力 → grinder 应立即恢复运行
    runtime.setPowerMode("infinite");
    runtime.advanceToTick(105);

    const infiniteResp = runtime.handleRequest({
      type: "get-tick-snapshot", requestId: 101, tickNumber: 105,
    });
    const infiniteSnap = (infiniteResp as Extract<typeof infiniteResp, { type: "tick-snapshot-result" }>).result.currentTick!;
    expect(infiniteSnap.isPowerOutage).toBe(false);
    expect(infiniteSnap.devices["device:grinder"]?.recipe?.state, "无限电力模式切换后 grinder 恢复运行").toBe("running");
    expect(infiniteSnap.devices["device:grinder"]?.recipe?.progressTicks ?? 0,
      "无限电力模式切换后配方进度应增长").toBeGreaterThan(frozenProgress);

    // 4. 再切回真实电力 → grinder 再次冻结
    runtime.setPowerMode("real");
    runtime.advanceToTick(110);

    const realResp = runtime.handleRequest({
      type: "get-tick-snapshot", requestId: 102, tickNumber: 110,
    });
    const realSnap = (realResp as Extract<typeof realResp, { type: "tick-snapshot-result" }>).result.currentTick!;
    expect(realSnap.currentPowerGeneration).toBe(0);
    expect(realSnap.isPowerOutage).toBe(true);
    expect(realSnap.devices["device:grinder"]?.recipe?.state, "切回真实电力后已有配方应冻结").toBe("running");
    // 高速模式下切换回真实电力后，非运行时 tick 的判定应和运行时 tick 一致
    expect(realSnap.devices["device:grinder"]?.recipe?.progressTicks,
      "切回真实电力后配方进度不再增长").toBe(infiniteSnap.devices["device:grinder"]?.recipe?.progressTicks ?? 0);
  });
});

function createEditorTestWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

function createTestEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  config: WorldEntity["config"] = {},
): WorldEntity {
  return { id, definitionId, position: { x, y }, rotation: 0, config, tags: [] };
}

function createTestDocument(entities: readonly WorldEntity[]): WorldDocument {
  return {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    entityOrder: entities.map((e) => e.id),
  };
}

function createGrinderBlueprint(
  name: string,
  powerX: number,
): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("grinder", "item_port_grinder_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("power", "item_port_power_diffuser_1", powerX, 0),
  ]);
}

function createGrinderOnlyBlueprint(name: string): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("grinder", "item_port_grinder_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
  ]);
}

function createHeadlessWorkspace(
  documentSnapshot: SnapshotStoreReadWrite<WorldDocument>,
  registry: RegistryContract,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: {
      document: documentSnapshot,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
  };
}

async function expectStarted(
  promise: Promise<{ readonly status: "started" | "failed"; readonly error?: string }>,
): Promise<void> {
  const result = await promise;
  if (result.status !== "started") {
    throw new Error(result.error ?? "Expected simulation to start.");
  }
}

async function expectReady(
  promise: Promise<{ readonly status: string }>,
): Promise<void> {
  const result = await promise;
  if (result.status !== "ready") {
    throw new Error(`Expected tick to be ready, received ${result.status}.`);
  }
}

function readGrinderProgressSeconds(
  host: ReturnType<typeof createSimulationHost>,
): number {
  const status = host.queries.getDeviceRuntimeStatus("grinder");
  if (status === null) {
    throw new Error("Expected grinder device runtime status.");
  }
  // AI-CORRECTION 2026-05-30: channel id 为 "default"，非 "grind"。
  const grindStatus = status.channelRecipes["default"];
  if (grindStatus?.progressSeconds === null || grindStatus?.progressSeconds === undefined) {
    throw new Error("Expected grinder recipe to be running.");
  }
  return grindStatus.progressSeconds;
}

function readGrinderRecipeId(
  host: ReturnType<typeof createSimulationHost>,
): string | null {
  // AI-CORRECTION 2026-05-30: channel id 为 "default"，非 "grind"。
  //   null ?? null 确保 channelRecipes 为空时返回 null 而非 undefined。
  return host.queries.getDeviceRuntimeStatus("grinder")?.channelRecipes["default"]?.recipeId ?? null;
}

function readGrinderSlot(
  host: ReturnType<typeof createSimulationHost>,
  storageGroupId: string,
  slotId: string,
) {
  const slot = host.queries.getDeviceRuntimeStatus("grinder")?.slotItems.find((candidate) =>
    candidate.storageGroupId === storageGroupId
    && candidate.slotId === slotId,
  );
  if (slot === undefined) {
    throw new Error(`Expected grinder slot ${storageGroupId}:${slotId}.`);
  }

  return slot;
}
