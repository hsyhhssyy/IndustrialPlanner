import { describe, expect, it, vi } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { createSimulationHost } from "@/simulation/host/simulation-host";

describe("SimulationHost", () => {
  it("owns runtime view state and inspector details through its snapshot store", async () => {
    const host = createSimulationHost();
    const listener = vi.fn();
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);
    const unsubscribe = host.subscribe(listener);

    host.load({ document, topology, registry });
    host.step();
    await host.queryInspector("reactor-1");

    const snapshot = host.getSnapshot();

    expect(snapshot.runtimeSnapshot.tick).toBe(1);
    expect(snapshot.telemetry.entityCount).toBe(document.entityOrder.length);
    expect(snapshot.inspectorDetails?.entityId).toBe("reactor-1");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    host.dispose();
  });

  it("tracks runtime patch overlays separately from the loaded document", async () => {
    const host = createSimulationHost();
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);

    host.load({ document, topology, registry });
    await host.applyEntityConfigPatch("dark-outlet-1", {
      selectedLiquidItemId: "item_liquid_plant_grass_2",
    });
    await host.queryInspector("dark-outlet-1");

    const patchedSnapshot = host.getSnapshot();

    expect(
      patchedSnapshot.patchSet.entityConfigByEntityId["dark-outlet-1"]
        ?.selectedLiquidItemId,
    ).toBe("item_liquid_plant_grass_2");
    expect(patchedSnapshot.runtimeSnapshot.patchedEntityIds).toContain(
      "dark-outlet-1",
    );
    expect(patchedSnapshot.inspectorDetails?.effectiveConfig.selectedLiquidItemId).toBe(
      "item_liquid_plant_grass_2",
    );

    host.clearPatches();

    const clearedSnapshot = host.getSnapshot();

    expect(clearedSnapshot.patchSet.entityConfigByEntityId["dark-outlet-1"]).toBeUndefined();
    expect(clearedSnapshot.runtimeSnapshot.patchedEntityIds).toEqual([]);

    host.dispose();
  });

  it("clears inspector details when queryInspector receives no active entity", async () => {
    const host = createSimulationHost();
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);

    host.load({ document, topology, registry });
    await host.queryInspector("reactor-1");

    expect(host.getSnapshot().inspectorDetails?.entityId).toBe("reactor-1");

    await host.queryInspector(null);

    expect(host.getSnapshot().inspectorDetails).toBeNull();

    host.dispose();
  });

  it("keeps entity selection separate from inspector queries", async () => {
    const host = createSimulationHost();
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);

    host.load({ document, topology, registry });
    await host.selectEntity("reactor-1");

    expect(host.getSnapshot().selection).toEqual(["reactor-1"]);
    expect(host.getSnapshot().inspectorDetails).toBeNull();

    await host.queryInspector("reactor-1");

    expect(host.getSnapshot().inspectorDetails?.entityId).toBe("reactor-1");

    host.dispose();
  });

  it("skips no-op selection and inspector clear updates", async () => {
    const host = createSimulationHost();
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);

    host.load({ document, topology, registry });

    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);

    await host.queryInspector(null);
    expect(listener).not.toHaveBeenCalled();

    await host.selectEntity("reactor-1");
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();

    await host.selectEntity("reactor-1");
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    host.dispose();
  });
});
