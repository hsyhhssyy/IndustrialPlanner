import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";

type PortGroupDefinition = EntityDefinition["portGroups"][number];

function requireEntity(id: string): EntityDefinition {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

function requirePortGroup(
  definition: EntityDefinition,
  portGroupId: string,
): PortGroupDefinition {
  const portGroup = definition.portGroups.find((candidate) => candidate.id === portGroupId);
  if (portGroup === undefined) {
    throw new Error(`Missing port group ${portGroupId} on ${definition.id}`);
  }
  return portGroup;
}

function expectPortLayout(
  portGroup: PortGroupDefinition,
  expected: Array<{
    readonly id: string;
    readonly localCellX: number;
    readonly localCellY: number;
    readonly edge: string;
  }>,
): void {
  expect(portGroup.ports.map((port) => ({
    id: port.id,
    localCellX: port.localCellX,
    localCellY: port.localCellY,
    edge: port.edge,
  }))).toEqual(expected);
}

function expectGasOnlyPorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe("fluid");
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({ base: { kind: "gas" }, exclude: [] })),
  );
}

function expectLiquidOnlyPorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe("fluid");
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({ base: { kind: "liquid" }, exclude: [] })),
  );
}

function expectFluidBasePorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe("fluid");
  expect(portGroup.ports.map((port) => port.acceptRule.base.kind)).toEqual(
    portGroup.ports.map(() => "fluid"),
  );
}

describe("gas item and device definitions", () => {
  it("marks registered gas resources as natural resources", () => {
    for (const itemId of ["item_gas_inert", "item_gas_xiranite"]) {
      const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
      expect(item?.tags).toContain("gas");
      expect(item?.tags).toContain("自然资源");
    }
  });

  it("defines gas collection pump as a hidden 3x3 gas gathering machine", () => {
    const definition = requireEntity("gas_pump_1");

    expect(definition.footprint).toEqual({ width: 3, height: 3 });
    expect(definition.uiGroup).toBe("resourcePower");
    expect(definition.tags).toContain("不可摆放");
    expect(definition.meteredConsumption).toBeUndefined();
    // AI-REMOVED 2026-07-16:
    // Reason: 气体收集泵已按当前注册表定义气体输出端口和缓冲槽，空壳约束属于测试漂移。
    // Trigger: 用户确认问题 2 为测试漂移并要求移除这项旧断言。
    // Evidence: gas_pump_1 当前包含 gas_output 端口组和 gas_output_buffer 储存组。
    // Replacement: None；本用例继续验证尺寸、百科分类和不可摆放标签。
    // Risk: Low - 本用例不再约束气体收集泵必须没有端口和槽位。
    // Human Review: Required
    //
    // Original code:
    // expect(definition.portGroups).toEqual([]);
    // expect(definition.storageSlotGroups).toEqual([]);
  });

  it("defines solid-gas converter modes as independent devices", () => {
    const gasMode = requireEntity("transmuter_2_gastrans");
    const solidMode = requireEntity("transmuter_2_solidtrans");

    expect(gasMode.footprint).toEqual({ width: 5, height: 5 });
    expect(solidMode.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(requirePortGroup(gasMode, "item_input"), [
      { id: "in_s_1", localCellX: 1, localCellY: 4, edge: "SOUTH" },
      { id: "in_s_3", localCellX: 3, localCellY: 4, edge: "SOUTH" },
    ]);
    const gasOutput = requirePortGroup(gasMode, "gas_output");
    expectPortLayout(gasOutput, [
      { id: "out_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "out_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expect(gasMode.recipeChannels[0]).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["gas_output_buffer"],
    });

    const gasInput = requirePortGroup(solidMode, "gas_input");
    expectPortLayout(gasInput, [
      { id: "in_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "in_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectPortLayout(requirePortGroup(solidMode, "item_output"), [
      { id: "out_n_1", localCellX: 1, localCellY: 0, edge: "NORTH" },
      { id: "out_n_3", localCellX: 3, localCellY: 0, edge: "NORTH" },
    ]);
    expect(solidMode.recipeChannels[0]).toMatchObject({
      ingredientStorageGroupIds: ["gas_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("defines liquid-gas converter modes as independent devices", () => {
    const gasMode = requireEntity("transmuter_1_gastrans");
    const liquidMode = requireEntity("transmuter_1_liquidtrans");
    const liquidInput = requirePortGroup(gasMode, "liquid_input");
    const gasOutput = requirePortGroup(gasMode, "gas_output");
    const gasInput = requirePortGroup(liquidMode, "gas_input");
    const liquidOutput = requirePortGroup(liquidMode, "liquid_output");

    expect(gasMode.footprint).toEqual({ width: 5, height: 5 });
    expect(liquidMode.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(liquidInput, [
      { id: "in_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "in_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectLiquidOnlyPorts(liquidInput);
    expectPortLayout(gasOutput, [
      { id: "out_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "out_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expectPortLayout(gasInput, [
      { id: "in_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "in_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectPortLayout(liquidOutput, [
      { id: "out_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "out_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectLiquidOnlyPorts(liquidOutput);
  });

  it("defines gas reactor as gas-only west input and east output", () => {
    const definition = requireEntity("gas_reactor_1");
    const gasInput = requirePortGroup(definition, "gas_input");
    const gasOutput = requirePortGroup(definition, "gas_output");

    expect(definition.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(gasInput, [
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectPortLayout(gasOutput, [
      { id: "out_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectGasOnlyPorts(gasOutput);
    expect(definition.storageSlotGroups.map((slotGroup) => ({
      id: slotGroup.id,
      kind: slotGroup.kind,
      itemFilterType: slotGroup.slots[0]?.itemFilterType,
      capacity: slotGroup.slots[0]?.capacity,
    }))).toEqual([
      { id: "gas_input_buffer", kind: "fluid", itemFilterType: "gas", capacity: 50 },
      { id: "gas_output_buffer", kind: "fluid", itemFilterType: "gas", capacity: 50 },
    ]);
  });

  it("makes liquid purifier pipe ports and buffers accept fluid", () => {
    const definition = requireEntity("liquid_purifier_1");
    // AI-REMOVED 2026-07-16:
    // Reason: 当前液体提纯机已移除固体输入端口、缓冲槽和配方输入依赖，原固体输入契约属于测试漂移。
    // Trigger: 用户确认问题 2 为测试漂移并要求移除这项旧断言。
    // Evidence: item_port_liquid_purifier_1 当前仅保留 fluid_input/fluid_output 端口组与对应缓冲槽。
    // Replacement: None；本用例继续覆盖仍有效的流体端口、过滤规则和流体缓冲槽。
    // Risk: Low - 本用例不再要求液体提纯机兼容已移除的固体输入结构。
    // Human Review: Required
    //
    // Original code:
    // const itemInput = requirePortGroup(definition, "item_input");
    // expectPortLayout(itemInput, [
    //   { id: "in_w_0", localCellX: 0, localCellY: 0, edge: "WEST" },
    //   { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
    //   { id: "in_w_2", localCellX: 0, localCellY: 2, edge: "WEST" },
    //   { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    //   { id: "in_w_4", localCellX: 0, localCellY: 4, edge: "WEST" },
    // ]);
    // expect(definition.storageSlotGroups.map((slotGroup) => slotGroup.id)).toEqual([
    //   "fluid_input_buffer",
    //   "fluid_output_buffer",
    //   "item_input_buffer",
    // ]);
    // expect(definition.storageSlotGroups[2]).toMatchObject({
    //   id: "item_input_buffer",
    //   kind: "item",
    //   slots: [{ capacity: 50, itemFilterType: "solid" }],
    // });
    // expect(definition.recipeChannels[0]?.ingredientStorageGroupIds).toEqual([
    //   "fluid_input_buffer",
    //   "item_input_buffer",
    // ]);
    const fluidInput = requirePortGroup(definition, "fluid_input");
    const fluidOutput = requirePortGroup(definition, "fluid_output");

    expectPortLayout(fluidInput, [
      { id: "in_s_1", localCellX: 1, localCellY: 4, edge: "SOUTH" },
      { id: "in_s_3", localCellX: 3, localCellY: 4, edge: "SOUTH" },
    ]);
    expectPortLayout(fluidOutput, [
      { id: "out_n_1", localCellX: 1, localCellY: 0, edge: "NORTH" },
      { id: "out_n_3", localCellX: 3, localCellY: 0, edge: "NORTH" },
    ]);
    expectFluidBasePorts(fluidInput);
    expectFluidBasePorts(fluidOutput);
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_inert");
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_xiranite");
    expect(definition.storageSlotGroups[0]).toMatchObject({
      id: "fluid_input_buffer",
      kind: "fluid",
      slots: [{ capacity: 50, itemFilterType: "fluid" }],
    });
    expect(definition.storageSlotGroups[1]).toMatchObject({
      id: "fluid_output_buffer",
      kind: "fluid",
      slots: [
        { capacity: 50, itemFilterType: "fluid" },
        { capacity: 50, itemFilterType: "fluid" },
      ],
    });
  });

  it("makes liquid filling machine pipe input and buffer accept fluid", () => {
    const definition = requireEntity("liquid_filling_pd_mc_1");
    const fluidInput = requirePortGroup(definition, "fluid_input");
    const fluidInputBuffer = definition.storageSlotGroups.find(
      (slotGroup) => slotGroup.id === "fluid_input_buffer",
    );

    expectFluidBasePorts(fluidInput);
    expect(fluidInputBuffer).toMatchObject({
      kind: "fluid",
      slots: [{ capacity: 50, itemFilterType: "fluid" }],
    });
  });

  it("makes dismantler pipe output and buffer accept fluid", () => {
    const definition = requireEntity("dismantler_1");
    const fluidOutput = requirePortGroup(definition, "fluid_output");
    const fluidOutputBuffer = definition.storageSlotGroups.find(
      (slotGroup) => slotGroup.id === "fluid_output_buffer",
    );

    expectFluidBasePorts(fluidOutput);
    expect(fluidOutputBuffer).toMatchObject({
      kind: "fluid",
      slots: [{ capacity: 50, itemFilterType: "fluid" }],
    });
  });

  it("assigns gas filling recipes to the liquid filling machine", () => {
    const gasItemIds = new Set(
      ITEM_DEFINITIONS
        .filter((item) => item.tags.includes("gas"))
        .map((item) => item.id),
    );
    const gasFillingRecipes = RECIPE_DEFINITIONS.filter((recipe) =>
      recipe.tags.includes("bottle_filling")
      && recipe.inputs.some((input) => gasItemIds.has(input.itemId)),
    );

    expect(gasFillingRecipes).toHaveLength(8);
    expect(gasFillingRecipes.every(
      (recipe) => recipe.machineId === "liquid_filling_pd_mc_1",
    )).toBe(true);
  });
});
