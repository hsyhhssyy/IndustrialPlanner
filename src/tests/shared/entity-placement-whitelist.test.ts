// AI-REMOVED 2026-10-12:
// Reason: 标签解析退出地理资格规则。
// Trigger: 用户确认结构化白名单。
// Evidence: 当前业务改用 resolveEntityPlacementAreas。
// Replacement: 本文件的新白名单用例。
// Risk: 地图和区域边界需保持回归覆盖。
// Human Review: Required
//
// Original code:
// import { describe, expect, it } from "vitest";
// import { matchesEntityBaseOnlyTag } from "@/shared/base-tags";
//
// describe("地图限定标签", () => {
//   it("没有地图限定的设备保持原有可用性", () => {
//     expect(matchesEntityBaseOnlyTag(["武陵", "baseAreaOnly=wuling_yuanyuan_zhuang"], "draft_box")).toBe(true);
//     expect(matchesEntityBaseOnlyTag([], null)).toBe(true);
//   });
//
//   it("完整匹配地图 ID，禁止空参数并区分地图与子区域", () => {
//     const tags = ["baseOnly=wuling_agricultural_land"];
//     expect(matchesEntityBaseOnlyTag(tags, "wuling_agricultural_land")).toBe(true);
//     expect(matchesEntityBaseOnlyTag(tags, "wuling_yuanyuan_zhuang")).toBe(false);
//     expect(matchesEntityBaseOnlyTag(tags, "wuling_agricultural_land_extra")).toBe(false);
//     expect(matchesEntityBaseOnlyTag(tags, null)).toBe(false);
//     expect(matchesEntityBaseOnlyTag(["baseOnly="], "")).toBe(false);
//     expect(matchesEntityBaseOnlyTag(["baseOnly="], "wuling_agricultural_land")).toBe(false);
//   });
// });
import { describe, expect, it } from "vitest";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { BASE_DEFINITIONS } from "@/registry/base-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { resolveEntityPlacementAreas, validateEntityPlacementWhitelists } from "@/shared/entity-placement-whitelist";

const base = BASE_DEFINITIONS.find((candidate) => candidate.id === "wuling_agricultural_land")!;
const areas = resolveBaseAreas(base);

describe("设备地图与区域白名单", () => {
  it("未声明允许所有区域，空白名单禁止全部，地区标签不再影响资格", () => {
    expect(resolveEntityPlacementAreas({}, base, areas)).toBe(areas);
    expect(resolveEntityPlacementAreas({ placementWhitelist: [] }, base, areas)).toEqual([]);
    expect(resolveEntityPlacementAreas({ placementWhitelist: [{ baseId: "draft_box" }] }, base, areas)).toEqual([]);
  });

  it("整图条目允许主区域与现在及未来新增区域，多个地图任选", () => {
    const definition = { placementWhitelist: [{ baseId: base.id }, { baseId: "draft_box" }] };
    const futureArea = { ...areas[0]!, id: "future-area" };
    expect(resolveEntityPlacementAreas(definition, base, [...areas, futureArea])).toHaveLength(3);
    const draft = BASE_DEFINITIONS.find((candidate) => candidate.id === "draft_box")!;
    expect(resolveEntityPlacementAreas(definition, draft, resolveBaseAreas(draft))).toHaveLength(1);
    expect(resolveEntityPlacementAreas(definition, { id: "wuling_agricultural_land_extra" }, areas)).toEqual([]);
  });

  it("区域 ID 按地图限定，主区域与子区域可单选或任选", () => {
    for (const area of areas) {
      expect(resolveEntityPlacementAreas({ placementWhitelist: [{ baseId: base.id, areaIds: [area.id] }] }, base, areas))
        .toEqual([area]);
    }
    expect(resolveEntityPlacementAreas({ placementWhitelist: [{ baseId: base.id, areaIds: areas.map((area) => area.id) }] }, base, areas))
      .toEqual(areas);
    expect(resolveEntityPlacementAreas({ placementWhitelist: [{ baseId: base.id, areaIds: ["missing-area"] }] }, base, areas))
      .toEqual([]);
  });

  it.each([
    { whitelist: [{ baseId: "unknown-base" }], message: "Unknown placement base" },
    { whitelist: [{ baseId: base.id }, { baseId: base.id }], message: "Duplicate placement base" },
    { whitelist: [{ baseId: base.id, areaIds: [] }], message: "Empty placement areas" },
    { whitelist: [{ baseId: "draft_box", areaIds: ["wuling_yuanyuan_zhuang"] }], message: "Unknown placement area" },
    { whitelist: [{ baseId: base.id, areaIds: [base.id, base.id] }], message: "Duplicate placement area" },
  ])("注册时拒绝 $message，并报告设备 ID", ({ whitelist, message }) => {
    const definition = { id: "restricted-device", tags: [], placementWhitelist: whitelist };
    expect(() => validateEntityPlacementWhitelists([definition], BASE_DEFINITIONS)).toThrow(message);
    expect(() => validateEntityPlacementWhitelists([definition], BASE_DEFINITIONS)).toThrow("restricted-device");
  });

  it("有效空白名单可注册，退役的地图和区域标签拒绝注册", () => {
    expect(() => validateEntityPlacementWhitelists([{ id: "blocked", tags: [], placementWhitelist: [] }], BASE_DEFINITIONS)).not.toThrow();
    for (const tag of ["baseOnly=wuling_agricultural_land", "baseAreaOnly=wuling_yuanyuan_zhuang"]) {
      expect(() => validateEntityPlacementWhitelists([{ id: "retired", tags: [tag] }], BASE_DEFINITIONS)).toThrow("Retired placement tag on retired");
    }
  });

  it("迁移后的现有地区设备保留武陵与草稿箱权限，并禁止四号谷地", () => {
    expect(() => validateEntityPlacementWhitelists(ENTITY_DEFINITIONS, BASE_DEFINITIONS)).not.toThrow();
    const regional = ENTITY_DEFINITIONS.filter((definition) => definition.tags.includes("武陵"));
    expect(regional).toHaveLength(32);
    for (const definition of regional) {
      for (const candidate of BASE_DEFINITIONS) {
        const allowed = candidate.tag === "武陵" || candidate.id === "draft_box";
        expect(resolveEntityPlacementAreas(definition, candidate, resolveBaseAreas(candidate)).length > 0).toBe(allowed);
      }
    }
    const metadataOnly: Pick<EntityDefinition, "placementWhitelist"> = {};
    expect(resolveEntityPlacementAreas(metadataOnly, base, areas)).toBe(areas);
  });
});

