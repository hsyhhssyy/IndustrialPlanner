import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

describe("port priority groups", () => {
  it("uses default priority group 5 for registry ports", () => {
    const topology = compileSplitterTopology({});
    const priorities = resolveSplitterPortPriorities(topology);

    expect(priorities).toMatchObject({
      in_n: 5,
      out_e: 5,
      out_w: 5,
      out_s: 5,
    });
  });

  it("applies custom per-port priority groups only when custom switch is enabled", () => {
    const topology = compileSplitterTopology({
      customPortPriorityGroups: true,
      portPriorityGroups: {
        "item_output:out_w": 1,
        "item_output:out_s": 9,
      },
    });
    const priorities = resolveSplitterPortPriorities(topology);

    expect(priorities).toMatchObject({
      in_n: 5,
      out_e: 5,
      out_w: 1,
      out_s: 9,
    });
    expect(topology.devices["device:splitter"]?.routing["item_output.out_w"]?.priorityGroup).toBe(1);
    expect(topology.devices["device:splitter"]?.routing["item_output.out_s"]?.priorityGroup).toBe(9);
  });

  it("ignores custom override records when custom switch is disabled", () => {
    const topology = compileSplitterTopology({
      customPortPriorityGroups: false,
      portPriorityGroups: {
        "item_output:out_w": 1,
      },
    });
    const priorities = resolveSplitterPortPriorities(topology);

    expect(priorities.out_w).toBe(5);
  });

  it("normalizes legacy priority group 0 to default 5", () => {
    const topology = compileSplitterTopology({
      "portGroups[1].ports[0].priorityGroup": 0,
    });
    const priorities = resolveSplitterPortPriorities(topology);

    expect(priorities.out_e).toBe(5);
  });
});

function compileSplitterTopology(config: WorldEntity["config"]) {
  const registry = createRegistryContract();
  const document: WorldDocument = {
    ...createWorldDocument(),
    entities: {
      splitter: {
        id: "splitter",
        definitionId: "item_log_splitter",
        position: { x: 0, y: 0 },
        rotation: 0,
        config,
        tags: [],
      },
    },
    entityOrder: ["splitter"],
  };

  return compileSimulationTopology({
    document,
    registry,
    poweredEntityIds: new Set(["splitter"]),
  });
}

function resolveSplitterPortPriorities(
  topology: ReturnType<typeof compileSimulationTopology>,
): Record<string, number> {
  return Object.fromEntries(
    Object.values(topology.ports)
      .filter((port) => port.deviceId === "device:splitter")
      .map((port) => [port.portDefinitionId, port.priorityGroup]),
  );
}
