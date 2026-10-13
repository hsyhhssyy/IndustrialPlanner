import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { getBlueprintEntityArray, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";

const registry = createRegistryContract();
const entities = getBlueprintEntityArray(loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/collections/renderer/device-power-status/scene-01-variant-1.schema7.json",
));

describe("Registry 断电提示启用规则", () => {
  it.each([
    ["reactor-unpowered", true],
    ["reactor-powered", true],
    ["storage-disabled", false],
    ["storage-enabled", true],
    ["storage-powered", true],
    ["power", false],
    ["belt", false],
  ])("只按设备与配置判断 %s，不依赖供电覆盖或仿真快照", (entityId, expected) => {
    const entity = entities.find((item) => item.id === entityId)!;
    expect(registry.queries.isPowerWarningEnabled(entity.definitionId, entity.config)).toBe(expected);
  });

  it("未知设备即使带有上传配置也不启用提示", () => {
    const entity = entities.find((item) => item.id === "storage-enabled")!;
    expect(registry.queries.isPowerWarningEnabled("missing-definition", entity.config)).toBe(false);
  });

  it("上传开关配置不影响普通耗电设备，也不会让零耗电设备启用提示", () => {
    const reactor = entities.find((item) => item.id === "reactor-unpowered")!;
    const belt = entities.find((item) => item.id === "belt")!;
    const storage = entities.find((item) => item.id === "storage-enabled")!;

    expect(registry.queries.isPowerWarningEnabled(reactor.definitionId, {})).toBe(true);
    expect(registry.queries.isPowerWarningEnabled(belt.definitionId, storage.config)).toBe(false);
  });

  it("直接读取当前配置，开关变更立即生效且查询不修改配置", () => {
    const entity = entities.find((item) => item.id === "storage-enabled")!;
    const config = { channelRecipes: { warehouse_submit: "r_warehouse_submit" } };

    expect(registry.queries.isPowerWarningEnabled(entity.definitionId, config)).toBe(true);
    expect(config).toEqual({ channelRecipes: { warehouse_submit: "r_warehouse_submit" } });
    config.channelRecipes.warehouse_submit = "";
    expect(registry.queries.isPowerWarningEnabled(entity.definitionId, config)).toBe(false);
    expect(config).toEqual({ channelRecipes: { warehouse_submit: "" } });
    config.channelRecipes.warehouse_submit = "r_warehouse_submit";
    expect(registry.queries.isPowerWarningEnabled(entity.definitionId, config)).toBe(true);
  });
});
