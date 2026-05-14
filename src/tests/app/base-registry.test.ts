import { BASE_DEFINITIONS } from "@/registry/base-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { createRegistryContract } from "@/registry";
import { describe, expect, it } from "vitest";

describe("createRegistryContract", () => {
  it("exposes local base definitions without reusing the source array", () => {
    const registry = createRegistryContract();

    expect(registry.baseDefinitions).toEqual(BASE_DEFINITIONS);
    expect(registry.baseDefinitions).not.toBe(BASE_DEFINITIONS);
  });

  it("keeps base definitions structurally valid", () => {
    const seenIds = new Set<string>();

    for (const definition of BASE_DEFINITIONS) {
      expect(definition.id).toBeTruthy();
      expect(seenIds.has(definition.id)).toBe(false);
      seenIds.add(definition.id);

      expect(definition.tag).toBeTruthy();
      expect(definition.placeableArea.width).toBeGreaterThan(0);
      expect(definition.placeableArea.height).toBeGreaterThan(0);
      expect(definition.outerRing.top).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.right).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.bottom).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.left).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.top % 5).toBe(0);
      expect(definition.outerRing.right % 5).toBe(0);
      expect(definition.outerRing.bottom % 5).toBe(0);
      expect(definition.outerRing.left % 5).toBe(0);
      expect([5, 10]).toContain(definition.outerRing.top);
      expect([5, 10]).toContain(definition.outerRing.right);
      expect([5, 10]).toContain(definition.outerRing.bottom);
      expect([5, 10]).toContain(definition.outerRing.left);

      // AI-REMOVED 2026-05-10:
      // Reason: 用户澄清约束是 outerRing 每个方向的格数分别必须是 5 的整数倍，不是外扩总面积满足 5 整除。
      // Trigger: 之前基于错误前提新增了面积整除校验，会放过方向值不是 5 倍数但总面积凑巧满足条件的错误配置。
      // Evidence: 当前会话中的用户更正；base-definition 的数据模型明确按 top/right/bottom/left 四个方向存储外扩值。
      // Replacement: 使用上面的四个方向逐项取模断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const expandedWidth =
      //   definition.placeableArea.width
      //   + definition.outerRing.left
      //   + definition.outerRing.right;
      // const expandedHeight =
      //   definition.placeableArea.height
      //   + definition.outerRing.top
      //   + definition.outerRing.bottom;
      // const expansionArea =
      //   expandedWidth * expandedHeight
      //   - definition.placeableArea.width * definition.placeableArea.height;
      //
      // expect(expansionArea % 5).toBe(0);
    }
  });

  it("classifies dedicated and general logistics devices by definition id", () => {
    const registry = createRegistryContract();

    expect(registry.queries.isDedicatedLogisticsDevice("belt_straight_1x1")).toBe(true);
    expect(registry.queries.isDedicatedLogisticsDevice("pipe_turn_ccw_1x1")).toBe(true);
    expect(registry.queries.isDedicatedLogisticsDevice("item_log_splitter")).toBe(false);
    expect(registry.queries.isDedicatedLogisticsDevice("item_pipe_connector")).toBe(false);

    expect(registry.queries.isGeneralLogisticsDevice("belt_straight_1x1")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_log_splitter")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_log_converger")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_log_connector")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_pipe_splitter")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_pipe_converger")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("item_pipe_connector")).toBe(true);

    expect(registry.queries.isGeneralLogisticsDevice("item_log_admission")).toBe(false);
    expect(registry.queries.isGeneralLogisticsDevice("item_pipe_admission")).toBe(false);
    expect(registry.queries.isGeneralLogisticsDevice("ore_miner")).toBe(false);

    expect(registry.queries.resolveDedicatedLogisticsKind("belt_straight_1x1")).toBe("belt");
    expect(registry.queries.resolveDedicatedLogisticsKind("pipe_turn_ccw_1x1")).toBe("pipe");
    expect(registry.queries.resolveDedicatedLogisticsKind("item_log_splitter")).toBeNull();
  });

  it("mounts slot-config inspectors on every recipe machine storage group", () => {
    const registry = createRegistryContract();
    const recipeMachineIds = new Set(
      registry.recipeDefinitions.map((recipe) => recipe.machineId),
    );

    for (const machineId of recipeMachineIds) {
      const definition = registry.entityDefinitions.find(
        (candidate) => candidate.id === machineId,
      );

      expect(definition, `${machineId} must have an entity definition`).toBeDefined();

      if (definition === undefined) {
        continue;
      }

      // 找出所有通过 portStorageBindings 绑定了端口的存储槽组
      const boundStorageSlotGroupIds = definition.storageSlotGroups
        .filter((storageSlotGroup) =>
          definition.portStorageBindings.some((b) => b.storageSlotGroupId === storageSlotGroup.id),
        )
        .map((g) => g.id);

      if (boundStorageSlotGroupIds.length === 0) {
        continue;
      }

      // 必须有且仅有一个 slotConfig inspector，包含所有绑定的槽组 ID
      const slotConfigInspectors = definition.inspectors.filter(
        (inspector) => inspector.type === INSPECTOR_TYPE.slotConfig,
      );

      expect(
        slotConfigInspectors,
        `${machineId} must have exactly one slotConfig inspector`,
      ).toHaveLength(1);

      const inspector = slotConfigInspectors[0];

      if (inspector === undefined) continue;

      // 验证 slotConfig 声明确实有 slotGroupIds
      expect(
        "slotGroupIds" in inspector,
        `${machineId} slotConfig must use slotGroupIds`,
      ).toBe(true);

      const slotGroupIds = (inspector as { slotGroupIds: readonly string[] }).slotGroupIds;
      expect([...slotGroupIds].sort()).toEqual([...boundStorageSlotGroupIds].sort());
    }
  });
});
