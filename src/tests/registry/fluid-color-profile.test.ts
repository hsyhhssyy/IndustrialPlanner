// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { ITEM_FLUID_COLOR_SOURCE_URL } from "@/registry/item-definition";

// AI-REMOVED 2026-09-19:
// Reason: 常规测试不再读取仓库内的网站展开原件与收据。
// Trigger: 用户要求原件只存在于 .temp/.trash 导入批次。
// Evidence: import-building-assets validate 在应用前逐项对账配色；运行时只消费 Registry fluidColors。
// Replacement: 下方验证固定网站 URL、相态所需颜色层和颜色格式。
// Risk: 普通 Vitest 不再独立比较上游原始字节；导入批次承担该检查。
// Human Review: Required
//
// Original code:
// import { createHash } from "node:crypto";
// import { readFile } from "node:fs/promises";
// import path from "node:path";
// const SOURCE_RECEIPT = `${ITEM_FLUID_COLOR_SOURCE_PATH.slice(0, ITEM_FLUID_COLOR_SOURCE_PATH.indexOf("/buildings/"))}/_import/source-receipt.json`;
// interface SourceFluidProfile { readonly phase: "liquid" | "gas"; readonly colors: Readonly<Record<string, { readonly hex: string }>>; }
// interface FluidProfileSourceReceipt { readonly releaseId: string; readonly files: readonly { readonly path: string; readonly sha256: string }[]; }

describe("Registry 流体配色档案", () => {
  it("记录网站来源，并为每种流体相态保留完整运行时颜色层", () => {
    expect(ITEM_FLUID_COLOR_SOURCE_URL).toBe(
      "https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/buildings/logistics/fluid-profiles.json",
    );
    const registry = createRegistryContract();
    const registryFluids = registry.itemDefinitions.filter((item) =>
      item.tags.includes("liquid") || item.tags.includes("gas")
    );
    expect(registryFluids.length).toBeGreaterThan(0);

    for (const item of registryFluids) {
      const roles = item.tags.includes("gas") ? ["body", "skin"] : ["body", "skin", "skin2", "splash"];
      expect(Object.keys(item.fluidColors ?? {}).sort(), item.id).toEqual([...roles].sort());
      expect(Object.values(item.fluidColors ?? {}).every((color) => /^#[0-9a-f]{6}$/.test(color)), item.id).toBe(true);
      expect(item.tags.some((tag) => /^(?:gas_color|fluid_color|liquid_color):/.test(tag)), item.id)
        .toBe(false);
    }
  });
});
