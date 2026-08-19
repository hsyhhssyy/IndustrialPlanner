import { describe, expect, it } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";

describe("simulation playback hot queue protocol", () => {
  it("returns a contiguous ready prefix without pruning until presentation is acknowledged", () => {
    const document = createWorldDocument({ baseId: "test-no-builtin-base" });
    const registry = createRegistryContract();
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "single-base",
      poweredEntityIds: new Set(),
    });
    const runtime = new SimulationWorkerRuntime(registry);

    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology,
    });
    runtime.advanceToTick(12);

    const range = runtime.handleRequest({
      type: "get-tick-snapshot-range",
      requestId: 2,
      fromTickNumber: 5,
      toTickNumber: 15,
      generation: 7,
    });
    expect(range.type).toBe("tick-snapshot-range-result");
    if (range.type !== "tick-snapshot-range-result") {
      throw new Error(`Unexpected response type '${range.type}'.`);
    }
    expect(range.result.status.status).toBe("ready");
    expect(range.result.snapshots.map((snapshot) => snapshot.tickNumber)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(runtime.getStatus().retainedFromTick).toBe(0);

    const acknowledged = runtime.handleRequest({
      type: "acknowledge-presented-tick",
      requestId: 3,
      tickNumber: 8,
      generation: 7,
    });
    expect(acknowledged.type).toBe("presented-tick-acknowledged");
    if (acknowledged.type !== "presented-tick-acknowledged") {
      throw new Error(`Unexpected response type '${acknowledged.type}'.`);
    }
    expect(acknowledged.acknowledgedTickNumber).toBe(8);
    expect(runtime.getStatus().retainedFromTick).toBe(8);

    const staleAcknowledgement = runtime.handleRequest({
      type: "acknowledge-presented-tick",
      requestId: 4,
      tickNumber: 10,
      generation: 6,
    });
    expect(staleAcknowledgement.type).toBe("presented-tick-acknowledged");
    if (staleAcknowledgement.type !== "presented-tick-acknowledged") {
      throw new Error(`Unexpected response type '${staleAcknowledgement.type}'.`);
    }
    expect(staleAcknowledgement.acknowledgedTickNumber).toBeNull();
    expect(runtime.getStatus().retainedFromTick).toBe(8);
  });
});
