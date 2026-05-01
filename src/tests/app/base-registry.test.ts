import { BASE_DEFINITIONS } from "@/registry/base-definition";
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
});