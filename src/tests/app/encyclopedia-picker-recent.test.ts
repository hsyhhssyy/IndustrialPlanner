import { afterEach, describe, expect, it } from "vitest";

import { WorkbenchEncyclopediaPickerController } from "@/app/shell/state/encyclopedia-picker-state";
import type { EncyclopediaPickerSharedFilterState } from "@/app/shell/state/encyclopedia-picker-state";

const PERSISTED_ITEMS_KEY = "planner.recent-picker-items";
const PERSISTED_QUERY_KEY = "planner.last-picker-query";

function createSharedFilterState(): EncyclopediaPickerSharedFilterState {
  return {
    desktopCategory: "all",
    mobileSelectedCategories: [],
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("WorkbenchEncyclopediaPickerController — 最近搜索物品", () => {
  it("记录选择物品到 recentItemIds 头部并去重", () => {
    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    controller.selectItem("item_carbon_enr");
    expect(controller.recentItemIds).toEqual(["item_carbon_enr"]);

    controller.selectItem("item_bottled_food_1");
    expect(controller.recentItemIds).toEqual(["item_bottled_food_1", "item_carbon_enr"]);

    // 再次选择已存在的 item：应移到头部，不重复
    controller.selectItem("item_carbon_enr");
    expect(controller.recentItemIds).toEqual(["item_carbon_enr", "item_bottled_food_1"]);
  });

  it("限制最近物品数量为 20 条", () => {
    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    for (let index = 0; index < 25; index += 1) {
      controller.selectItem(`item_test_${index}`);
    }

    expect(controller.recentItemIds).toHaveLength(20);
    // 最新的 item 在头部
    expect(controller.recentItemIds[0]).toBe("item_test_24");
    // 最老的 5 条被裁剪
    expect(controller.recentItemIds).not.toContain("item_test_0");
    expect(controller.recentItemIds).not.toContain("item_test_1");
  });

  it("将 recentItemIds 持久化到 localStorage", () => {
    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    controller.selectItem("item_copper_ore");
    controller.selectItem("item_carbon_enr");
    controller.selectItem("item_bottled_food_1");

    const stored = localStorage.getItem(PERSISTED_ITEMS_KEY);

    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual([
      "item_bottled_food_1",
      "item_carbon_enr",
      "item_copper_ore",
    ]);
  });

  it("从 localStorage 恢复已有的 recentItemIds", () => {
    localStorage.setItem(
      PERSISTED_ITEMS_KEY,
      JSON.stringify(["item_copper_ore", "item_carbon_enr", "item_bottled_food_1"]),
    );

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.recentItemIds).toEqual([
      "item_copper_ore",
      "item_carbon_enr",
      "item_bottled_food_1",
    ]);
  });

  it("localStorage 数据损坏时回退为空列表", () => {
    localStorage.setItem(PERSISTED_ITEMS_KEY, "{not-valid-json");

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.recentItemIds).toEqual([]);
  });

  it("localStorage 中非数组数据回退为空列表", () => {
    localStorage.setItem(PERSISTED_ITEMS_KEY, JSON.stringify({ key: "value" }));

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.recentItemIds).toEqual([]);
  });
});

describe("WorkbenchEncyclopediaPickerController — 上次搜索文本", () => {
  it("关闭对话框后将当前查询文本持久化到 localStorage", () => {
    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    controller.pickEntry();
    controller.setQuery("铜矿");
    controller.cancel();

    expect(localStorage.getItem(PERSISTED_QUERY_KEY)).toBe("铜矿");
  });

  it("选择物品关闭对话框后同样持久化查询文本", () => {
    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    controller.pickEntry();
    controller.setQuery("碳");
    controller.selectItem("item_carbon_enr");

    expect(localStorage.getItem(PERSISTED_QUERY_KEY)).toBe("碳");
  });

  it("从 localStorage 恢复上次搜索文本", () => {
    localStorage.setItem(PERSISTED_QUERY_KEY, "铁矿");

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.query).toBe("铁矿");
  });

  it("pickEntry 无 initialQuery 时保留已有 query", () => {
    localStorage.setItem(PERSISTED_QUERY_KEY, "水泥");

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.query).toBe("水泥");

    // 打开选择器，不传 initialQuery
    controller.pickEntry();

    expect(controller.query).toBe("水泥");
  });

  it("pickEntry 显式传入 initialQuery 时优先使用", () => {
    localStorage.setItem(PERSISTED_QUERY_KEY, "旧查询");

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    controller.pickEntry({ initialQuery: "新查询" });

    expect(controller.query).toBe("新查询");
  });

  it("localStorage 不可用时查询文本为空且不崩溃", () => {
    // 模拟 localStorage 抛出异常
    const originalGetItem = localStorage.getItem.bind(localStorage);
    const originalSetItem = localStorage.setItem.bind(localStorage);

    localStorage.getItem = () => {
      throw new Error("Storage unavailable");
    };
    localStorage.setItem = () => {
      throw new Error("Storage unavailable");
    };

    const controller = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(controller.query).toBe("");

    // finish 时也不应崩溃
    controller.pickEntry();
    controller.cancel();

    localStorage.getItem = originalGetItem;
    localStorage.setItem = originalSetItem;
  });

  it("上次搜索文本独立于工作区快照，关闭开启后保持不变", () => {
    const firstController = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    firstController.pickEntry();
    firstController.setQuery("集成测试");
    firstController.cancel();

    // 创建第二个 controller 实例
    const secondController = new WorkbenchEncyclopediaPickerController(createSharedFilterState);

    expect(secondController.query).toBe("集成测试");

    // 打开选择器后 query 保持
    secondController.pickEntry();

    expect(secondController.query).toBe("集成测试");
  });
});
