import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createRegistryContract } from "@/registry";
import { lookupText } from "@/shared/i18n";

describe("自动农植机静态场景设备", () => {
  const registry = createRegistryContract();
  const definition = registry.queries.findEntityDefinition("int_system_farm_terminal")!;

  it("隐藏、无端口、缓存、配方、耗电或仿真行为", () => {
    expect(definition).toMatchObject({
      footprint: { width: 3, height: 3 },
      spriteOffset: {
        topView: { x: -0.5, y: -1, width: 5, height: 5 },
        blueprint: { x: -0.5, y: -1, width: 5, height: 5 },
      },
      uiGroup: "hidden",
      requiresPower: false,
      powerDemand: 0,
      portGroups: [],
      storageSlotGroups: [],
      recipeChannels: [],
      portStorageBindings: [],
      placementBehaviors: [{ type: "default-placement" }],
      placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
    });
    expect(definition.simulationBehaviors ?? []).toEqual([]);
    expect(definition.stateMachine).toBeUndefined();
    expect(definition.spriteAnimation).toBeUndefined();
    expect(registry.queries.findRecipeDefinitionsByMachine(definition.id)).toEqual([]);
    expect(lookupText("zh-CN", definition.nameKey)).toBe("自动农植机");
    expect(lookupText("en-US", definition.nameKey)).toBe("自动农植机");
  });

  it("俯视与蓝图样式均有 64px 每格的透明图片和逐像素一致的遮罩", async () => {
    for (const root of ["3d-top-view", "blueprint-view"]) {
      const color = await sharp(`public/${root}/sprites/${definition.spriteId}.webp`)
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const mask = await sharp(`public/${root}/sprite-masks/${definition.spriteId}.webp`)
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([color.info.width, color.info.height]).toEqual([320, 320]);
      expect([mask.info.width, mask.info.height]).toEqual([320, 320]);
      const alpha = Buffer.alloc(320 * 320);
      const maskAlpha = Buffer.alloc(320 * 320);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) {
        alpha[pixel] = color.data[pixel * 4 + 3]!;
        maskAlpha[pixel] = mask.data[pixel * 4]!;
        if (root === "blueprint-view" && alpha[pixel] !== 0) {
          expect([...color.data.subarray(pixel * 4, pixel * 4 + 3)]).toEqual([255, 255, 255]);
        }
      }
      expect(alpha).toEqual(maskAlpha);
      expect(alpha.some(value => value === 0)).toBe(true);
      expect(alpha.some(value => value > 0)).toBe(true);
      const centerRow = 160;
      const opaqueColumns = Array.from({ length: 320 }, (_, x) => x)
        .filter(x => alpha[centerRow * 320 + x]! > 220);
      const baseCenterX = (opaqueColumns[0]! + opaqueColumns.at(-1)! + 1) / 2 / 64;
      const offset = root === "3d-top-view" ? definition.spriteOffset!.topView! : definition.spriteOffset!.blueprint!;
      expect(baseCenterX + offset.x).toBeCloseTo(definition.footprint.width / 2, 1);
    }
  });
});
