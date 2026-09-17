import { describe, expect, it } from "vitest";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

function request(): SimulationBlueprintRunRequest {
  return {
    blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/belt-transport/scene-01-belt-transport-56e0e3f4.schema6.json"),
    scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" },
    probes: [
      { id: "delivered", entityIds: ["sink-storage"], itemId: "item_iron_ore", direction: "input" },
      { id: "boundary", entityIds: ["source-storage", "belt"], itemId: "item_iron_ore", direction: "output" },
      { id: "internal", entityIds: ["source-storage", "belt", "sink-storage"], itemId: "item_iron_ore", direction: "output" },
    ],
    warmupSeconds: 2, observationSeconds: 8, inventorySampleCount: 5,
    maxWallTimeMs: 10_000, activeActivityIds: [],
  };
}

describe.each(SIMULATION_ENGINE_MATRIX)("独立蓝图执行 [%s]", (engineKind) => {
  function createHost() {
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry: createRegistryContract(),
      app: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null,
    };
    return { workspace, host: createSimulationHost(workspace, { engineKind, workerMode: "runtime" }) };
  }

  it("排除预热与集合内部转移，保留主场景状态，库存采样有界", async () => {
    const { workspace, host } = createHost();
    const input = request();
    const before = JSON.stringify(input);
    try {
      const report = await host.actions.runBlueprint(input);
      expect(report.status).toBe("completed");
      expect(report.engineKind).toBe(engineKind);
      expect(report.observationSeconds).toBe(8);
      expect(report.probes).toEqual([
        { id: "delivered", amount: 4, perMinute: 30 },
        { id: "boundary", amount: 4, perMinute: 30 },
        { id: "internal", amount: 0, perMinute: 0 },
      ]);
      expect(report.inventorySamples).toHaveLength(5);
      expect(report.inventorySamples[0]?.simulationSeconds).toBe(2);
      expect(report.inventorySamples.at(-1)?.simulationSeconds).toBe(10);
      expect(report.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
      expect(host.state.runningState).toBe("stop");
      expect(workspace.simulation).toBe(host);
      expect(JSON.stringify(input)).toBe(before);
    } finally { host.dispose(); }
  });

  it("取消与超时不伪造完成时长；Host 销毁后拒绝新执行", async () => {
    const { host } = createHost();
    try {
      const abort = new AbortController();
      abort.abort();
      const cancelled = await host.actions.runBlueprint(request(), abort.signal);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.observationSeconds).toBe(0);
      const timedOut = await host.actions.runBlueprint({ ...request(), maxWallTimeMs: Number.MIN_VALUE });
      expect(timedOut.status).toBe("timeout");
      expect(timedOut.observationSeconds).toBe(0);
    } finally { host.dispose(); }
    await expect(host.actions.runBlueprint(request())).rejects.toThrow("disposed");
  });

  it("编译前拒绝冲突实体与未知探针", async () => {
    const { host } = createHost();
    try {
      const input = request();
      await expect(host.actions.runBlueprint({
        ...input, scene: { ...input.scene, externalEntities: [input.blueprint.entities.belt!] },
      })).rejects.toThrow("duplicate");
      await expect(host.actions.runBlueprint({
        ...input, probes: [{ ...input.probes[0]!, entityIds: ["missing"] }],
      })).rejects.toThrow("Invalid blueprint probe");
    } finally { host.dispose(); }
  });
});
