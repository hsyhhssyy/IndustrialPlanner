import { describe, expect, it } from "vitest";
import type { BlueprintPlannerManualNode } from "@/domain/blueprint-planner";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";

const source: BlueprintPlannerManualNode = { id: "supply-a", definitionId: "udpipe_unloader_1", recipeId: null,
  purpose: "supply", inputs: [], outputs: [{ itemId: "item_gas_copper_enr", perMinute: 30 }] };
const other: BlueprintPlannerManualNode = { ...source, id: "supply-b", outputs: [{ itemId: "item_gas_xiranite", perMinute: 30 }] };

describe("人工无配方设备的物料职责", () => {
  it("类型绑定允许同设备互换，配方绑定按物料区分，拓扑绑定保留实例", () => {
    expect(manualBindingKey(source, "device")).toBe(manualBindingKey(other, "device"));
    expect(manualBindingKey(source, "recipe")).not.toBe(manualBindingKey(other, "recipe"));
    expect(manualBindingKey(source, "topology")).toBe(source.id);
  });

  it("相同物料的排序、重复项与流量不改变配方兼容性", () => {
    const combined = { ...source, outputs: [...source.outputs, ...other.outputs] };
    const reordered = { ...source, outputs: [...other.outputs, { ...source.outputs[0]!, perMinute: 60 }, ...source.outputs] };
    expect(manualBindingKey(combined, "recipe")).toBe(manualBindingKey(reordered, "recipe"));
    expect(manualBindingKey(source, "recipe")).not.toBe(manualBindingKey({ ...source, inputs: source.outputs, outputs: [] }, "recipe"));
    expect(manualBindingKey(source, "recipe")).not.toBe(manualBindingKey({ ...source, purpose: "product" }, "recipe"));
  });

  it("重新分配与偏移不会把已固定出口改派给其他物料，缺失物料保留冲突", () => {
    const fixed = [{ referenceNode: { ...source, id: "old-supply" }, position: { x: 8, y: 8 }, rotation: 0 as const }];
    for (const offset of [0, 1, 2]) {
      expect(matchManualPlacements([other, source], fixed, "recipe", offset).assignments.get("old-supply")?.id).toBe(source.id);
    }
    expect(matchManualPlacements([other], fixed, "recipe").issues).toEqual([{ kind: "excess", nodeIds: ["old-supply"], excessCount: 1 }]);
  });

  it("有生产配方时仍按配方匹配，不因不同负荷下的流量视图拆组", () => {
    expect(manualBindingKey({ ...source, recipeId: "recipe-a" }, "recipe"))
      .toBe(manualBindingKey({ ...other, recipeId: "recipe-a" }, "recipe"));
  });
});
