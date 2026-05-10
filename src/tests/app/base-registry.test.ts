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

  it("mounts slot-config inspectors on every recipe machine input storage group", () => {
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

      const inputStorageSlotGroupIndexes = definition.storageSlotGroups
        .flatMap((storageSlotGroup, storageSlotGroupIndex) =>
          storageSlotGroup.role === "input" ? [storageSlotGroupIndex] : [],
        );

      expect(inputStorageSlotGroupIndexes.length, `${machineId} must have input storage slot groups`).toBeGreaterThan(0);

      for (const storageSlotGroupIndex of inputStorageSlotGroupIndexes) {
        const targetPath = `storageSlotGroups[${storageSlotGroupIndex}].slots`;
        const matchedInspectors = definition.inspectors.filter((inspector) =>
          inspector.type === INSPECTOR_TYPE.slotConfig
          && inspector.targetPath === targetPath
        );

        expect(matchedInspectors, `${machineId} must expose ${targetPath}`).toHaveLength(1);
      }
    }
  });
});
