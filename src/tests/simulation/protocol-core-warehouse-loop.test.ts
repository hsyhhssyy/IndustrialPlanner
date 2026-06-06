import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import type { RuntimeTransferSnapshot } from "@/simulation/types";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

const CORE_ID = "core";

const PROTOCOL_CORE_OUTPUTS = [
  {
    storageGroupId: "unbuffer_w2",
    storageGroupIndex: 0,
    receiverId: "recv_w2",
    receiverX: -1,
    receiverY: 1,
    receiverRotation: 180,
    itemId: "item_copper_ore",
  },
  {
    storageGroupId: "unbuffer_w5",
    storageGroupIndex: 1,
    receiverId: "recv_w5",
    receiverX: -1,
    receiverY: 4,
    receiverRotation: 180,
    itemId: "item_iron_ore",
  },
  {
    storageGroupId: "unbuffer_w8",
    storageGroupIndex: 2,
    receiverId: "recv_w8",
    receiverX: -1,
    receiverY: 7,
    receiverRotation: 180,
    itemId: "item_originium_ore",
  },
  {
    storageGroupId: "unbuffer_e2",
    storageGroupIndex: 3,
    receiverId: "recv_e2",
    receiverX: 9,
    receiverY: 1,
    receiverRotation: 0,
    itemId: "item_plant_moss_3",
  },
  {
    storageGroupId: "unbuffer_e5",
    storageGroupIndex: 4,
    receiverId: "recv_e5",
    receiverX: 9,
    receiverY: 4,
    receiverRotation: 0,
    itemId: "item_crystal_powder",
  },
  {
    storageGroupId: "unbuffer_e8",
    storageGroupIndex: 5,
    receiverId: "recv_e8",
    receiverX: 9,
    receiverY: 7,
    receiverRotation: 0,
    itemId: "item_proc_battery_4",
  },
] as const;

type ProtocolCoreWarehouseOutputConfig = {
  readonly linkIndex: number;
  readonly storageGroupId: string;
  readonly storageGroupIndex: number;
  readonly itemId: string;
};

describe("protocol core warehouse links", () => {
  it("ships independently from every configured output", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("protocol-core-all-outputs", [
        createEntity(
          CORE_ID,
          "item_port_sp_hub_1",
          0,
          0,
          0,
          createProtocolCoreWarehouseLinkConfig(CORE_ID, PROTOCOL_CORE_OUTPUTS.map((output, linkIndex) => ({
            ...output,
            linkIndex,
          }))),
        ),
        ...PROTOCOL_CORE_OUTPUTS.map((output) =>
          createEntity(
            output.receiverId,
            "belt_straight_1x1",
            output.receiverX,
            output.receiverY,
            output.receiverRotation,
          ),
        ),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 20,
    });

    const tick20 = getTick(report, 20);
    for (const output of PROTOCOL_CORE_OUTPUTS) {
      expect(tick20.transfers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          itemType: output.itemId,
          amount: 1,
          sourceSlotId: expect.stringContaining(`device:${CORE_ID}/node:${output.storageGroupId}/slot:slot_1`),
          targetSlotId: expect.stringContaining(`device:${output.receiverId}`),
        }),
      ]));
    }
  });

  it("submits looped input cargo so the output keeps flowing", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("protocol-core-e8-loop-to-s8", [
        createEntity(
          CORE_ID,
          "item_port_sp_hub_1",
          0,
          0,
          0,
          createProtocolCoreWarehouseLinkConfig(CORE_ID, [{
            linkIndex: 5,
            storageGroupId: "unbuffer_e8",
            storageGroupIndex: 5,
            itemId: "item_copper_ore",
          }]),
        ),
        createEntity("loop_0", "belt_turn_cw_1x1", 9, 7, 180),
        createEntity("loop_1", "belt_straight_1x1", 9, 8, 90),
        createEntity("loop_2", "belt_turn_cw_1x1", 9, 9, 270),
        createEntity("loop_3", "belt_straight_1x1", 8, 9, 180),
        createEntity("loop_4", "belt_turn_cw_1x1", 7, 9, 0),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 320,
    });

    const warehouseTransfers = allTransfers(report).filter((transfer) =>
      transfer.itemType === "item_copper_ore"
      && transfer.targetSlotId.includes("/node:warehouse/slot:item_copper_ore"),
    );
    expect(warehouseTransfers.length).toBeGreaterThan(1);

    const finalInputSlot = findSlot(report, 320, CORE_ID, "inbuffer_s8", "slot_1");
    expect(finalInputSlot).toMatchObject({
      itemType: null,
      count: 0,
    });
  });

  it("sinks ordinary warehouse loader input directly into the warehouse", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("warehouse-loader-sink", [
        createEntity("unloader", "item_port_unloader_1", 51, 34, 270, {
          "links[0].id": "",
          "links[0].linkType": "share-all",
          "links[0].source.entityId": "unloader",
          "links[0].source.storageSlotGroupId": "unloader_buffer",
          "links[0].source.slotId": "slot_1",
          "links[0].target.entityId": "warehouse",
          "links[0].target.storageSlotGroupId": "warehouse",
          "links[0].target.slotId": "item_plant_moss_3",
          "storageSlotGroups[0].slots[0].ignoreStock": true,
        }),
        createEntity("belt_0", "belt_straight_1x1", 52, 35, 0),
        // AI-CORRECTION 2026-06-06: 仓库存货口旋转 180°（已撤销），rot 恢复为 270。
        createEntity("loader", "item_port_loader_1", 53, 34, 270),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 80,
    });

    const warehouseTransfers = allTransfers(report).filter((transfer) =>
      transfer.itemType === "item_plant_moss_3"
      && transfer.targetSlotId.includes("/node:warehouse/slot:item_plant_moss_3"),
    );
    expect(warehouseTransfers.length).toBeGreaterThan(0);

    const loaderSlots = getDevice(report, 80, "loader").slotItems;
    expect(loaderSlots.every((slot) => slot.itemType === null && slot.count === 0)).toBe(true);
  });
});

function createProtocolCoreWarehouseLinkConfig(
  entityId: string,
  outputs: readonly ProtocolCoreWarehouseOutputConfig[],
): WorldEntity["config"] {
  const entries: [string, unknown][] = [];

  for (const output of outputs) {
    entries.push(
      [`links[${output.linkIndex}].id`, ""],
      [`links[${output.linkIndex}].linkType`, "share-all"],
      [`links[${output.linkIndex}].source.entityId`, entityId],
      [`links[${output.linkIndex}].source.storageSlotGroupId`, output.storageGroupId],
      [`links[${output.linkIndex}].source.slotId`, "slot_1"],
      [`links[${output.linkIndex}].target.entityId`, "warehouse"],
      [`links[${output.linkIndex}].target.storageSlotGroupId`, "warehouse"],
      [`links[${output.linkIndex}].target.slotId`, output.itemId],
      [`storageSlotGroups[${output.storageGroupIndex}].slots[0].ignoreStock`, true],
    );
  }

  return Object.fromEntries(entries);
}

function allTransfers(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
): RuntimeTransferSnapshot[] {
  return report.ticks.flatMap((tick) => [...tick.transfers]);
}
