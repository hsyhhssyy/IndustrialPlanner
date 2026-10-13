import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-10-13:
// Reason: 设备启用规则已迁入 Registry Query，原 Renderer 函数不再执行。
// Trigger: 用户确认 Registry 统一持有断电提示特例。
// Evidence: GenericDeviceSprite 已改用 isPowerWarningEnabled 与现有供电覆盖组合。
// Replacement: 下方通过真实 registry.queries.isPowerWarningEnabled 保留原场景断言。
// Risk: Low - 原断言期望值保持不变。
// Human Review: Required
//
// Original code:
// import { shouldShowPowerDisconnectedIcon } from "@/renderer/sprites/device-power-status";
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

    expect(
      registry.queries.isPowerWarningEnabled(definition.id, entity.config)
      && !poweredIds.has(entity.id),
    ).toBe(expected);
  });

  it("协议储存箱关闭定时上传后立即隐藏图标，重新开启后恢复", () => {
    const entity = entities.find((item) => item.id === "storage-enabled")!;
    const definition = registry.entityDefinitions.find((item) => item.id === entity.definitionId)!;
    const options = { definition, config: entity.config, isInPowerRange: false };

    expect(
      registry.queries.isPowerWarningEnabled(options.definition.id, options.config)
      && !options.isInPowerRange,
    ).toBe(true);
    expect(
      registry.queries.isPowerWarningEnabled(options.definition.id, { channelRecipes: {} })
      && !options.isInPowerRange,
    ).toBe(false);
    expect(
      registry.queries.isPowerWarningEnabled(options.definition.id, options.config)
      && !options.isInPowerRange,
    ).toBe(true);
  });

  it("无有效定时上传配置时，协议储存箱不显示断电图标", () => {
    const definition = registry.entityDefinitions.find((item) => item.id === "storager_1")!;
    for (const channelRecipes of [null, false, "r_warehouse_submit", {}, { warehouse_submit: "" }]) {
      expect(registry.queries.isPowerWarningEnabled(definition.id, { channelRecipes })).toBe(false);
    }
  });
});
