import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";

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

  it("defines gas collection pump as a hidden 3x3 gas gathering machine shell", () => {
    const definition = requireEntity("gas_pump_1");

    expect(definition.footprint).toEqual({ width: 3, height: 3 });
    expect(definition.uiGroup).toBe("resourcePower");
    expect(definition.tags).toContain("不可摆放");
    expect(definition.portGroups).toEqual([]);
    expect(definition.storageSlotGroups).toEqual([]);
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
      { id: "out_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expect(gasMode.recipeChannels[0]).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["gas_output_buffer"],
    });

    const gasInput = requirePortGroup(solidMode, "gas_input");
    expectPortLayout(gasInput, [
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
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
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectLiquidOnlyPorts(liquidInput);
    expectPortLayout(gasOutput, [
      { id: "out_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectGasOnlyPorts(gasOutput);
    expectPortLayout(gasInput, [
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
    ]);
    expectGasOnlyPorts(gasInput);
    expectPortLayout(liquidOutput, [
      { id: "out_e_1", localCellX: 4, localCellY: 1, edge: "EAST" },
      { id: "out_e_3", localCellX: 4, localCellY: 3, edge: "EAST" },
    ]);
    expectLiquidOnlyPorts(liquidOutput);
  });

  it("defines gas reactor as gas-only north input and south output", () => {
    const definition = requireEntity("item_port_gas_reactor_1");
    const gasInput = requirePortGroup(definition, "gas_input");
    const gasOutput = requirePortGroup(definition, "gas_output");

    expect(definition.footprint).toEqual({ width: 5, height: 5 });
    expectPortLayout(gasInput, [
      { id: "in_n_1", localCellX: 1, localCellY: 0, edge: "NORTH" },
      { id: "in_n_3", localCellX: 3, localCellY: 0, edge: "NORTH" },
    ]);
    expectPortLayout(gasOutput, [
      { id: "out_s_1", localCellX: 1, localCellY: 4, edge: "SOUTH" },
      { id: "out_s_3", localCellX: 3, localCellY: 4, edge: "SOUTH" },
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

  it("makes liquid purifier pipe ports and buffers accept fluid while keeping solid inputs", () => {
    const definition = requireEntity("item_port_liquid_purifier_1");
    const itemInput = requirePortGroup(definition, "item_input");
    const fluidInput = requirePortGroup(definition, "fluid_input");
    const fluidOutput = requirePortGroup(definition, "fluid_output");

    expectPortLayout(itemInput, [
      { id: "in_w_0", localCellX: 0, localCellY: 0, edge: "WEST" },
      { id: "in_w_1", localCellX: 0, localCellY: 1, edge: "WEST" },
      { id: "in_w_2", localCellX: 0, localCellY: 2, edge: "WEST" },
      { id: "in_w_3", localCellX: 0, localCellY: 3, edge: "WEST" },
      { id: "in_w_4", localCellX: 0, localCellY: 4, edge: "WEST" },
    ]);
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
    expect(definition.storageSlotGroups.map((slotGroup) => slotGroup.id)).toEqual([
      "fluid_input_buffer",
      "fluid_output_buffer",
      "item_input_buffer",
    ]);
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
    expect(definition.storageSlotGroups[2]).toMatchObject({
      id: "item_input_buffer",
      kind: "item",
      slots: [{ capacity: 50, itemFilterType: "solid" }],
    });
    expect(definition.recipeChannels[0]?.ingredientStorageGroupIds).toEqual([
      "fluid_input_buffer",
      "item_input_buffer",
    ]);
  });
});
