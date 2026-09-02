import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_DEFINITIONS,
  ACTIVITY_LIMITED_FORMULA_1_ID,
  ACTIVITY_LIMITED_FORMULA_1_TAG,
  ACTIVITY_LIMITED_FORMULA_2_ID,
  areActivityTagsEffective,
  isActivityOngoing,
  resolveActivityIdsFromTags,
  resolveEffectiveActivityIds,
  resolveOngoingActivityDefinitions,
} from "@/shared/registry/activity-availability";

const LIMITED_ACTIVITY = {
  id: ACTIVITY_LIMITED_FORMULA_1_ID,
  name: "集成援助·掌中救星",
  icon: "/item-icons/item_activity_xiranite_enr_hulu.webp",
  banner: "/activity-banners/activity-limited-formula-1.webp",
  startTime: Date.parse("2026-04-28T00:00:00+08:00"),
  endTime: Date.parse("2026-05-19T00:00:00+08:00"),
};

describe("activity availability", () => {
  it("defines the bubble strike activity with the exact Beijing time range", () => {
    expect(ACTIVITY_DEFINITIONS.find(
      (activity) => activity.id === ACTIVITY_LIMITED_FORMULA_2_ID,
    )).toEqual({
      id: ACTIVITY_LIMITED_FORMULA_2_ID,
      name: "集成援助·泡泡出击",
      icon: "/item-icons/item_activity_xiranite_enr_lung.webp",
      banner: "/activity-banners/activity-limited-formula-2.webp",
      startTime: Date.parse("2026-09-16T12:00:00+08:00"),
      endTime: Date.parse("2026-09-30T16:00:00+08:00"),
    });
  });

  it("defines an existing WebP banner for every activity", () => {
    for (const activity of ACTIVITY_DEFINITIONS) {
      expect(activity.banner).toMatch(/^\/activity-banners\/.+\.webp$/);
      expect(existsSync(resolve("public", activity.banner.replace(/^\/+/, "")))).toBe(true);
    }
  });

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

  it("resolves the activities that are ongoing at the requested time", () => {
    expect(resolveOngoingActivityDefinitions(
      ACTIVITY_DEFINITIONS,
      Date.parse("2026-04-30T00:00:00+08:00"),
    ).map((activity) => activity.id)).toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
    expect(resolveOngoingActivityDefinitions(
      ACTIVITY_DEFINITIONS,
      Date.parse("2026-08-31T00:00:00+08:00"),
    )).toEqual([]);
    expect(resolveOngoingActivityDefinitions(
      ACTIVITY_DEFINITIONS,
      Date.parse("2026-09-20T00:00:00+08:00"),
    ).map((activity) => activity.id)).toEqual([ACTIVITY_LIMITED_FORMULA_2_ID]);
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

  it("treats a definition as effective when any activity tag is effective", () => {
    const anotherActivityId = "another-activity";
    const anotherActivityTag = `activity:${anotherActivityId}`;

    expect(resolveActivityIdsFromTags(["non-activity", ACTIVITY_LIMITED_FORMULA_1_TAG]))
      .toEqual([ACTIVITY_LIMITED_FORMULA_1_ID]);
    expect(areActivityTagsEffective([ACTIVITY_LIMITED_FORMULA_1_TAG, anotherActivityTag], [])).toBe(false);
    expect(areActivityTagsEffective(
      [ACTIVITY_LIMITED_FORMULA_1_TAG, anotherActivityTag],
      [ACTIVITY_LIMITED_FORMULA_1_ID],
    )).toBe(true);
    expect(areActivityTagsEffective(
      [ACTIVITY_LIMITED_FORMULA_1_TAG, anotherActivityTag],
      [anotherActivityId],
    )).toBe(true);
    expect(areActivityTagsEffective(["non-activity"], [])).toBe(true);
  });
});
