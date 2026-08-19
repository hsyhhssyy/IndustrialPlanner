import { describe, expect, it } from "vitest";

import {
  createDefaultRegionalSettingsAsset,
  normalizeRegionalSettingsAsset,
  resolveFixedInfiniteRegionalResourceItemIds,
  resolveRegionalResourceSettings,
} from "@/app/regional-settings";
import { createRegistryContract } from "@/registry";

describe("地区资源设置模型", () => {
  const registry = createRegistryContract();

  it("缺少地区覆盖时默认为全部可配置自然资源无穷", () => {
    const resources = resolveRegionalResourceSettings(
      createDefaultRegionalSettingsAsset(),
      "武陵",
      registry.itemDefinitions,
    );

    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every((resource) => resource.mode === "infinite")).toBe(true);
    expect(resources.map((resource) => resource.itemId)).toEqual(expect.arrayContaining([
      "item_originium_ore",
      "item_iron_ore",
      "item_copper_ore",
      "item_quartz_sand",
      "item_gas_inert",
      "item_gas_xiranite",
    ]));
  });

  it("清水和沉积酸固定为无限资源且不会进入地区编辑值", () => {
    expect(resolveFixedInfiniteRegionalResourceItemIds(registry.itemDefinitions)).toEqual([
      "item_liquid_acid",
      "item_liquid_water",
    ]);

    const normalized = normalizeRegionalSettingsAsset({
      schemaVersion: 1,
      multiBaseEnabled: true,
      regions: {
        武陵: {
          resources: [
            { itemId: "item_liquid_water", mode: "rate", perMinute: 10 },
            { itemId: "item_originium_ore", mode: "rate", perMinute: 540 },
          ],
        },
      },
    }, registry.itemDefinitions);

    expect(normalized?.multiBaseEnabled).toBe(true);
    expect(normalized?.regions["武陵"]?.resources).toEqual([
      { itemId: "item_originium_ore", mode: "rate", perMinute: 540 },
    ]);
  });

  it("拒绝低于 10 或非 10 倍数的有限速率", () => {
    for (const perMinute of [0, 9, 11, 25]) {
      const normalized = normalizeRegionalSettingsAsset({
        schemaVersion: 1,
        multiBaseEnabled: false,
        regions: {
          武陵: {
            resources: [{ itemId: "item_originium_ore", mode: "rate", perMinute }],
          },
        },
      }, registry.itemDefinitions);

      expect(normalized?.regions["武陵"]?.resources).toEqual([]);
    }
  });
});
