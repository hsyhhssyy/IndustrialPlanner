import { describe, expect, it } from "vitest";
import { matchesEntityBaseOnlyTag } from "@/shared/base-tags";

describe("地图限定标签", () => {
  it("没有地图限定的设备保持原有可用性", () => {
    expect(matchesEntityBaseOnlyTag(["武陵", "baseAreaOnly=wuling_yuanyuan_zhuang"], "draft_box")).toBe(true);
    expect(matchesEntityBaseOnlyTag([], null)).toBe(true);
  });

  it("完整匹配地图 ID，禁止空参数并区分地图与子区域", () => {
    const tags = ["baseOnly=wuling_agricultural_land"];
    expect(matchesEntityBaseOnlyTag(tags, "wuling_agricultural_land")).toBe(true);
    expect(matchesEntityBaseOnlyTag(tags, "wuling_yuanyuan_zhuang")).toBe(false);
    expect(matchesEntityBaseOnlyTag(tags, "wuling_agricultural_land_extra")).toBe(false);
    expect(matchesEntityBaseOnlyTag(tags, null)).toBe(false);
    expect(matchesEntityBaseOnlyTag(["baseOnly="], "")).toBe(false);
    expect(matchesEntityBaseOnlyTag(["baseOnly="], "wuling_agricultural_land")).toBe(false);
  });
});
