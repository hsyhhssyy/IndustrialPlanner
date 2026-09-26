// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import { createRegistryContract } from "@/registry";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { PlanningBudgetExhausted } from "@/blueprint-planner/model";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import plant from "./fixtures/plant-preload.json";

const workerBuild = vi.hoisted(() => vi.fn());
const listBlueprintDirectory = vi.hoisted(() => vi.fn());
const createBlueprintFolder = vi.hoisted(() => vi.fn());
const saveBlueprintDocument = vi.hoisted(() => vi.fn());

vi.mock("@/blueprint-planner/worker-client", () => ({
  PlannerWorkerClient: class {
    build = workerBuild;
    dispose(): void {}
  },
}));

vi.mock("@/blueprint-planner/verification", () => ({
  meetsOperatingLimits: () => true,
  meetsProductionTargets: () => true,
}));

vi.mock("@/shared/storage/blueprint-storage", () => ({
  listBlueprintDirectory,
  createBlueprintFolder,
  saveBlueprintDocument,
}));

function candidate(area: number): PlannerCandidate {
  return {
    supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
    search: {
      seed: 0, evaluationLimit: 1_000, outline: { width: area, height: 1 }, evaluations: 1,
      acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
    },
    execution: {
      blueprint: createBlueprintDocument({
        name: `候选 ${area}`, baseId: "wuling_protocol_core", initialGridPoint: { x: 0, y: 0 },
        entities: {}, entityOrder: [], slotLinks: [],
      }),
      scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" },
      probes: [], warmupSeconds: 0, observationSeconds: 60, inventorySampleCount: 1,
      maxWallTimeMs: 1_000, activeActivityIds: [],
    },
    metrics: { width: area, height: 1, area, entityCount: 0, productionDeviceCount: 0,
      gasDiffuserCount: 0, additionalGasDiffuserCount: 0, score: area },
    connections: [],
  };
}

describe("EDA Host 多轮规划", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBlueprintDirectory.mockResolvedValue({ folders: [{ folderId: "auto", name: "自动规划" }] });
    createBlueprintFolder.mockResolvedValue({ folderId: "auto", name: "自动规划" });
    saveBlueprintDocument.mockResolvedValue({});
  });

  it("手动保存后仍可反复继续，并只在出现新最优结果时允许再次保存", async () => {
    const first = candidate(100), improved = candidate(90);
    workerBuild
      .mockResolvedValueOnce(first).mockRejectedValueOnce(new PlanningBudgetExhausted())
      .mockResolvedValueOnce(first).mockRejectedValueOnce(new PlanningBudgetExhausted())
      .mockResolvedValueOnce(improved).mockRejectedValueOnce(new PlanningBudgetExhausted());
    const report: SimulationBlueprintRunReport = {
      status: "completed", engineKind: "dense-v2", simulationSeconds: 60, observationSeconds: 60, elapsedMs: 1,
      probes: [], inventorySamples: [], deviceStatuses: [], diagnostics: [],
    };
    const simulation = { actions: { stop: vi.fn(), runBlueprint: vi.fn().mockResolvedValue(report) } };
    const workspace = {
      registry: createRegistryContract(), simulation, audio: null, blueprintPlanner: null,
      state: {}, app: null, editor: null, render: null, sync: null,
    } as unknown as WorkspaceContract;
    const host = createBlueprintPlannerHost(workspace);
    const request = readPlanningInput(workspace.registry, plant);

    try {
      const taskId = host.actions.start(request);
      await vi.waitFor(() => expect(host.queries.getTask()?.status).toBe("waiting"));
      expect(host.queries.getTask()?.bestArea).toBe(100);
      expect(host.queries.getResult(taskId)).toBeNull();

      await host.actions.save(taskId);
      expect(host.queries.getTask()?.status).toBe("completed");
      expect(host.queries.getResult(taskId)?.metrics.area).toBe(100);
      await expect(host.actions.save(taskId)).rejects.toThrow("当前没有可保存的新结果");

      host.actions.continuePlanning(taskId, 1_000, 2_000);
      await vi.waitFor(() => expect(host.queries.getTask()?.status).toBe("completed"));
      expect(host.queries.getResult(taskId)?.metrics.area).toBe(100);

      host.actions.continuePlanning(taskId, 1_000, 3_000);
      await vi.waitFor(() => expect(host.queries.getTask()?.status).toBe("waiting"));
      expect(host.queries.getTask()?.bestArea).toBe(90);
      await host.actions.save(taskId);
      expect(host.queries.getTask()?.status).toBe("completed");
      expect(host.queries.getResult(taskId)?.metrics.area).toBe(90);

      expect(workerBuild.mock.calls.map((call) => call[3])).toEqual([50_000, 50_000, 2_000, 2_000, 3_000, 3_000]);
      expect(new Set(workerBuild.mock.calls.map((call) => call[0]))).toEqual(new Set([workerBuild.mock.calls[0]![0]]));
      expect(saveBlueprintDocument).toHaveBeenCalledTimes(2);
    } finally {
      host.dispose();
    }
  });
});
