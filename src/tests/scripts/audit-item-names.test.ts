import { describe, expect, it } from "vitest";

// @ts-expect-error 此脚本是直接由 Node 执行的 mjs，没有单独维护声明文件。
import { buildRawContainerItemIdsByPair, compareItemNames } from "../../../.agents/skills/unpack-data-analysis/scripts/audit-item-names.mjs";

function createContainerRecipes() {
  return {
    filling: {
      ingredients: [{
        group: [
          { id: "item_container", count: 1 },
          { id: "item_content", count: 1 },
        ],
      }],
      outcomes: [{ group: [{ id: "item_raw_filled", count: 1 }] }],
    },
    dismantle: {
      ingredients: [{ group: [{ id: "item_raw_filled", count: 1 }] }],
      outcomes: [{
        group: [
          { id: "item_container", count: 1 },
          { id: "item_content", count: 1 },
        ],
      }],
    },
  };
}

function createComparisonFixture() {
  const currentItems = [
    { id: "item_container", nameKey: "registry.item.item_container.name", tags: [] },
    { id: "item_content", nameKey: "registry.item.item_content.name", tags: [] },
    {
      id: "item_project_filled",
      nameKey: "registry.item.item_project_filled.name",
      tags: ["container:item_container", "container-item:item_content"],
    },
    { id: "item_plain", nameKey: "registry.item.item_plain.name", tags: [] },
  ];
  const zhCN = new Map([
    ["registry.item.item_container.name", "容器"],
    ["registry.item.item_content.name", "内容物"],
    ["registry.item.item_project_filled.name", "容器（内容物）"],
    ["registry.item.item_plain.name", "普通物品"],
  ]);
  const enUS = new Map([
    ["registry.item.item_container.name", "Container"],
    ["registry.item.item_content.name", "Content"],
    ["registry.item.item_project_filled.name", "Container (Content)"],
    ["registry.item.item_plain.name", "Plain Item"],
  ]);
  const rawItems = new Map([
    ["item_container", { id: "item_container", zhCN: "容器", enUS: "Container" }],
    ["item_content", { id: "item_content", zhCN: "内容物", enUS: "Content" }],
    ["item_raw_filled", { id: "item_raw_filled", zhCN: "容器", enUS: "Container" }],
    ["item_plain", { id: "item_plain", zhCN: "普通物品", enUS: "Plain Item" }],
  ]);
  const rawContainerItemIdsByPair = buildRawContainerItemIdsByPair(
    createContainerRecipes(),
  );
  return { currentItems, zhCN, enUS, rawItems, rawContainerItemIdsByPair };
}

describe("audit-item-names", () => {
  it("resolves a container item only when filling and dismantle recipes agree", () => {
    const mappings = buildRawContainerItemIdsByPair(createContainerRecipes());

    expect([...mappings.values()]).toContainEqual(["item_raw_filled"]);
  });

  it("validates project-composed names without comparing them to raw generic names", () => {
    const result = compareItemNames(createComparisonFixture());

    expect(result.validatedComposedItems).toEqual([{
      id: "item_project_filled",
      rawItemId: "item_raw_filled",
      containerId: "item_container",
      contentId: "item_content",
      checkedLocales: ["zh-CN", "en-US"],
    }]);
    expect(result.nameModifications).toEqual([]);
    expect(result.invalidComposedNames).toEqual([]);
  });

  it("separates missing translations and invalid composition from raw name differences", () => {
    const fixture = createComparisonFixture();
    fixture.zhCN.set("registry.item.item_project_filled.name", "错误的组合名");
    fixture.enUS.delete("registry.item.item_project_filled.name");

    const result = compareItemNames(fixture);

    expect(result.nameModifications).toEqual([]);
    expect(result.invalidComposedNames).toEqual([{
      id: "item_project_filled",
      containerId: "item_container",
      contentId: "item_content",
      locale: "zh-CN",
      currentName: "错误的组合名",
      expectedName: "容器（内容物）",
    }]);
    expect(result.missingTranslations).toContainEqual({
      id: "item_project_filled",
      nameKey: "registry.item.item_project_filled.name",
      locales: ["en-US"],
    });
    expect(result.validatedComposedItems).toEqual([]);
  });
});
