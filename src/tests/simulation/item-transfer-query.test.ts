import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createHeadlessWorkspace } from "./blueprint-runner";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

describe.each(["dense-v2", "legacy"] as const)("实际物品交接查询 [%s]", (engineKind) => {
  it("公开真实搬运的来源、目标和物品，停止后清空", async () => {
    const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
    const workspace = createHeadlessWorkspace(createWorldDocumentFromBlueprint(blueprint), createRegistryContract());
    const host = createSimulationHost(workspace, { workerMode: "runtime", engineKind });
    try {
      expect((await host.internalActions.refreshFromCurrentDocument()).status).toBe("started");
      const rate = host.queries.getDocumentRuntimeStatus()!.standardTickRate;
      const transfers = [];
      for (let tick = 0; tick <= rate * 5; tick++) {
        await host.internalActions.syncToTick(tick);
        transfers.push(...host.queries.getCurrentTickItemTransfers());
      }
      expect(transfers).toContainEqual({ sourceDeviceId: "belt", targetDeviceId: "sink-storage",
        itemId: "item_iron_ore", amount: 1 });
      host.actions.stop();
      expect(host.queries.getCurrentTickItemTransfers()).toEqual([]);
    } finally {
      host.dispose();
    }
  });
});
