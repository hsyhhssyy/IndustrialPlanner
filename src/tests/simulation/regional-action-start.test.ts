import { readSimulationSnapshot } from "@/simulation/testkit";
import { describe, expect, it, vi } from "vitest";

import { createRegistryContract } from "@/registry";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
// AI-REMOVED 2026-09-25:
// Reason: 仿真输入已改为出口文档关系，不再接受 App getter。
// Trigger: REQ-038 移除 CreateSimulationHostOptions.getRegionalDarkPipeLinks。
// Evidence: main 装配与两种引擎已停止读取该 getter。
// Replacement: 本用例 regional-outlet.world.schema6.json。
// Risk: Low；保留 Legacy 单基地行为断言。
// Human Review: Required
// Original code:
// import { createRegionalDarkPipeLink } from "@/shared/dark-pipe-link";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";
import regionalOutletJson from "../fixtures/blueprints/simulation/dense-host-regressions/regional-outlet.world.schema6.json";
import type { AppContract } from "@/domain/app/app-contract";

describe("区域多基地启动模式固化", () => {
  // AI-CORRECTION 2026-09-22: 区域模式现与单基地共享完整速度集合，启动时必须保留 x4/x16。
  it("Dense 启动时读取 AppSettings，并保留区域模式的完整倍率", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const appSettings = { regionalMultiBaseEnabled: true };
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: createRegionalMultiBaseAppContract(appSettings),
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {
          readLatestBaseDocuments: async (baseIds: readonly string[]) =>
            baseIds.map((baseId) => createWorldDocument({ baseId })),
        } as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
      blueprintPlanner: null,
    };

    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });
    try {
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.singleBase);
      host.actions.setSimulationSpeed(16);
      // AI-REMOVED 2026-09-20:
      // Reason: 外部不再通过 SimulationAction 预写会话模式。
      // Trigger: ST2-RQ-035 要求 Dense.start 从 AppSettings 固化模式与倍率。
      // Evidence: 本测试已把 AppContract 设置为 true，并直接启动新会话。
      // Replacement: await host.actions.start()。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();
      // AI-REMOVED 2026-09-22:
      // Reason: 区域模式不再把 x16 归一化为 x1。
      // Trigger: 用户要求所有模式均可使用完整速度。
      // Evidence: Dense 区域合图与单基地共用速率控制路径。
      // Replacement: 下方断言保留 x16，并验证运行中可切换至 x4。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect(host.state.simulationSpeed).toBe(1);
      expect(host.state.simulationSpeed).toBe(16);
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      host.actions.setSimulationSpeed(4);
      expect(host.state.simulationSpeed).toBe(4);
      // AI-REMOVED 2026-09-20:
      // Reason: 倍率归一化已移到 Dense.start，旧测试通过已删除的 Action 反复切换模式。
      // Trigger: ST2-RQ-035 要求外部只能设置 AppSettings，并在启动边界固化模式。
      // Evidence: 上方以 x16 启动并断言归一化为 x1；合法倍率由下一测试的 x2 覆盖。
      // Replacement: 本测试与下一个会话固化测试。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // for (const speed of [0.25, 1, 2]) {
      //   host.actions.setRegionalMultiBaseEnabled(false);
      //   host.actions.setSimulationSpeed(speed);
      //   host.actions.setRegionalMultiBaseEnabled(true);
      //   expect(host.state.simulationSpeed).toBe(speed);
      //   expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      // }
      // for (const speed of [0, 0.5, 4, 16, 32]) {
      //   host.actions.setRegionalMultiBaseEnabled(false);
      //   host.actions.setSimulationSpeed(speed);
      //   host.actions.setRegionalMultiBaseEnabled(true);
      //   expect(host.state.simulationSpeed).toBe(1);
      // }
    } finally {
      host.dispose();
    }
  });

  it("运行中设置变化不改写当前会话，并在下一次启动重新固化", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const otherBaseIds = registry.baseDefinitions
      .filter((definition) => definition.tag === "武陵" && definition.id !== currentDocument.baseId)
      .map((definition) => definition.id);
    const latestDocuments = otherBaseIds.map((baseId) => createWorldDocument({ baseId }));

    const editorDocument = createSnapshotStore(currentDocument);
    const appSettings = { regionalMultiBaseEnabled: true };
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: createRegionalMultiBaseAppContract(appSettings),
      editor: {
        document: editorDocument,
        state: {} as never,
        queries: {
          readLatestBaseDocuments: async (baseIds: readonly string[]) =>
            baseIds.map((baseId) => latestDocuments.find((document) => document.baseId === baseId)
              ?? createWorldDocument({ baseId })),
        } as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
      blueprintPlanner: null,
    };

    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });
    try {
      host.actions.setSimulationSpeed(2);
      await host.actions.start();
      expect(host.state.runningState).toBe("start");
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      expect(host.state.simulationSpeed).toBe(2);
      host.actions.pause();
      appSettings.regionalMultiBaseEnabled = false;
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      expect(readSimulationSnapshot(host)?.tickNumber).toBeGreaterThanOrEqual(0);
      expect(host.queries.getWarehouseStats()).not.toBeNull();
      host.actions.stop();
      await host.actions.start();
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.singleBase);
      // AI-REMOVED 2026-09-20:
      // Reason: 本测试改为验证设置与会话模式的生命周期边界，不再验证已被 Dense 合图实现替代的旧 Epoch 缓冲细节。
      // Trigger: ST2-RQ-035 要求运行中设置变化不影响当前会话、下次 start 才生效。
      // Evidence: 当前断言覆盖 x2 保留、运行中 mode 不变及 stop/start 后切换为 single-base。
      // Replacement: 当前测试；Dense 缓冲回归由 dense-host-regressions 覆盖。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // expect(host.internalState.runtimeStatus.dynamicTickRate).toBe(10);
      // expect(host.internalState.runtimeStatus.maxBufferSize).toBe(20);
      // host.actions.setRegionalMultiBaseEnabled(false);
      // expect(host.internalState.runtimeStatus.latestTickNumber).toBeGreaterThanOrEqual(1);
      // expect(host.internalState.runtimeStatus.latestTickNumber).toBeLessThanOrEqual(11);
      // expect(host.internalState.runtimeStatus.bufferSize).toBeLessThanOrEqual(20);
    } finally {
      host.dispose();
    }
  });

  it("区域启动准入拒绝时写入结构化错误日志并保留运行态原因", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    registry.baseDefinitions = registry.baseDefinitions.filter((definition) =>
      definition.id === currentDocument.baseId
    );
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: createRegionalMultiBaseAppContract({ regionalMultiBaseEnabled: true }),
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {} as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
      blueprintPlanner: null,
    };

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      workerMode: "runtime",
    });
    try {
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

  it("Legacy 忽略多基地设置并始终启动单基地会话", async () => {
    const registry = createRegistryContract();
    const currentDocument = normalizeWorldDocument(regionalOutletJson)!;
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: createRegionalMultiBaseAppContract({ regionalMultiBaseEnabled: true }),
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {} as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
      blueprintPlanner: null,
    };
// AI-REMOVED 2026-09-25:
// Reason: 仿真输入已改为出口文档关系，不再接受 App getter。
// Trigger: REQ-038 移除 CreateSimulationHostOptions.getRegionalDarkPipeLinks。
// Evidence: main 装配与两种引擎已停止读取该 getter。
// Replacement: 本用例 regional-outlet.world.schema6.json。
// Risk: Low；保留 Legacy 单基地行为断言。
// Human Review: Required
// Original code:
//     const link = createRegionalDarkPipeLink({
//       inlet: { baseId: currentDocument.baseId, entityId: "inlet" },
//       outlet: { baseId: "wuling_tianwangping_aid", entityId: "outlet" },
//     });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, {
      engineKind: "legacy",
      workerMode: "runtime",
// AI-REMOVED 2026-09-25:
// Reason: 仿真输入已改为出口文档关系，不再接受 App getter。
// Trigger: REQ-038 移除 CreateSimulationHostOptions.getRegionalDarkPipeLinks。
// Evidence: main 装配与两种引擎已停止读取该 getter。
// Replacement: 本用例 regional-outlet.world.schema6.json。
// Risk: Low；保留 Legacy 单基地行为断言。
// Human Review: Required
// Original code:
//       getRegionalDarkPipeLinks: () => [link],
    });

    try {
      await host.actions.start();

      expect(host.state.runningState).toBe("start");
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.singleBase);
      expect(host.internalState.runtimeStatus.error).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
      // AI-REMOVED 2026-09-20:
      // Reason: Legacy 已无区域多基地产品入口，不能再进入跨基地暗管拒绝分支。
      // Trigger: ST2-RQ-035 要求 Legacy 无条件固化 single-base。
      // Evidence: 即使 AppSettings 为 true 且存在跨基地暗管，当前启动仍成功且模式为 single-base。
      // Replacement: 上方 Legacy 单基地会话断言。
      // Risk: Medium；旧 Legacy 区域能力仍保留在内部，但不可从公开入口启动。
      // Human Review: Required
      //
      // Original code:
      // expect(host.state.runningState).toBe("stop");
      // expect(host.internalState.runtimeStatus).toMatchObject({
      //   mode: "error",
      //   error: "跨基地暗管仅支持 Dense 引擎；Legacy 区域仿真无法启动。",
      // });
      // expect(consoleError).toHaveBeenCalledWith(
      //   "[industrial-planner:simulation-runtime] Regional simulation start rejected.",
      //   {
      //     code: "legacy-regional-dark-pipe-unsupported",
      //     currentBaseId: currentDocument.baseId,
      //     regionTag: "武陵",
      //     darkPipeLinkCount: 1,
      //     error: "跨基地暗管仅支持 Dense 引擎；Legacy 区域仿真无法启动。",
      //   },
      // );
    } finally {
      host.dispose();
      consoleError.mockRestore();
    }
  });
});

function createRegionalMultiBaseAppContract(
  settings: { regionalMultiBaseEnabled: boolean },
): AppContract {
  return {
    state: { settings },
    queries: {},
    actions: {},
  } as unknown as AppContract;
}
