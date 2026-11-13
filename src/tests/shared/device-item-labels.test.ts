import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { configuredDeviceItemIds, runningDeviceItemIds, deviceLabelEntityId } from "@/shared/device-item-labels";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";

const registry = createRegistryContract();

it("供料标签只读取输出槽组的明确仓库链接，排除缓存与跨设备链接", () => {
  const definition = registry.queries.findEntityDefinition("udpipe_unloader_1")!;
  const slotLinks: WorldDocument["slotLinks"] = ["unloader_buffer", "transport_input"].map((group, index) => ({
    id: `link-${index}`, linkType: "share-all", source: { entityId: "outlet", storageSlotGroupId: group, slotId: "slot_1" },
    target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: index ? "item_gas_acid" : "item_liquid_water" },
  }));
  expect(configuredDeviceItemIds(definition, "outlet", { slotLinks }, registry)).toEqual(["item_liquid_water"]);
  expect(configuredDeviceItemIds(definition, "other", { slotLinks }, registry)).toEqual([]);
  expect(configuredDeviceItemIds(definition, "outlet", { slotLinks: [] }, registry)).toEqual([]);
});

it("运输设备只显示运行通道的真实输出物品，空闲和输入缓存不伪装成产物", () => {
  const definition = registry.queries.findEntityDefinition("udpipe_unloader_1")!;
  const status: SimulationDeviceRuntimeStatusReadModel = { powerStatus: "no-power-needed", channelRecipes: {
    transport_1: { channelId: "transport_1", recipeId: "r_udpipe_unloader_transport_fluid_any_internal",
      state: "running", isProgressing: true, progressSeconds: 0, desiredSeconds: 1 },
  }, slotItems: [
    { storageGroupId: "unloader_buffer", slotId: "slot_1", viewRole: "output-view", itemType: "item_liquid_water", count: 1, reserved: 0, ignoreStock: false },
    { storageGroupId: "transport_input", slotId: "slot_1", viewRole: "input-view", itemType: "item_gas_acid", count: 1, reserved: 0, ignoreStock: false },
  ] };
  expect(runningDeviceItemIds(definition, status, registry)).toEqual(["item_liquid_water"]);
  expect(runningDeviceItemIds(definition, { ...status, channelRecipes: {} }, registry)).toEqual([]);
  expect(runningDeviceItemIds(definition, { ...status, slotItems: [] }, registry)).toEqual([]);
});

it("拖动虚影沿用原设备身份查标签", () => {
  const entity = { id: "ghost", originalEntityId: "actual", definitionId: "udpipe_unloader_1",
    position: { x: 0, y: 0 }, rotation: 0 as const, tags: [], config: {} };
  expect(deviceLabelEntityId(entity, "ghost")).toBe("actual");
  expect(deviceLabelEntityId(null, "new")).toBe("new");
});
