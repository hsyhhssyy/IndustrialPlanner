import { describe, expect, it } from "vitest";

import { ITEM_DEFINITIONS } from "@/registry/item-definition";

const EXPECTED_WULING_DISPATCH_TICKET_VALUES = {
  item_activity_xiranite_enr_hulu: 120,
  item_activity_xiranite_hulu: 40,
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
};

describe("dispatch ticket registry values", () => {
  it("matches the Wuling settlement trade values", () => {
    const actualValues = Object.fromEntries(
      ITEM_DEFINITIONS.flatMap((item) => {
        if (!item.tags.includes("调度券地区:武陵")) {
          return [];
        }

        const valueTag = item.tags.find((tag) => tag.startsWith("调度券价值:"));
        expect(valueTag).toBeDefined();

        return [[item.id, Number(valueTag?.slice("调度券价值:".length))]];
      }),
    );

    expect(actualValues).toEqual(EXPECTED_WULING_DISPATCH_TICKET_VALUES);
  });
});
