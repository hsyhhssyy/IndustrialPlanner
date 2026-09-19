import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

describe("protocol core definitions", () => {
  it("keeps the primary and secondary protocol cores functionally identical", () => {
    const registry = createRegistryContract();
    const primary = registry.queries.findEntityDefinition("sp_hub_1");
    const secondary = registry.queries.findEntityDefinition("sp_sub_hub_1");

    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
    expect(registry.queries.isProtocolCore("sp_hub_1")).toBe(true);
    expect(registry.queries.isProtocolCore("sp_sub_hub_1")).toBe(true);
    expect(secondary).toEqual({
      ...primary,
      id: "sp_sub_hub_1",
      nameKey: "registry.entity.sp_sub_hub_1.name",
      spriteId: "item_port_sp_sub_hub_1",
      iconPath: "device-icons/item_port_sp_sub_hub_1.webp",
      spriteOffset: { topView: { x: -1, y: 0, width: 11, height: 9 } },
    });
  });
});
