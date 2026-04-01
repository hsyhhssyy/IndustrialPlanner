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
});
