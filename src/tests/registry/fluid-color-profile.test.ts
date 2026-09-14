// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { ITEM_FLUID_COLOR_SOURCE_PATH } from "@/registry/item-definition";

const SOURCE_RECEIPT = `${ITEM_FLUID_COLOR_SOURCE_PATH.slice(0, ITEM_FLUID_COLOR_SOURCE_PATH.indexOf("/buildings/"))}/_import/source-receipt.json`;

interface SourceFluidProfile {
  readonly phase: "liquid" | "gas";
  readonly colors: Readonly<Record<string, { readonly hex: string }>>;
}

interface FluidProfileSourceReceipt {
  readonly releaseId: string;
  readonly root?: string;
  readonly profilePath?: string;
  readonly profileCount?: number;
  readonly phaseCounts?: Readonly<Record<"liquid" | "gas", number>>;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

describe("Registry 流体配色档案", () => {
  it("与固定美术原件的物品、相态和分层颜色完全一致", async () => {
    const receipt = JSON.parse(await readFile(SOURCE_RECEIPT, "utf8")) as FluidProfileSourceReceipt;
    const sourcePath = ITEM_FLUID_COLOR_SOURCE_PATH;
    const sourceRoot = sourcePath.slice(0, sourcePath.indexOf("/buildings/"));
    const relativeSourcePath = path.relative(sourceRoot, sourcePath);
    const sourceBytes = await readFile(sourcePath);
    const sourceEntry = receipt.files.find((entry) => entry.path === relativeSourcePath);
    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(sourceEntry?.sha256);
    expect(receipt.releaseId).toBe(path.basename(sourceRoot));

    const source = JSON.parse(sourceBytes.toString("utf8")) as {
      readonly profileCount: number;
      readonly phaseCounts: Readonly<Record<"liquid" | "gas", number>>;
      readonly itemIds: readonly string[];
      readonly fluidProfiles: Readonly<Record<string, SourceFluidProfile>>;
    };
    const registry = createRegistryContract();
    const registryFluids = registry.itemDefinitions.filter((item) =>
      item.tags.includes("liquid") || item.tags.includes("gas")
    );

    expect(source.profileCount).toBe(Object.keys(source.fluidProfiles).length);
    if (receipt.profileCount !== undefined) expect(source.profileCount).toBe(receipt.profileCount);
    if (receipt.phaseCounts !== undefined) expect(source.phaseCounts).toEqual(receipt.phaseCounts);
    expect(new Set(source.itemIds)).toEqual(new Set(Object.keys(source.fluidProfiles)));
    expect(new Set(registryFluids.map((item) => item.id))).toEqual(new Set(source.itemIds));

    for (const item of registryFluids) {
      const sourceProfile = source.fluidProfiles[item.id];
      expect(sourceProfile, item.id).toBeDefined();
      expect(sourceProfile!.phase, item.id).toBe(item.tags.includes("gas") ? "gas" : "liquid");
      expect(item.fluidColors, item.id).toEqual(Object.fromEntries(
        Object.entries(sourceProfile!.colors).map(([role, color]) => [role, color.hex]),
      ));
      expect(item.tags.some((tag) => /^(?:gas_color|fluid_color|liquid_color):/.test(tag)), item.id)
        .toBe(false);
    }
  });
});
