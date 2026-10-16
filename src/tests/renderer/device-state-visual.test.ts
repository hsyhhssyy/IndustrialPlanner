import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { resolveDeviceBodyPresentation } from "@/renderer/sprites/device-texture-key";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const plot = createRegistryContract().queries.findEntityDefinition("soil_grass_1")!;

describe("设备状态静态外观", () => {
  it("22种田块与优质状态具有独立静态回退，遮罩覆盖一致", async () => {
    const phases = JSON.parse(await readFile("resources/building-state-visuals.json", "utf8"));
    for (const [id, mapping] of Object.entries(phases) as [string, Record<string, string>][]) {
      const definition = createRegistryContract().queries.findEntityDefinition(id)!;
      for (const state of definition.stateMachine!.states) {
        const phase = state.visualKey === undefined ? "mature" : mapping[state.visualKey];
        if (state.id === "seedling") expect(phase).toBe("empty");
        else if (state.id === "watering-1") expect(phase).toBe("seedling");
        else if (state.id.startsWith("watering-") || state.id === "harvest") expect(phase).toBe("mature");
        else if (state.id === "growing-refined") expect(phase).toBe("variant_water");
        else if (state.id === "harvest-refined") expect(phase).toBe("variant");
        else if (state.id === "growing-1") expect(phase).toBe("seedling_water");
        else expect(phase).toBe("mature_water");
      }
      for (const key of Object.keys(mapping)) {
        const spriteId = `${definition.spriteId}--${key}`;
        const color = await sharp(`public/3d-top-view/sprites/${spriteId}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const mask = await sharp(`public/3d-top-view/sprite-masks/${spriteId}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const size = definition.id === "soil_corp_sugarcane_1" ? 384 : 256;
        expect([color.info.width, color.info.height, mask.info.width, mask.info.height]).toEqual([size, size, size, size]);
        for (let index = 0; index < color.info.width * color.info.height; index++) {
          if (color.data[index * 4 + 3] !== mask.data[index * 4]) throw new Error(`状态遮罩错位：${spriteId}/${index}`);
        }
      }
    }
  });
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
