import { describe, expect, it, vi } from "vitest";

import { createRegistryContract } from "@/registry";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

describe("区域多基地 SimulationAction 启动", () => {
  it("开启区域模式时保留合法倍率并将任意非法倍率归一化为 x1", () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: null,
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {} as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
    };

    const host = createSimulationHost(workspace, { workerMode: "runtime" });
    try {
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.singleBase);
      for (const speed of [0.25, 1, 2]) {
        host.actions.setRegionalMultiBaseEnabled(false);
        host.actions.setSimulationSpeed(speed);
        host.actions.setRegionalMultiBaseEnabled(true);
        expect(host.state.simulationSpeed).toBe(speed);
        expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      }

      for (const speed of [0, 0.5, 4, 16, 32]) {
        host.actions.setRegionalMultiBaseEnabled(false);
        host.actions.setSimulationSpeed(speed);
        host.actions.setRegionalMultiBaseEnabled(true);
        expect(host.state.simulationSpeed).toBe(1);
      }
    } finally {
      host.dispose();
    }
  });

  it("开启基地面板开关后按区域启动并预填已提交播放缓冲", async () => {
    const registry = createRegistryContract();
    const currentDocument = createWorldDocument({ baseId: "wuling_protocol_core" });
    const otherBaseIds = registry.baseDefinitions
      .filter((definition) => definition.tag === "武陵" && definition.id !== currentDocument.baseId)
      .map((definition) => definition.id);
    const latestDocuments = otherBaseIds.map((baseId) => createWorldDocument({ baseId }));

    const editorDocument = createSnapshotStore(currentDocument);
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(),
      registry,
      app: null,
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
    };

    const host = createSimulationHost(workspace, { workerMode: "runtime" });
    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();
      expect(host.state.runningState).toBe("start");
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      host.actions.setRegionalMultiBaseEnabled(false);
      expect(host.state.simulationMode).toBe(SIMULATION_MODE.regionalMultiBase);
      expect(host.internalState.currentSnapshot?.tickNumber).toBeGreaterThanOrEqual(0);
      expect(host.internalState.runtimeStatus.latestTickNumber).toBeGreaterThanOrEqual(10);
      expect(host.queries.getWarehouseStats()).not.toBeNull();
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
      app: null,
      editor: {
        document: createSnapshotStore(currentDocument),
        state: {} as never,
        queries: {} as never,
        actions: {} as never,
      },
      render: null,
      simulation: null,
      sync: null,
    };

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createSimulationHost(workspace, { workerMode: "runtime" });
    try {
      host.actions.setRegionalMultiBaseEnabled(true);
      await host.actions.start();

      expect(host.state.runningState).toBe("stop");
      expect(host.internalState.runtimeStatus).toMatchObject({
        mode: "error",
        error: "区域 武陵 至少需要两个基地才能启动多基地仿真。",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[industrial-planner:simulation-runtime] Regional simulation start rejected.",
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
});
