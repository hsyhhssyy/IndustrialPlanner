import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  FluidDomain,
  ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
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
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({
      base: { kind: "domain", flags: ItemDomainFlag.Gas },
      exclude: [],
    })),
  );
}

function expectLiquidOnlyPorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule)).toEqual(
    portGroup.ports.map(() => ({
      base: { kind: "domain", flags: ItemDomainFlag.Liquid },
      exclude: [],
    })),
  );
}

function expectFluidBasePorts(portGroup: PortGroupDefinition): void {
  expect(portGroup.kind).toBe(FluidDomain);
  expect(portGroup.isPipe).toBe(true);
  expect(portGroup.ports.map((port) => port.acceptRule.base)).toEqual(
    portGroup.ports.map(() => ({ kind: "domain", flags: FluidDomain })),
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

  it("defines gas collection pump as a placeable 3x3 manual-recipe gathering machine", () => {
    const definition = requireEntity("gas_pump_1");

    expect(definition.footprint).toEqual({ width: 3, height: 3 });
    expect(definition.uiGroup).toBe("resourcePower");
    expect(definition.tags).not.toContain("不可摆放");
    expect(definition.tags).toContain("OuterRingAllowed");
    expect(definition.tags).toContain("InnerRingNotAllowed");
    expect(definition.requiresPower).toBe(false);
    expect(definition.powerDemand).toBe(0);
    expect(definition.placementBehaviors).toEqual([
      { type: "default-placement" },
      { type: "snap-to-outer-ring-edge" },
      { type: "no-near-same-entity", range: 2 },
    ]);
    expect(definition.recipeChannels.some((channel) => channel.type === "consumption-channel"))
      .toBe(false);
    expect(definition.recipeChannels).toEqual([
      expect.objectContaining({
        id: "default",
        ingredientStorageGroupIds: [],
        productStorageGroupIds: ["gas_output_buffer"],
        manualRecipeOnly: true,
      }),
    ]);
    expect(definition.inspectors.some(
      (inspector) => inspector.type === "recipe-status",
    )).toBe(true);
    expect(definition.inspectors.some(
      (inspector) => inspector.type === "warehouse-item-link",
    )).toBe(false);
    expect(definition.placementDefaults).toBeUndefined();

    // AI-REMOVED 2026-08-19:
    // Reason: 新版气体收集泵不再声明仓库链接 inspector 或默认惰气仓库链接。
    // Trigger: 气体收集泵改为手选配方真实生产。
    // Evidence: 上方断言已覆盖 default 手动 channel、recipe-status 与无 placementDefaults。
    // Replacement: 上方新版契约断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(definition.recipeChannels).toEqual([]);
    // expect(definition.inspectors?.some(
    //   (inspector) => inspector.type === "warehouse-item-link"
    // )).toBe(true);
    // expect(definition.placementDefaults?.slotLinks?.[0]?.target?.slotId).toBe("item_gas_inert");

    // AI-REMOVED 2026-07-16:
    // Reason: 气体收集泵已按当前注册表定义气体输出端口和缓冲槽，空壳约束属于测试漂移。
    // Trigger: 用户确认问题 2 为测试漂移并要求移除这项旧断言。
    // Evidence: gas_pump_1 当前包含 gas_output 端口组和 gas_output_buffer 储存组。
    // Replacement: None；本用例继续验证尺寸、百科分类和可摆放标签。
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
    expect(gasMode.recipeChannels.find((channel) => channel.type === "normal-channel")).toMatchObject({
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
    expect(solidMode.recipeChannels.find((channel) => channel.type === "normal-channel")).toMatchObject({
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

  it("defines gas reactor as gas-only east input and west output", () => {
    const definition = requireEntity("gas_reactor_1");
    const gasInput = requirePortGroup(definition, "gas_input");
    const gasOutput = requirePortGroup(definition, "gas_output");

    expect(definition.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(gasInput, [
      { id: "in_w_1", localCellX: 4, localCellY: 3, edge: "EAST" },
      { id: "in_w_3", localCellX: 4, localCellY: 1, edge: "EAST" },
    ]);
    expectPortLayout(gasOutput, [
      { id: "out_e_1", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "out_e_3", localCellX: 0, localCellY: 1, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectGasOnlyPorts(gasOutput);
    expect(definition.storageSlotGroups.map((slotGroup) => ({
      id: slotGroup.id,
      kind: slotGroup.kind,
      itemFilterType: slotGroup.slots[0]?.itemFilterType,
      capacity: slotGroup.slots[0]?.capacity,
    }))).toEqual([
      {
        id: "gas_input_buffer",
        kind: FluidDomain,
        itemFilterType: ItemDomainFlag.Gas,
        capacity: 50,
      },
      {
        id: "gas_output_buffer",
        kind: FluidDomain,
        itemFilterType: ItemDomainFlag.Gas,
        capacity: 50,
      },
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
      { id: "in_s_1", localCellX: 4, localCellY: 3, edge: "EAST" },
      { id: "in_s_3", localCellX: 4, localCellY: 1, edge: "EAST" },
    ]);
    expectPortLayout(fluidOutput, [
      { id: "out_n_1", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "out_n_3", localCellX: 0, localCellY: 1, edge: "WEST" },
    ]);
    expectFluidBasePorts(fluidInput);
    expectFluidBasePorts(fluidOutput);
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_inert");
    expect(fluidOutput.ports.flatMap((port) => port.acceptRule.exclude)).not.toContain("item_gas_xiranite");
    expect(definition.storageSlotGroups[0]).toMatchObject({
      id: "fluid_input_buffer",
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
    });
    expect(definition.storageSlotGroups[1]).toMatchObject({
      id: "fluid_output_buffer",
      kind: FluidDomain,
      slots: [
        { capacity: 50, itemFilterType: FluidDomain },
        { capacity: 50, itemFilterType: FluidDomain },
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
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
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
      kind: FluidDomain,
      slots: [{ capacity: 50, itemFilterType: FluidDomain }],
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
