import { describe, expect, it } from "vitest";

import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry/types/entity-simulation-behavior";
import {
  FluidDomain,
} from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-08-19:
// Reason: Registry 定义测试不再查询 SimulationMode 覆盖配置。
// Trigger: 用户要求删除 simulationModeConfigs 及对应基础设施。
// Evidence: 本测试只验证基础 simulationBehaviors；两个模式的编译结果由 regional-base-runtime 覆盖。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
// AI-REMOVED 2026-08-19:
// Reason: 暗管入口销毁配方已退出，定义测试不再断言任意流体配方占位 ID 和隐藏配方标签。
// Trigger: 用户要求暗管入口在所有模式下提交仓库并抛弃销毁机制。
// Evidence: 下方用例改为断言两个旧 recipe ID 均未注册。
// Replacement: registry.queries.findRecipeDefinition 空值断言。
// Risk: Low
// Human Review: Required
//
// Original code:
// import {
//   FLUID_DOMAIN_RECIPE_ITEM_ID,
//   FluidDomain,
// } from "@/domain/shared/item-domain-flags";
// import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";

function getEntity(id: string) {
  const registry = createRegistryContract();
  const entity = registry.entityDefinitions.find((candidate) => candidate.id === id);

  if (entity === undefined) {
    throw new Error(`Missing entity ${id}`);
  }

  return entity;
}

describe("dark pipe definitions", () => {
  it.each(["udpipe_loader_1", "udpipe_loader_2"])(
    "declares mode-independent warehouse ingress for %s",
    (definitionId) => {
      const registry = createRegistryContract();
      const definition = getEntity(definitionId);

      expect(definition.simulationBehaviors).toEqual([{
        type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
        strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
        storageSlotGroupIds: ["loader_buffer"],
      }]);
      expect(registry.queries.findEntityDefinition(definitionId)).toBe(definition);
      // AI-REMOVED 2026-08-19:
      // Reason: Registry API 与 EntityDefinition 已彻底移除 SimulationMode 覆盖配置。
      // Trigger: 用户要求删除 simulationModeConfigs 及对应基础设施。
      // Evidence: 基础 behavior 断言继续覆盖设备声明；区域 Runtime 测试覆盖双模式编译结果。
      // Replacement: 上方 findEntityDefinition 基础查询断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect(definition.simulationModeConfigs).toBeUndefined();
      // expect(registry.queries.resolveEntitySimulationModeConfig(
      //   definitionId,
      //   SIMULATION_MODE.singleBase,
      // )).toBeNull();
      // expect(registry.queries.resolveEntitySimulationModeConfig(
      //   definitionId,
      //   SIMULATION_MODE.regionalMultiBase,
      // )).toBeNull();
      // AI-REMOVED 2026-08-19:
      // Reason: 暗管入口行为已从两个重复的模式配置提升为单一基础 behavior。
      // Trigger: 用户要求公共 behavior 不再伪装成模式差异。
      // Evidence: definition.simulationBehaviors 现为唯一声明；区域 Runtime 测试继续断言两个模式编译结果一致。
      // Replacement: 上方基础 behavior、空 simulationModeConfigs 与空模式查询断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect(registry.queries.resolveEntitySimulationModeConfig(
      //   definitionId,
      //   SIMULATION_MODE.singleBase,
      // )).toEqual({
      //   behaviors: [{
      //     type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
      //     strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
      //     storageSlotGroupIds: ["loader_buffer"],
      //   }],
      // });
      // expect(registry.queries.resolveEntitySimulationModeConfig(
      //   definitionId,
      //   SIMULATION_MODE.regionalMultiBase,
      // )).toEqual({
      //   behaviors: [{
      //     type: ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting,
      //     strategy: ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked,
      //     storageSlotGroupIds: ["loader_buffer"],
      //   }],
      // });
      // expect(definition.simulationModeConfigs).toBeDefined();
    },
  );

  it("configures the single-port inlet as a channel-free warehouse ingress", () => {
    const inlet = getEntity("udpipe_loader_1");

    expect(inlet.tags).not.toContain("WarehouseSink");
    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]).toMatchObject({
      id: "loader_buffer",
      kind: FluidDomain,
      slots: [
        expect.objectContaining({
          id: "slot_1",
          capacity: 500,
          itemFilterType: FluidDomain,
        }),
      ],
    });
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([]);
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures the multi-port inlet as a channel-free warehouse ingress sharing one slot", () => {
    const inlet = getEntity("udpipe_loader_2");

    expect(inlet.storageSlotGroups).toHaveLength(1);
    expect(inlet.storageSlotGroups[0]?.id).toBe("loader_buffer");
    expect(inlet.storageSlotGroups[0]?.slots[0]?.capacity).toBe(500);
    expect(inlet.portGroups[0]?.ports).toHaveLength(2);
    expect(inlet.portStorageBindings).toEqual([
      { id: "bind_fluid_input", portGroupId: "fluid_input", storageSlotGroupId: "loader_buffer" },
    ]);
    expect(inlet.recipeChannels).toEqual([]);
    expect(inlet.recipeChannelBehavior).toBeUndefined();
    expect(inlet.inspectors).toEqual(expect.arrayContaining([
      { type: INSPECTOR_TYPE.darkPipeLink },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["loader_buffer"] },
    ]));
  });

  it("configures dark pipe outlets as warehouse-linked generators with one 500-capacity fluid slot", () => {
    for (const id of ["udpipe_unloader_1", "udpipe_unloader_2"]) {
      const outlet = getEntity(id);

      expect(outlet.tags).not.toContain("WarehouseSink");
      expect(outlet.storageSlotGroups).toHaveLength(1);
      expect(outlet.storageSlotGroups[0]).toMatchObject({
        id: "unloader_buffer",
        kind: FluidDomain,
        slots: [
          expect.objectContaining({
            id: "slot_1",
            capacity: 500,
            initialItemType: null,
            initialCount: 0,
            itemFilterType: FluidDomain,
          }),
        ],
      });
      expect(outlet.recipeChannels).toEqual([
        {
          id: "default",
          type: "normal-channel",
          ingredientStorageGroupIds: ["unloader_buffer"],
          productStorageGroupIds: ["unloader_buffer"],
          manualRecipeOnly: undefined,
        },
      ]);
      expect(outlet.inspectors).toEqual(expect.arrayContaining([
        { type: INSPECTOR_TYPE.darkPipeLink },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unloader_buffer"] },
        { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["unloader_buffer"] },
      ]));
    }
  });

  it("does not register the retired dark pipe inlet void recipes", () => {
    const registry = createRegistryContract();

    expect(registry.queries.findRecipeDefinition(
      "r_udpipe_loader_void_fluid_any_internal",
    )).toBeNull();
    expect(registry.queries.findRecipeDefinition(
      "r_udpipe_loader_multi_void_fluid_any_internal",
    )).toBeNull();
  });
});
