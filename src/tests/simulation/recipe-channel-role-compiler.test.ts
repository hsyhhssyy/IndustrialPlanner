import { describe, expect, it } from "vitest";

import type { WorldDocument } from "@/domain/document/world-document";
import { createWorldDocument } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

function createTestEntityDefinition(options: {
  id: string;
  portDirection: "input" | "output" | "bidirectional";
  splitLinkType?: EntityDefinition["storageSlotGroups"][number]["splitLinkType"];
}): EntityDefinition {
  return {
    id: options.id,
    nameKey: `${options.id}.name`,
    spriteId: options.id,
    iconPath: `device-icons/${options.id}.webp`,
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: 10000,
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [
      {
        id: "item_port",
        kind: ItemDomainFlag.Solid,
        isPipe: false,
        direction: options.portDirection,
        ports: [
          {
            id: "port_1",
            localCellX: 0,
            localCellY: 0,
            edge: "NORTH",
            acceptRule: { base: { kind: "domain", flags: ItemDomainFlag.Solid }, exclude: [] },
            // AI-REMOVED 2026-06-12:
            // Reason: PortDefinition.count per-tick 限流字段已删除。
            // Trigger: 用户确认文档没有 per tick count。
            // Evidence: 编译器不再读取 port.count。
            // Replacement: None - 该 fixture 只测试 recipe channel role 编译。
            // Risk: Low
            // Human Review: Required
            //
            // Original code:
            // count: "unlimited",
            priorityGroup: 5,
            roundRobinSeed: 0,
          },
        ],
      },
    ],
    storageSlotGroups: [
      {
        id: "buffer",
        kind: ItemDomainFlag.Solid,
        splitLinkType: options.splitLinkType,
        slots: [
          {
            id: "slot_1",
            capacity: 10,
            itemFilter: "type",
            itemFilterType: ItemDomainFlag.Solid,
            lock: null,
            initialItemType: null,
            initialCount: 0,
            ignoreStock: false,
          },
        ],
      },
    ],
    recipeChannels: [
      {
        id: "default",
        ingredientStorageGroupIds: ["buffer"],
        productStorageGroupIds: ["buffer"],
      },
    ],
    portStorageBindings: [
      {
        id: "bind_item_port",
        portGroupId: "item_port",
        storageSlotGroupId: "buffer",
      },
    ],
  };
}

function compileTestEntity(definition: EntityDefinition) {
  const registry = createRegistryContract();
  registry.entityDefinitions = [...registry.entityDefinitions, definition];

  const document: WorldDocument = {
    ...createWorldDocument(),
    entities: {
      machine: {
        id: "machine",
        definitionId: definition.id,
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: ["machine"],
  };

  const topology = compileSimulationTopology({
    document,
    registry,
    simulationMode: "single-base",
    poweredEntityIds: new Set(["machine"]),
  });

  const device = topology.devices["device:machine"];
  const channel = device?.recipeChannels.find((candidate) => candidate.id === "default");
  if (device === undefined || channel === undefined) {
    throw new Error("Missing compiled test device/channel");
  }

  return channel;
}

describe("topology compiler recipe channel roles", () => {
  it("uses Recipe Channel product role even when a storage group only has input ports", () => {
    const channel = compileTestEntity(createTestEntityDefinition({
      id: "test_channel_role_input_only",
      portDirection: "input",
    }));

    expect(channel.ingredientNodeIds).toEqual(["device:machine/node:buffer"]);
    expect(channel.productNodeIds).toEqual(["device:machine/node:buffer"]);
  });

  it("uses Recipe Channel ingredient role even when a storage group only has output ports", () => {
    const channel = compileTestEntity(createTestEntityDefinition({
      id: "test_channel_role_output_only",
      portDirection: "output",
    }));

    expect(channel.ingredientNodeIds).toEqual(["device:machine/node:buffer"]);
    expect(channel.productNodeIds).toEqual(["device:machine/node:buffer"]);
  });

  it("maps split storage groups to input-view ingredients and output-view products", () => {
    const channel = compileTestEntity(createTestEntityDefinition({
      id: "test_channel_role_bidirectional",
      portDirection: "bidirectional",
      splitLinkType: "share-cap",
    }));

    expect(channel.ingredientNodeIds).toEqual(["device:machine/node:buffer.input-view"]);
    expect(channel.productNodeIds).toEqual(["device:machine/node:buffer.output-view"]);
  });
});
