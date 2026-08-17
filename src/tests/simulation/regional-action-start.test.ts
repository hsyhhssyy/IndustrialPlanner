import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";

describe("区域多基地 SimulationAction 启动", () => {
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
      expect(host.internalState.currentSnapshot?.tickNumber).toBeGreaterThanOrEqual(0);
      expect(host.internalState.runtimeStatus.latestTickNumber).toBeGreaterThanOrEqual(10);
      expect(host.queries.getWarehouseStats()).not.toBeNull();
    } finally {
      host.dispose();
    }
  });
});
