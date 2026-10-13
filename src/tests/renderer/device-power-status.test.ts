import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { shouldShowPowerDisconnectedIcon } from "@/renderer/sprites/device-power-status";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";
import { getBlueprintEntityArray, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";

const registry = createRegistryContract();
const entities = getBlueprintEntityArray(loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/collections/renderer/device-power-status/scene-01-variant-1.schema7.json",
));
const poweredIds = collectPoweredEntityIds(entities, registry.entityDefinitions);

describe("设备断电图标", () => {
  it.each([
    ["reactor-unpowered", true],
    ["reactor-powered", false],
    ["storage-disabled", false],
    ["storage-enabled", true],
    ["storage-powered", false],
    ["power", false],
    ["belt", false],
  ])("按真实供电覆盖和设备配置判断 %s", (entityId, expected) => {
    const entity = entities.find((item) => item.id === entityId)!;
    const definition = registry.entityDefinitions.find((item) => item.id === entity.definitionId)!;

    expect(shouldShowPowerDisconnectedIcon({
      definition,
      config: entity.config,
      isInPowerRange: poweredIds.has(entity.id),
    })).toBe(expected);
  });

  it("协议储存箱关闭定时上传后立即隐藏图标，重新开启后恢复", () => {
    const entity = entities.find((item) => item.id === "storage-enabled")!;
    const definition = registry.entityDefinitions.find((item) => item.id === entity.definitionId)!;
    const options = { definition, config: entity.config, isInPowerRange: false };

    expect(shouldShowPowerDisconnectedIcon(options)).toBe(true);
    expect(shouldShowPowerDisconnectedIcon({ ...options, config: { channelRecipes: {} } })).toBe(false);
    expect(shouldShowPowerDisconnectedIcon(options)).toBe(true);
  });

  it("无有效定时上传配置时，协议储存箱不显示断电图标", () => {
    const definition = registry.entityDefinitions.find((item) => item.id === "storager_1")!;
    for (const channelRecipes of [null, false, "r_warehouse_submit", {}, { warehouse_submit: "" }]) {
      expect(shouldShowPowerDisconnectedIcon({
        definition,
        config: { channelRecipes },
        isInPowerRange: false,
      })).toBe(false);
    }
  });
});
