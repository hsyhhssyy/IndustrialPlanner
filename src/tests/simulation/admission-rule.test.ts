import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
} from "./blueprint-test-helpers";

describe("admission rule runtime counter", () => {
  it("limits admission by a persistent cross-tick counter", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 2,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 220,
    });

    const sourceToAdmissionTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:source")
          && transfer.targetSlotId.includes("device:admission"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber)).toEqual([1, 41]);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 2,
        count: 2,
        perMinuteLimit: null,
        perMinuteCount: 2,
      });
  });

  it("resets per-minute admission count at simulation minute boundaries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 2,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 1300,
    });

    const sourceToAdmissionTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:source")
          && transfer.targetSlotId.includes("device:admission"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber)).toEqual([1, 41, 1201, 1241]);
    expect(report.ticks[1200]?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 2,
        perMinuteCount: 2,
      });
    expect(report.ticks[1201]?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 3,
        perMinuteLimit: 2,
        perMinuteCount: 1,
      });
  });

  it("applies total and per-minute limits independently", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 3,
        perMinuteLimit: 2,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 1300,
    });

    const sourceToAdmissionTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:source")
          && transfer.targetSlotId.includes("device:admission"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    expect(sourceToAdmissionTransfers.map((entry) => entry.tickNumber)).toEqual([1, 41, 1201]);
    expect(report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: 3,
        count: 3,
        perMinuteLimit: 2,
        perMinuteCount: 1,
      });
  });

  it("does not admit a different item", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_copper_ore",
        admissionItemId: "item_iron_ore",
        limit: 5,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 80,
    });

    expect(report.ticks.some((tick) =>
      tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:source")
        && transfer.targetSlotId.includes("device:admission"),
      ),
    )).toBe(false);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 5,
        count: 0,
        perMinuteLimit: null,
        perMinuteCount: 0,
      });
  });
});

function createAdmissionBlueprint(options: {
  readonly sourceItemId: string;
  readonly admissionItemId: string;
  readonly limit: number | null;
  readonly perMinuteLimit?: number | null;
}) {
  return createBlueprint("admission-rule", [
    createEntity("source", "item_port_storager_1", 0, 0, 90, {
      "storageSlotGroups[0].slots[0].initialItemType": options.sourceItemId,
      "storageSlotGroups[0].slots[0].initialCount": 5,
      "storageSlotGroups[0].slots[0].ignoreStock": true,
    }),
    createEntity("admission", "item_log_admission", 3, 1, 0, {
      "portGroups[0].ports[0].acceptRule": {
        base: { kind: "item", itemId: options.admissionItemId },
        exclude: [],
      },
      "portGroups[0].ports[0].admissionRule": {
        itemId: options.admissionItemId,
        limit: options.limit,
        perMinuteLimit: options.perMinuteLimit ?? null,
      },
    }),
    createEntity("belt", "belt_straight_1x1", 4, 1, 0),
    createEntity("sink", "item_port_loader_1", 5, 0, 270),
  ]);
}
