import { describe, expect, it } from "vitest";

import {
  createDefaultRegionalSettingsAsset,
  normalizeRegionalSettingsAsset,
  REGIONAL_SETTINGS_SCHEMA_VERSION,
  resolveFixedInfiniteRegionalResourceItemIds,
  resolveRegionalResourceSettings,
} from "@/app/regional-settings";
import { createRegistryContract } from "@/registry";
import { createRegionalDarkPipeLink } from "@/shared/dark-pipe-link";

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

  it("将 schema 1 升级为空暗管关系，并在 schema 2 归一化跨基地一对一关系", () => {
    const legacy = normalizeRegionalSettingsAsset({
      schemaVersion: 1,
      multiBaseEnabled: true,
      regions: {},
      darkPipeLinks: [{
        inlet: { baseId: "wuling_protocol_core", entityId: "legacy-inlet" },
        outlet: { baseId: "wuling_tianwangping_aid", entityId: "legacy-outlet" },
      }],
    }, registry.itemDefinitions);
    expect(legacy).toMatchObject({
      schemaVersion: REGIONAL_SETTINGS_SCHEMA_VERSION,
      darkPipeLinks: [],
    });

    const inlet = { baseId: "wuling_protocol_core", entityId: "inlet" };
    const outlet = { baseId: "wuling_tianwangping_aid", entityId: "outlet" };
    const normalized = normalizeRegionalSettingsAsset({
      schemaVersion: REGIONAL_SETTINGS_SCHEMA_VERSION,
      multiBaseEnabled: true,
      regions: {},
      darkPipeLinks: [
        { id: "ignored", inlet, outlet },
        {
          id: "duplicate-endpoint",
          inlet,
          outlet: { baseId: "wuling_heart_repair_station", entityId: "other-outlet" },
        },
        {
          id: "same-base",
          inlet: { baseId: "wuling_protocol_core", entityId: "local-inlet" },
          outlet: { baseId: "wuling_protocol_core", entityId: "local-outlet" },
        },
      ],
    }, registry.itemDefinitions);

    expect(normalized?.darkPipeLinks).toEqual([
      createRegionalDarkPipeLink({ inlet, outlet }),
    ]);
  });
});
