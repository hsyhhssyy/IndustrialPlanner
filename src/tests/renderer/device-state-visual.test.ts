import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { resolveDeviceBodyPresentation } from "@/renderer/sprites/device-texture-key";

const plot = createRegistryContract().queries.findEntityDefinition("soil_grass_1")!;

describe("设备状态静态外观", () => {
  it("积水使用独立本体与遮罩，不依赖动画开关", () => {
    const presentation = resolveDeviceBodyPresentation(plot, null, { forceBlueprint: false, allowAnimation: false, visualKey: "irrigated" });
    expect(presentation.bodyTextureKey).toBe("device-sprite-soil_grass_1--irrigated");
    expect(presentation.maskTextureKey).toBe("device-masks-soil_grass_1--irrigated");
    expect(presentation.animation).toBeNull();
    expect(resolveDeviceBodyPresentation(plot, null, { forceBlueprint: false, allowAnimation: false, visualKey: null }).bodyTextureKey).toBe("device-sprite-soil_grass_1");
  });
  it("蓝图样式继续显示统一蓝图素材", () => {
    expect(resolveDeviceBodyPresentation(plot, null, { forceBlueprint: true, allowAnimation: false, visualKey: "irrigated" }).bodyTextureKey).toBe("blueprint-sprite-soil_grass_1");
  });
});
