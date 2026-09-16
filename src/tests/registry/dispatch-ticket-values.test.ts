import { describe, expect, it } from "vitest";

import { ITEM_DEFINITIONS } from "@/registry/item-definition";

const DISPATCH_TICKET_REGIONS = ["武陵", "四号谷地"] as const;
type DispatchTicketRegion = typeof DISPATCH_TICKET_REGIONS[number];

const EXPECTED_DISPATCH_TICKET_VALUES: Record<DispatchTicketRegion, Record<string, number>> = {
  武陵: {
    item_activity_xiranite_enr_hulu: 120,
    item_activity_xiranite_enr_lung: 200,
    item_activity_xiranite_hulu: 40,
    item_activity_xiranite_lung: 100,
    item_bottled_food_4: 16,
    item_bottled_food_5: 22,
    item_bottled_rec_hp_4: 16,
    item_bottled_rec_hp_5: 22,
    item_copper_cmpt: 1,
    item_copper_enr2_cmpt: 70,
    item_copper_enr_cmpt: 48,
    item_filter_core: 1,
    item_proc_battery_4: 25,
    item_proc_battery_5: 54,
    item_xiranite_enr_powder: 27,
    item_xiranite_powder: 1,
  },
  四号谷地: {
    item_bottled_food_1: 10,
    item_bottled_food_2: 27,
    item_bottled_food_3: 70,
    item_bottled_rec_hp_1: 10,
    item_bottled_rec_hp_2: 27,
    item_bottled_rec_hp_3: 70,
    item_crystal_shell: 1,
    item_glass_bottle: 2,
    item_glass_cmpt: 1,
    item_iron_cmpt: 1,
    item_iron_enr_cmpt: 3,
    item_proc_battery_1: 16,
    item_proc_battery_2: 30,
    item_proc_battery_3: 70,
  },
};

const REGION_TAG_PREFIX = "调度券地区:";
const VALUE_TAG_PREFIX = "调度券价值:";

function isDispatchTicketRegion(value: string): value is DispatchTicketRegion {
  return DISPATCH_TICKET_REGIONS.some((region) => region === value);
}

describe("dispatch ticket registry values", () => {
  it("matches the Wuling and Valley 4 settlement trade values", () => {
    const actualValues: Record<DispatchTicketRegion, Record<string, number>> = {
      武陵: {},
      四号谷地: {},
    };

    for (const item of ITEM_DEFINITIONS) {
      const regionTags = item.tags.filter((tag) => tag.startsWith(REGION_TAG_PREFIX));
      const valueTags = item.tags.filter((tag) => tag.startsWith(VALUE_TAG_PREFIX));
      if (regionTags.length === 0 && valueTags.length === 0) {
        continue;
      }

      expect(regionTags, `${item.id} must have exactly one dispatch ticket region`).toHaveLength(1);
      expect(valueTags, `${item.id} must have exactly one dispatch ticket value`).toHaveLength(1);

      const region = regionTags[0]?.slice(REGION_TAG_PREFIX.length) ?? "";
      const value = Number(valueTags[0]?.slice(VALUE_TAG_PREFIX.length));
      expect(isDispatchTicketRegion(region), `${item.id} has an unknown dispatch ticket region`).toBe(true);
      expect(Number.isFinite(value) && value > 0, `${item.id} has an invalid dispatch ticket value`).toBe(true);
      if (isDispatchTicketRegion(region)) {
        actualValues[region][item.id] = value;
      }
    }

    expect(actualValues).toEqual(EXPECTED_DISPATCH_TICKET_VALUES);
  });
});
