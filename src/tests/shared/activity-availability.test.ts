import { describe, expect, it } from "vitest";

import {
  ACTIVITY_LIMITED_FORMULA_1_ID,
  ACTIVITY_LIMITED_FORMULA_1_TAG,
  areActivityTagsEffective,
  isActivityOngoing,
  resolveActivityIdsFromTags,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";

const LIMITED_ACTIVITY = {
  id: ACTIVITY_LIMITED_FORMULA_1_ID,
  name: "集成援助·掌中救星",
  icon: "/item-icons/item_activity_xiranite_enr_hulu.webp",
  startTime: Date.parse("2026-04-28T00:00:00+08:00"),
  endTime: Date.parse("2026-05-19T00:00:00+08:00"),
};

describe("activity availability", () => {
  it("uses inclusive start time and exclusive end time", () => {
    expect(isActivityOngoing(
      LIMITED_ACTIVITY,
      Date.parse("2026-04-27T23:59:59+08:00"),
    )).toBe(false);
    expect(isActivityOngoing(
      LIMITED_ACTIVITY,
      Date.parse("2026-04-28T00:00:00+08:00"),
    )).toBe(true);
    expect(isActivityOngoing(
      LIMITED_ACTIVITY,
      Date.parse("2026-05-18T23:59:59+08:00"),
    )).toBe(true);
    expect(isActivityOngoing(
      LIMITED_ACTIVITY,
      Date.parse("2026-05-19T00:00:00+08:00"),
    )).toBe(false);
  });

  it("combines ongoing activities with selected historical activities", () => {
    expect(resolveEffectiveActivityIds({
      activities: [LIMITED_ACTIVITY],
      now: Date.parse("2026-06-11T00:00:00+08:00"),
    })).toEqual([]);
    expect(resolveEffectiveActivityIds({
      activities: [LIMITED_ACTIVITY],
      selectedActivityIds: [ACTIVITY_LIMITED_FORMULA_1_ID, "unknown"],
      now: Date.parse("2026-06-11T00:00:00+08:00"),
    })).toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
    expect(resolveEffectiveActivityIds({
      activities: [LIMITED_ACTIVITY],
      now: Date.parse("2026-04-30T00:00:00+08:00"),
    })).toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
  });

  it("requires every activity tag on a definition to be effective", () => {
    expect(resolveActivityIdsFromTags(["non-activity", ACTIVITY_LIMITED_FORMULA_1_TAG]))
      .toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
    expect(areActivityTagsEffective([ACTIVITY_LIMITED_FORMULA_1_TAG], [])).toBe(false);
    expect(areActivityTagsEffective([ACTIVITY_LIMITED_FORMULA_1_TAG], [ACTIVITY_LIMITED_FORMULA_1_ID])).toBe(true);
    expect(areActivityTagsEffective(["non-activity"], [])).toBe(true);
  });
});
