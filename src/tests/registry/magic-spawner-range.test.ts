import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { MAGIC_SPAWNER_RANGE_DEVICE_IDS } from "@/shared/magic-spawner-range";

// 2026-11-25：相位配方归属区域附属设备，通过 ownerDeviceId 反查实际执行炉子。
const registry = createRegistryContract();

describe("明晦炉区域附属设备", () => {
  const rangeDeviceIds = [
    MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming,
    MAGIC_SPAWNER_RANGE_DEVICE_IDS.hui,
    MAGIC_SPAWNER_RANGE_DEVICE_IDS.heng,
  ];

  it("区域设备派生自明晦炉与分影明晦炉且不可放置", () => {
    for (const deviceId of ["magic_spawner_1", "magic_spawner_2"]) {
      expect(registry.queries.findDerivedDeviceDefinitions(deviceId).map((definition) => definition.id))
        .toEqual(rangeDeviceIds);
    }
    for (const deviceId of rangeDeviceIds) {
      const definition = registry.queries.findEntityDefinition(deviceId)!;
      expect(definition.derivedFromDeviceIds).toEqual(["magic_spawner_1", "magic_spawner_2"]);
      expect(definition.placementWhitelist).toEqual([]);
      expect(definition.uiGroup).toBe("hidden");
      expect(definition.recipeChannels).toEqual([]);
    }
  });

  it("相位配方按区域设备归属，按执行炉子反查", () => {
    expect(registry.queries.findRecipeDefinitionsByMachine(MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming)
      .map((recipe) => recipe.id))
      .toEqual(["r_magic_spawner_ming", "r_bipolar_magic_spawner_ming"]);
    expect(registry.queries.findRecipeDefinitionsByMachine(MAGIC_SPAWNER_RANGE_DEVICE_IDS.hui)
      .map((recipe) => recipe.id))
      .toEqual(["r_magic_spawner_hui", "r_bipolar_magic_spawner_hui"]);

    const plainScope = registry.queries.findRecipeDefinitionsByMachineScope("magic_spawner_1")
      .map((recipe) => recipe.id);
    expect(plainScope).toContain("r_magic_spawner_ming");
    expect(plainScope).toContain("r_magic_spawner_hui");
    expect(plainScope).not.toContain("r_bipolar_magic_spawner_ming");

    const bipolarScope = registry.queries.findRecipeDefinitionsByMachineScope("magic_spawner_2")
      .map((recipe) => recipe.id);
    expect(bipolarScope).toContain("r_bipolar_magic_spawner_ming");
    expect(bipolarScope).toContain("r_bipolar_magic_spawner_hui");
    expect(bipolarScope).not.toContain("r_magic_spawner_ming");
  });

  it("区域设备没有直接执行配方，设备自查只返回自身 machineId", () => {
    expect(registry.queries.findRecipeDefinitionsByMachineScope(MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming)
      .every((recipe) => recipe.machineId === MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming))
      .toBe(true);
    expect(registry.queries.findDerivedDeviceDefinitions(MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming)).toEqual([]);
  });
});
