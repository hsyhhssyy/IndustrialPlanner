// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createRecipeNode } from "@/blueprint-planner/production-network";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";

it("beta1 初排拒绝遮挡端口，失败不污染摆位且允许无冲突位置", () => {
  const registry = createRegistryContract();
  const oven = createRecipeNode(registry, registry.queries.findRecipeDefinition("xiranite_oven_xiranite_powder_2")!, "oven", 30, "production");
  const furnace = createRecipeNode(registry, registry.queries.findRecipeDefinition("r_furnace_carbon_mtl_from_grass_2_basic")!, "furnace", 30, "production");
  const placement = new PlannerPlacement(registry, 40, 0, 0, 0, 1);
  placement.place(oven, { x: 14, y: 27 }, 180);
  // AI-CORRECTION 2026-10-26：恢复 beta1 的端口通路保护，冗余口也不允许被相邻设备遮挡。
  expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(false);
  const input = oven.inputs.findIndex(flow => flow.itemId === "item_carbon_mtl");
  const original = oven.inputs[input]!;
  // 这里只检验几何端口容量，不作为超速配方提交给生产验收。
  oven.inputs[input] = { ...original, perMinute: 90 };
  expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(false);
  oven.inputs[input] = original;
  const blocker = createPlainNode(registry, "power_diffuser_1", "blocker", "power");
  expect(placement.canPlace(blocker, { x: 19, y: 29 }, 0)).toBe(false);
  expect(() => placement.place(furnace, { x: 15, y: 32 }, 270)).toThrow("设备无法放置");
  expect(placement.placed).toEqual([oven]);
  expect(placement.canPlace(furnace, { x: 2, y: 2 }, 0)).toBe(true);
  placement.place(furnace, { x: 2, y: 2 }, 0);
  expect(placement.placed).toEqual([oven, furnace]);
});

// AI-REMOVED 2026-10-26:
// Reason: 端口摆位规则恢复为 beta1 的严格保护，新增失败不污染摆位及可行位置的行为验证。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/placement-capacity.test.ts；原文件 SHA256 7960a9bbeec2a8c0f89c932b61a05ce819718445dcb1e8492b0120a5609f3b03。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { expect, it } from "vitest";
// import { createRegistryContract } from "@/registry";
// import { createRecipeNode } from "@/blueprint-planner/production-network";
// import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
//
// it("初排可遮住洪炉的冗余固体口，但不能堵住唯一供水口或损失所需端口运力", () => {
//   const registry = createRegistryContract();
//   const oven = createRecipeNode(registry, registry.queries.findRecipeDefinition("xiranite_oven_xiranite_powder_2")!, "oven", 30, "production");
//   const furnace = createRecipeNode(registry, registry.queries.findRecipeDefinition("r_furnace_carbon_mtl_from_grass_2_basic")!, "furnace", 30, "production");
//   const placement = new PlannerPlacement(registry, 40, 0, 0, 0, 1);
//   placement.place(oven, { x: 14, y: 27 }, 180);
//   expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(true);
//   const input = oven.inputs.findIndex(flow => flow.itemId === "item_carbon_mtl");
//   const original = oven.inputs[input]!;
//   // 这里只检验几何端口容量，不作为超速配方提交给生产验收。
//   oven.inputs[input] = { ...original, perMinute: 90 };
//   expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(false);
//   oven.inputs[input] = original;
//   const blocker = createPlainNode(registry, "power_diffuser_1", "blocker", "power");
//   expect(placement.canPlace(blocker, { x: 19, y: 29 }, 0)).toBe(false);
//   placement.place(furnace, { x: 15, y: 32 }, 270);
//   expect(placement.placed).toEqual([oven, furnace]);
// });
//
