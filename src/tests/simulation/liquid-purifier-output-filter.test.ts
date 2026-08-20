import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlotWithItem,
} from "./blueprint-test-helpers";

type LiquidPurifierRecipeCase = {
  readonly name: string;
  readonly recipeId: string;
  readonly inputItemId: string;
  readonly leftOutputItemId: string;
  readonly rightOutputItemId: string;
};

const LIQUID_PURIFIER_ENTITY_ID = "liquid_purifier_1";
const FINAL_TICK = 8 * STANDARD_TICK_RATE_PER_SECOND;

const RECIPE_CASES: readonly LiquidPurifierRecipeCase[] = [
  {
    name: "惰性壤晶废液提纯",
    recipeId: "r_liquid_purifier_water_and_xiranite_poly_from_xiranite_lowpoly_basic",
    inputItemId: "item_liquid_xiranite_lowpoly",
    leftOutputItemId: "item_liquid_water",
    rightOutputItemId: "item_liquid_xiranite_poly",
  },
  {
    name: "赤铜溶液提纯",
    recipeId: "r_liquid_purifier_acid_and_copper_enr_from_copper_basic",
    inputItemId: "item_liquid_copper",
    leftOutputItemId: "item_liquid_acid",
    rightOutputItemId: "item_liquid_copper_enr",
  },
];

describe("提纯机输出端口物品级过滤", () => {
  // TODO: demo 配方引入后 RECIPE_CASES 未同步更新，临时 skip，正式更新时恢复
  // AI-CORRECTION 2026-07-16: 按要求恢复执行，用于暴露 RECIPE_CASES 与 registry 的差异。
  it("覆盖 registry 中当前全部提纯机配方", () => {
    const registry = createRegistryContract();

    expect(registry.recipeDefinitions
      .filter((recipe) => recipe.machineId === LIQUID_PURIFIER_ENTITY_ID)
      .map((recipe) => recipe.id)
      .sort()).toEqual(RECIPE_CASES.map((recipeCase) => recipeCase.recipeId).sort());
  });

  it.each(RECIPE_CASES)("$name 的两个输出端口只输出各自允许的液体", async (recipeCase) => {
    const registry = createRegistryContract();
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(`liquid-purifier-output-filter-${recipeCase.inputItemId}`, [
        ...createSingleConnectedPortEntities({
          idPrefix: "left-only",
          purifierX: 0,
          purifierY: 8,
          connectedPortLocalX: 1,
          inputItemId: recipeCase.inputItemId,
        }),
        ...createSingleConnectedPortEntities({
          idPrefix: "right-only",
          purifierX: 20,
          purifierY: 8,
          connectedPortLocalX: 3,
          inputItemId: recipeCase.inputItemId,
        }),
      ]),
      maxTickNumber: FINAL_TICK,
      registry,
    });
    const leftTransferredItems = collectTransferredItemsFromDevice(report, "left-only-purifier");
    const rightTransferredItems = collectTransferredItemsFromDevice(report, "right-only-purifier");

    expect(report.topology.diagnostics).toEqual([]);
    expect(leftTransferredItems).toContain(recipeCase.leftOutputItemId);
    expect(leftTransferredItems).not.toContain(recipeCase.rightOutputItemId);
    expect(findSlotWithItem(report, FINAL_TICK, "left-only-purifier", recipeCase.rightOutputItemId))
      .toMatchObject({ count: 1 });

    expect(rightTransferredItems).toContain(recipeCase.rightOutputItemId);
    expect(rightTransferredItems).not.toContain(recipeCase.leftOutputItemId);
    expect(findSlotWithItem(report, FINAL_TICK, "right-only-purifier", recipeCase.leftOutputItemId))
      .toMatchObject({ count: 1 });
  });
});

function createSingleConnectedPortEntities(options: {
  readonly idPrefix: string;
  readonly purifierX: number;
  readonly purifierY: number;
  readonly connectedPortLocalX: 1 | 3;
  readonly inputItemId: string;
}) {
  const portWorldX = options.purifierX + options.connectedPortLocalX;
  const portWorldY = options.purifierY;
  return [
    createEntity(
      `${options.idPrefix}-purifier`,
      LIQUID_PURIFIER_ENTITY_ID,
      options.purifierX,
      options.purifierY,
      90,
      {
        "storageSlotGroups[0].slots[0].initialItemType": options.inputItemId,
        "storageSlotGroups[0].slots[0].initialCount": 4,
      },
    ),
    createEntity(`${options.idPrefix}-power`, "power_diffuser_1", options.purifierX + 6, options.purifierY),
    createEntity(`${options.idPrefix}-pipe`, "pipe_straight_1x1", portWorldX, portWorldY - 1, 270),
    createEntity(`${options.idPrefix}-sink`, "udpipe_loader_1", portWorldX - 1, portWorldY - 4, 90),
  ];
}

function collectTransferredItemsFromDevice(
  report: Awaited<ReturnType<typeof runBlueprintSimulation>>,
  deviceId: string,
): string[] {
  return report.ticks.flatMap((tick) =>
    tick.transfers
      .filter((transfer) => transfer.sourceSlotId.includes(`device:${deviceId}/`))
      .map((transfer) => transfer.itemType),
  );
}
