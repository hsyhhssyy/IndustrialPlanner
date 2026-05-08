import { describe, expect, it } from "vitest";

import { buildSolveGraph } from "@/simulation/runtime/stage-2-build-solve-graph";
import { solveTransferGraph } from "@/simulation/runtime/stage-3-layered-reverse-solve";
import { createSimulationMutableRuntimeState } from "@/simulation/runtime/runtime-state";
import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationPort,
  CompiledSimulationSlot,
  CompiledSimulationSlotLink,
  CompiledSimulationTopology,
  CompiledSimulationTransferEdge,
} from "@/simulation/types";

describe("solveTransferGraph", () => {
  it("selects the upstream source slot in slot order instead of sorting item types", () => {
    const topology = createSourceSinkTopology({
      sourceSlots: [
        createSlot("source.slot.z", "source.out", "item_zinc_plate", 1),
        createSlot("source.slot.a", "source.out", "item_aluminum_plate", 1),
      ],
    });
    const state = createSimulationMutableRuntimeState(topology);

    buildSolveGraph(topology, state);
    solveTransferGraph(topology, state);

    expect(state.transient.transfers).toEqual([
      expect.objectContaining({
        edgeId: "edge.source-to-sink",
        sourceSlotId: "source.slot.z",
        targetSlotId: "sink.slot",
        itemType: "item_zinc_plate",
      }),
    ]);
    expect(state.persistent.slots["source.slot.z"]?.count).toBe(0);
    expect(state.persistent.slots["source.slot.a"]?.count).toBe(1);
    expect(state.persistent.slots["sink.slot"]).toMatchObject({
      itemType: "item_zinc_plate",
      count: 1,
    });
  });

  it("passes through strict logistics devices and continues searching upstream", () => {
    const topology = createStrictBeltPullTopology();
    const state = createSimulationMutableRuntimeState(topology);

    buildSolveGraph(topology, state);
    solveTransferGraph(topology, state);

    expect(state.transient.transfers).toEqual([
      expect.objectContaining({
        edgeId: "edge.source-to-belt",
        sourceSlotId: "source.slot",
        targetSlotId: "belt.input.slot",
        itemType: "item_zinc_plate",
      }),
    ]);
    expect(state.persistent.slots["source.slot"]?.count).toBe(0);
    expect(state.persistent.slots["belt.input.slot"]).toMatchObject({
      itemType: "item_zinc_plate",
      count: 1,
    });
    expect(state.persistent.slots["sink.slot"]?.count).toBe(0);
  });

  it("treats blocked downstream inputs as resolved for non-strict fan-out outputs", () => {
    const topology = createBlockedFanOutTopology();
    const state = createSimulationMutableRuntimeState(topology);

    buildSolveGraph(topology, state);
    solveTransferGraph(topology, state);

    expect(state.transient.nodes["blocked.in"]?.resolveState).toBe("blocked-resolved");
    expect(state.transient.transfers).toEqual([
      expect.objectContaining({
        edgeId: "edge.source-to-open",
        sourceSlotId: "source.slot",
        targetSlotId: "open.slot",
        itemType: "item_zinc_plate",
      }),
    ]);
    expect(state.persistent.slots["open.slot"]).toMatchObject({
      itemType: "item_zinc_plate",
      count: 1,
    });
    expect(state.persistent.slots["blocked.slot"]).toMatchObject({
      itemType: "item_aluminum_plate",
      count: 1,
    });
  });

  it("reopens blocked strict logistics inputs when output movement frees shared capacity", () => {
    const topology = createStrictBeltOutputDrainTopology();
    const state = createSimulationMutableRuntimeState(topology);

    buildSolveGraph(topology, state);
    solveTransferGraph(topology, state);

    expect(state.transient.nodes["belt.input"]?.resolveState).toBe("visited");
    expect(state.transient.transfers).toEqual([
      expect.objectContaining({
        edgeId: "edge.belt-to-sink",
        sourceSlotId: "belt.output.slot",
        targetSlotId: "sink.slot",
        itemType: "item_zinc_plate",
      }),
      expect.objectContaining({
        edgeId: "edge.source-to-belt",
        sourceSlotId: "source.slot",
        targetSlotId: "belt.input.slot",
        itemType: "item_zinc_plate",
      }),
    ]);
    expect(state.persistent.slots["source.slot"]?.count).toBe(0);
    expect(state.persistent.slots["sink.slot"]).toMatchObject({
      itemType: "item_zinc_plate",
      count: 1,
    });
    expect(state.persistent.slots["belt.input.slot"]).toMatchObject({
      itemType: "item_zinc_plate",
      count: 1,
    });
    expect(state.persistent.slots["belt.output.slot"]?.count).toBe(0);
  });
});

function createSourceSinkTopology(options: {
  readonly sourceSlots: readonly CompiledSimulationSlot[];
}): CompiledSimulationTopology {
  const devices: Record<string, CompiledSimulationDevice> = {
    source: createDevice({
      id: "source",
      definitionId: "source_device",
      nodeIds: ["source.out"],
      productNodeIds: ["source.out"],
      portIds: ["source.out.port"],
      transportClass: "anchor",
    }),
    sink: createDevice({
      id: "sink",
      definitionId: "sink_device",
      nodeIds: ["sink.in"],
      ingredientNodeIds: ["sink.in"],
      portIds: ["sink.in.port"],
      transportClass: "anchor",
    }),
  };
  const nodes: Record<string, CompiledSimulationNode> = {
    "source.out": createNode({
      id: "source.out",
      deviceId: "source",
      slotIds: options.sourceSlots.map((slot) => slot.id),
      outputPortIds: ["source.out.port"],
      viewRole: "output-view",
    }),
    "sink.in": createNode({
      id: "sink.in",
      deviceId: "sink",
      slotIds: ["sink.slot"],
      inputPortIds: ["sink.in.port"],
      viewRole: "input-view",
    }),
  };
  const slots = Object.fromEntries([
    ...options.sourceSlots.map((slot) => [slot.id, slot] as const),
    ["sink.slot", createSlot("sink.slot", "sink.in", null, 0)],
  ]);
  const ports: Record<string, CompiledSimulationPort> = {
    "source.out.port": createPort({
      id: "source.out.port",
      deviceId: "source",
      direction: "output",
      boundNodeIds: ["source.out"],
    }),
    "sink.in.port": createPort({
      id: "sink.in.port",
      deviceId: "sink",
      direction: "input",
      boundNodeIds: ["sink.in"],
    }),
  };
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {
    "edge.source-to-sink": createEdge({
      id: "edge.source-to-sink",
      sourcePortId: "source.out.port",
      targetPortId: "sink.in.port",
      sourceNodeId: "source.out",
      targetNodeId: "sink.in",
    }),
  };

  return createTopology({
    devices,
    nodes,
    slots,
    ports,
    transferEdges,
    ordering: {
      deviceOrder: ["source", "sink"],
      nodeOrder: ["source.out", "sink.in"],
      slotOrder: options.sourceSlots.map((slot) => slot.id).concat("sink.slot"),
      portOrder: ["source.out.port", "sink.in.port"],
      edgeOrder: ["edge.source-to-sink"],
    },
  });
}

function createStrictBeltPullTopology(): CompiledSimulationTopology {
  return createStrictBeltTopology({
    beltInputCount: 0,
    beltOutputCount: 0,
  });
}

function createStrictBeltOutputDrainTopology(): CompiledSimulationTopology {
  return createStrictBeltTopology({
    beltInputCount: 0,
    beltOutputCount: 1,
  });
}

function createStrictBeltTopology(options: {
  readonly beltInputCount: number;
  readonly beltOutputCount: number;
}): CompiledSimulationTopology {
  const devices: Record<string, CompiledSimulationDevice> = {
    source: createDevice({
      id: "source",
      definitionId: "source_device",
      nodeIds: ["source.out"],
      productNodeIds: ["source.out"],
      portIds: ["source.out.port"],
      transportClass: "anchor",
    }),
    belt: createDevice({
      id: "belt",
      definitionId: "belt_straight_1x1",
      nodeIds: ["belt.input", "belt.output"],
      ingredientNodeIds: ["belt.input"],
      productNodeIds: ["belt.output"],
      portIds: ["belt.in.port", "belt.out.port"],
      transportClass: "strict-belt",
    }),
    sink: createDevice({
      id: "sink",
      definitionId: "sink_device",
      nodeIds: ["sink.in"],
      ingredientNodeIds: ["sink.in"],
      portIds: ["sink.in.port"],
      transportClass: "anchor",
    }),
  };
  const nodes: Record<string, CompiledSimulationNode> = {
    "source.out": createNode({
      id: "source.out",
      deviceId: "source",
      slotIds: ["source.slot"],
      outputPortIds: ["source.out.port"],
      viewRole: "output-view",
    }),
    "belt.input": createNode({
      id: "belt.input",
      deviceId: "belt",
      slotIds: ["belt.input.slot"],
      inputPortIds: ["belt.in.port"],
      viewRole: "input-view",
    }),
    "belt.output": createNode({
      id: "belt.output",
      deviceId: "belt",
      slotIds: ["belt.output.slot"],
      outputPortIds: ["belt.out.port"],
      viewRole: "output-view",
    }),
    "sink.in": createNode({
      id: "sink.in",
      deviceId: "sink",
      slotIds: ["sink.slot"],
      inputPortIds: ["sink.in.port"],
      viewRole: "input-view",
    }),
  };
  const slots: Record<string, CompiledSimulationSlot> = {
    "source.slot": createSlot("source.slot", "source.out", "item_zinc_plate", 1),
    "belt.input.slot": createSlot(
      "belt.input.slot",
      "belt.input",
      options.beltInputCount > 0 ? "item_zinc_plate" : null,
      options.beltInputCount,
    ),
    "belt.output.slot": createSlot(
      "belt.output.slot",
      "belt.output",
      options.beltOutputCount > 0 ? "item_zinc_plate" : null,
      options.beltOutputCount,
    ),
    "sink.slot": createSlot("sink.slot", "sink.in", null, 0),
  };
  const ports: Record<string, CompiledSimulationPort> = {
    "source.out.port": createPort({
      id: "source.out.port",
      deviceId: "source",
      direction: "output",
      boundNodeIds: ["source.out"],
    }),
    "belt.in.port": createPort({
      id: "belt.in.port",
      deviceId: "belt",
      direction: "input",
      boundNodeIds: ["belt.input"],
    }),
    "belt.out.port": createPort({
      id: "belt.out.port",
      deviceId: "belt",
      direction: "output",
      boundNodeIds: ["belt.output"],
    }),
    "sink.in.port": createPort({
      id: "sink.in.port",
      deviceId: "sink",
      direction: "input",
      boundNodeIds: ["sink.in"],
    }),
  };
  const links: Record<string, CompiledSimulationSlotLink> = {
    "link.belt.share-cap": {
      id: "link.belt.share-cap",
      linkType: "share-cap",
      sourceSlotIds: ["belt.input.slot"],
      targetSlotIds: ["belt.output.slot"],
      targetSlotIdBySourceSlotId: {
        "belt.input.slot": "belt.output.slot",
      },
    },
  };
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {
    "edge.source-to-belt": createEdge({
      id: "edge.source-to-belt",
      sourcePortId: "source.out.port",
      targetPortId: "belt.in.port",
      sourceNodeId: "source.out",
      targetNodeId: "belt.input",
    }),
    "edge.belt-to-sink": createEdge({
      id: "edge.belt-to-sink",
      sourcePortId: "belt.out.port",
      targetPortId: "sink.in.port",
      sourceNodeId: "belt.output",
      targetNodeId: "sink.in",
    }),
  };

  return createTopology({
    devices,
    nodes,
    slots,
    ports,
    links,
    transferEdges,
    ordering: {
      deviceOrder: ["source", "belt", "sink"],
      nodeOrder: ["source.out", "belt.input", "belt.output", "sink.in"],
      slotOrder: ["source.slot", "belt.input.slot", "belt.output.slot", "sink.slot"],
      portOrder: ["source.out.port", "belt.in.port", "belt.out.port", "sink.in.port"],
      edgeOrder: ["source-to-belt", "belt-to-sink"].map((id) => `edge.${id}`),
    },
  });
}

function createBlockedFanOutTopology(): CompiledSimulationTopology {
  const devices: Record<string, CompiledSimulationDevice> = {
    source: createDevice({
      id: "source",
      definitionId: "source_device",
      nodeIds: ["source.out"],
      productNodeIds: ["source.out"],
      portIds: ["source.out.port"],
      transportClass: "anchor",
    }),
    open: createDevice({
      id: "open",
      definitionId: "open_sink",
      nodeIds: ["open.in"],
      ingredientNodeIds: ["open.in"],
      portIds: ["open.in.port"],
      transportClass: "anchor",
    }),
    blocked: createDevice({
      id: "blocked",
      definitionId: "blocked_sink",
      nodeIds: ["blocked.in"],
      ingredientNodeIds: ["blocked.in"],
      portIds: ["blocked.in.port"],
      transportClass: "anchor",
    }),
  };
  const nodes: Record<string, CompiledSimulationNode> = {
    "source.out": createNode({
      id: "source.out",
      deviceId: "source",
      slotIds: ["source.slot"],
      outputPortIds: ["source.out.port"],
      viewRole: "output-view",
    }),
    "open.in": createNode({
      id: "open.in",
      deviceId: "open",
      slotIds: ["open.slot"],
      inputPortIds: ["open.in.port"],
      viewRole: "input-view",
    }),
    "blocked.in": createNode({
      id: "blocked.in",
      deviceId: "blocked",
      slotIds: ["blocked.slot"],
      inputPortIds: ["blocked.in.port"],
      viewRole: "input-view",
    }),
  };
  const slots: Record<string, CompiledSimulationSlot> = {
    "source.slot": createSlot("source.slot", "source.out", "item_zinc_plate", 1),
    "open.slot": createSlot("open.slot", "open.in", null, 0),
    "blocked.slot": createSlot("blocked.slot", "blocked.in", "item_aluminum_plate", 1),
  };
  const ports: Record<string, CompiledSimulationPort> = {
    "source.out.port": createPort({
      id: "source.out.port",
      deviceId: "source",
      direction: "output",
      boundNodeIds: ["source.out"],
    }),
    "open.in.port": createPort({
      id: "open.in.port",
      deviceId: "open",
      direction: "input",
      boundNodeIds: ["open.in"],
    }),
    "blocked.in.port": createPort({
      id: "blocked.in.port",
      deviceId: "blocked",
      direction: "input",
      boundNodeIds: ["blocked.in"],
    }),
  };
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {
    "edge.source-to-open": createEdge({
      id: "edge.source-to-open",
      sourcePortId: "source.out.port",
      targetPortId: "open.in.port",
      sourceNodeId: "source.out",
      targetNodeId: "open.in",
    }),
    "edge.source-to-blocked": createEdge({
      id: "edge.source-to-blocked",
      sourcePortId: "source.out.port",
      targetPortId: "blocked.in.port",
      sourceNodeId: "source.out",
      targetNodeId: "blocked.in",
    }),
  };

  return createTopology({
    devices,
    nodes,
    slots,
    ports,
    transferEdges,
    ordering: {
      deviceOrder: ["source", "open", "blocked"],
      nodeOrder: ["source.out", "open.in", "blocked.in"],
      slotOrder: ["source.slot", "open.slot", "blocked.slot"],
      portOrder: ["source.out.port", "open.in.port", "blocked.in.port"],
      edgeOrder: ["edge.source-to-open", "edge.source-to-blocked"],
    },
  });
}

function createTopology(options: {
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly nodes: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links?: Record<string, CompiledSimulationSlotLink>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly nodeOrder: readonly string[];
    readonly slotOrder: readonly string[];
    readonly portOrder: readonly string[];
    readonly edgeOrder: readonly string[];
  };
}): CompiledSimulationTopology {
  return {
    schemaVersion: 3,
    topologyId: "test-topology",
    documentKey: "test-document",
    documentHash: "test-document-hash",
    registryHash: "test-registry-hash",
    standardTickRate: 20,
    itemCatalog: {
      item_aluminum_plate: { id: "item_aluminum_plate", domain: "solid", tags: [] },
      item_zinc_plate: { id: "item_zinc_plate", domain: "solid", tags: [] },
    },
    recipeCatalog: {},
    devices: options.devices,
    nodes: options.nodes,
    slots: options.slots,
    ports: options.ports,
    links: options.links ?? {},
    physicalConnections: {},
    transferEdges: options.transferEdges,
    ordering: {
      deviceOrder: options.ordering.deviceOrder,
      nodeOrder: options.ordering.nodeOrder,
      slotOrder: options.ordering.slotOrder,
      portOrder: options.ordering.portOrder,
      physicalConnectionOrder: [],
      edgeOrder: options.ordering.edgeOrder,
    },
    transportComponents: {},
    diagnostics: [],
  };
}

function createDevice(options: {
  readonly id: string;
  readonly definitionId: string;
  readonly nodeIds: readonly string[];
  readonly ingredientNodeIds?: readonly string[];
  readonly productNodeIds?: readonly string[];
  readonly portIds: readonly string[];
  readonly transportClass: CompiledSimulationDevice["transportClass"];
}): CompiledSimulationDevice {
  return {
    id: options.id,
    sourceEntityId: options.id,
    definitionId: options.definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    tags: [],
    transportClass: options.transportClass,
    transportComponentId: null,
    nodeIds: options.nodeIds,
    ingredientNodeIds: options.ingredientNodeIds ?? [],
    productNodeIds: options.productNodeIds ?? [],
    portIds: options.portIds,
    routing: Object.fromEntries(options.portIds.map((portId) => [
      portId,
      { priorityGroup: 0, roundRobinSeed: 0 },
    ])),
    configHash: `${options.id}-config`,
  };
}

function createNode(options: {
  readonly id: string;
  readonly deviceId: string;
  readonly slotIds: readonly string[];
  readonly inputPortIds?: readonly string[];
  readonly outputPortIds?: readonly string[];
  readonly viewRole: CompiledSimulationNode["viewRole"];
}): CompiledSimulationNode {
  return {
    id: options.id,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.id,
    slotType: options.viewRole === "input-view" ? "ingredient" : "product",
    viewRole: options.viewRole,
    slotIds: options.slotIds,
    inputPortIds: options.inputPortIds ?? [],
    outputPortIds: options.outputPortIds ?? [],
    groupOrder: 0,
  };
}

function createSlot(
  id: string,
  nodeId: string,
  itemType: string | null,
  count: number,
): CompiledSimulationSlot {
  return {
    id,
    nodeId,
    sourceStorageSlotGroupId: nodeId,
    sourceSlotId: id,
    capacity: 1,
    domain: "solid",
    lock: null,
    initialItemType: itemType,
    initialCount: count,
    ignoreStock: false,
    submitMode: "never",
    submitIntervalTicks: null,
  };
}

function createPort(options: {
  readonly id: string;
  readonly deviceId: string;
  readonly direction: CompiledSimulationPort["direction"];
  readonly boundNodeIds: readonly string[];
}): CompiledSimulationPort {
  return {
    id: options.id,
    deviceId: options.deviceId,
    portGroupId: `${options.direction}-ports`,
    portDefinitionId: options.id,
    kind: "item",
    direction: options.direction,
    insideGridPoint: { x: 0, y: 0 },
    outsideGridPoint: { x: 0, y: 0 },
    edge: "EAST",
    boundNodeIds: options.boundNodeIds,
    acceptRule: { base: { kind: "solid" }, exclude: [] },
    count: 1,
    priorityGroup: 0,
    roundRobinSeed: 0,
    order: 0,
  };
}

function createEdge(options: {
  readonly id: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}): CompiledSimulationTransferEdge {
  return {
    id: options.id,
    physicalConnectionId: `${options.id}.connection`,
    sourcePortId: options.sourcePortId,
    targetPortId: options.targetPortId,
    sourceNodeId: options.sourceNodeId,
    targetNodeId: options.targetNodeId,
    acceptRule: { base: { kind: "solid" }, exclude: [] },
    count: 1,
  };
}
