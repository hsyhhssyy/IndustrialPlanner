import { loadBlueprintFromFile, loadBlueprintVariantFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";

describe("port priority groups", () => {
  it("compiles direct port adjacency and device-order indexes for runtime solving", () => {
    const registry = createRegistryContract();
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/simulation/port-priority-groups/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // {
    //         source: createEntity("source", "storager_1", 0, 0, 180),
    //         belt: createEntity("belt", "belt_straight_1x1", 0, -1, 270),
    //         sink: createEntity("sink", "storager_1", 0, -4, 180),
    //       }
    const document: WorldDocument = {
      ...createWorldDocument(),
      entities: loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/simulation/port-priority-groups/scene-01-variant-1.schema6.json").entities,
      entityOrder: ["source", "belt", "sink"],
    };
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "single-base",
      poweredEntityIds: new Set(document.entityOrder),
    });

    expect(topology.ordering.edgeOrder.length).toBeGreaterThan(0);
    for (const edgeId of topology.ordering.edgeOrder) {
      const edge = topology.transferEdges[edgeId]!;
      expect(topology.edgeIdsByOutputPortId?.[edge.sourcePortId]).toContain(edgeId);
      expect(topology.edgeIdsByInputPortId?.[edge.targetPortId]).toContain(edgeId);
    }
    expect(topology.deviceOrderIndexById).toEqual(
      Object.fromEntries(topology.ordering.deviceOrder.map((deviceId, index) => [deviceId, index])),
    );
  });

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

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/port-priority-groups/index.json
// AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections/simulation/port-priority-groups/index.json。
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// function createEntity(
//   id: string,
//   definitionId: string,
//   x: number,
//   y: number,
//   rotation: WorldEntity["rotation"],
// ): WorldEntity {
//   return {
//     id,
//     definitionId,
//     position: { x, y },
//     rotation,
//     config: {},
//     tags: [],
//   };
// }

function compileSplitterTopology(config: WorldEntity["config"]) {
  const registry = createRegistryContract();
  // AI-REMOVED 2026-09-14:
  // Reason: 场景构造已批量固化为带版本的蓝图文件。
  // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
  // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
  // Replacement: src/tests/fixtures/blueprints/collections/simulation/port-priority-groups/index.json
  // Risk: Low；断言与被测动作不变。
  // Human Review: Required
  // Original code:
  // {
  //       splitter: {
  //         id: "splitter",
  //         definitionId: "log_splitter",
  //         position: { x: 0, y: 0 },
  //         rotation: 0,
  //         config,
  //         tags: [],
  //       },
  //     }
  const document: WorldDocument = {
    ...createWorldDocument(),
    entities: loadBlueprintVariantFromFile("src/tests/fixtures/blueprints/collections/simulation/port-priority-groups/index.json", "scene-02", { config }).entities,
    entityOrder: ["splitter"],
  };

  return compileSimulationTopology({
    document,
    registry,
    simulationMode: "single-base",
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
