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
      maxTickNumber: 100,
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
    const admissionOutputTicks = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map(() => tick.tickNumber),
    );
    expect(admissionOutputTicks).toEqual([41, 81]);
    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    expect(admissionCounter)
      .toMatchObject({
        itemType: "item_iron_ore",
        limit: 2,
        count: 2,
        perMinuteLimit: null,
        rateWindowCount: 2,
        oneMinuteCount: 2,
      });
  });

  it("resets rate admission count at aligned ten-second boundaries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 260,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber)).toEqual([41, 81, 241]);
    expect(report.ticks[200]?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 2,
      });
    expect(report.ticks[201]?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: null,
        count: 2,
        perMinuteLimit: 12,
        rateWindowCount: 0,
      });
    expect(report.ticks[201]?.devices.admission?.channelRecipes.default?.recipeId)
      .toBe("log_admission:dynamic-belt-transfer");
  });

  it("applies total and ten-second rate limits independently", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: 3,
        perMinuteLimit: 12,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 260,
    });

    const admissionToBeltTransfers = report.ticks.flatMap((tick) =>
      tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:admission")
          && transfer.targetSlotId.includes("device:belt"),
        )
        .map((transfer) => ({ tickNumber: tick.tickNumber, transfer })),
    );

    expect(admissionToBeltTransfers.map((entry) => entry.tickNumber)).toEqual([41, 81, 241]);
    expect(report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"])
      .toMatchObject({
        limit: 3,
        count: 3,
        perMinuteLimit: 12,
        rateWindowCount: 1,
      });
  });

  it("oneMinuteCount spans exactly 6 ten-second windows, not 7", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createAdmissionBlueprint({
        sourceItemId: "item_iron_ore",
        admissionItemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 6,
      }),
      registry: createRegistryContract(),
      maxTickNumber: 2400,
    });

    const admissionCounter = report.ticks.at(-1)?.devices.admission?.admissionCounters?.["item_input:in_w"];
    expect(admissionCounter).toBeDefined();
    // 6/min = 每窗 1 个，过去一分钟 = 6 窗，预期 = 6。
    // Bug: pastWindowCounts 最多存 6 个已完成窗口 + 当前窗口 = 7 窗 → 7 件。
    expect(admissionCounter!.oneMinuteCount).toBe(6);
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
        rateWindowCount: 0,
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
    createEntity("source", "storager_1", 0, 0, 90, {
      "storageSlotGroups[0].slots[0].initialItemType": options.sourceItemId,
      "storageSlotGroups[0].slots[0].initialCount": 5,
      "storageSlotGroups[0].slots[0].ignoreStock": true,
    }),
    createEntity("admission", "log_admission", 3, 1, 0, {
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
    createEntity("sink", "loader_1", 5, 0, 270),
  ]);
}
