import { describe, expect, it } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";

describe("runBlueprintSimulation", () => {
  it("captures headless simulation snapshots from a blueprint document", async () => {
    const world = createDummyWorldDocument();
    const blueprint = createBlueprintDocument({
      name: "Dummy Blueprint",
      description: "",
      baseId: world.baseId,
      initialGridPoint: {
        x: 0,
        y: 0,
      },
      entities: world.entities,
      entityOrder: world.entityOrder,
      slotLinks: world.slotLinks,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: 2,
    });

    expect(report.blueprint.name).toBe("Dummy Blueprint");
    expect(report.execution.maxTickNumber).toBe(2);
    expect(report.execution.totalTicksCaptured).toBe(3);
    expect(report.ticks.map((tick) => tick.tickNumber)).toEqual([0, 1, 2]);
    expect(report.summary.totalTicksCaptured).toBe(3);
    expect(report.topology.topologyId.length).toBeGreaterThan(0);
  });
});