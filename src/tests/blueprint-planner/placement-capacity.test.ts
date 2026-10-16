// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createRecipeNode } from "@/blueprint-planner/production-network";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";

it("初排可遮住洪炉的冗余固体口，但不能堵住唯一供水口或损失所需端口运力", () => {
  const registry = createRegistryContract();
  const oven = createRecipeNode(registry, registry.queries.findRecipeDefinition("xiranite_oven_xiranite_powder_2")!, "oven", 30, "production");
  const furnace = createRecipeNode(registry, registry.queries.findRecipeDefinition("r_furnace_carbon_mtl_from_grass_2_basic")!, "furnace", 30, "production");
  const placement = new PlannerPlacement(registry, 40, 0, 0, 0, 1);
  placement.place(oven, { x: 14, y: 27 }, 180);
  expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(true);
  const input = oven.inputs.findIndex(flow => flow.itemId === "item_carbon_mtl");
  const original = oven.inputs[input]!;
  // 这里只检验几何端口容量，不作为超速配方提交给生产验收。
  oven.inputs[input] = { ...original, perMinute: 90 };
  expect(placement.canPlace(furnace, { x: 15, y: 32 }, 270)).toBe(false);
  oven.inputs[input] = original;
  const blocker = createPlainNode(registry, "power_diffuser_1", "blocker", "power");
  expect(placement.canPlace(blocker, { x: 19, y: 29 }, 0)).toBe(false);
  placement.place(furnace, { x: 15, y: 32 }, 270);
  expect(placement.placed).toEqual([oven, furnace]);
});
