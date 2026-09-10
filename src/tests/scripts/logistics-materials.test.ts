// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { LogisticsDynamicManifest, LogisticsStaticManifest } from "@/shared/logistics-material";
// @ts-expect-error Node mjs 发布入口直接复用，与既有素材生成测试一致。
import { publishLogisticsMaterials } from "../../scripts/publish-logistics-materials.mjs";

describe("物流素材离线发布", () => {
  it("覆盖全部颜色和形状，支架三个分层统一旋转90度，数据纹理字节无损", async () => {
    const parent = path.resolve(".temp/.trash");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, "logistics-assets-"));
    const registry = createRegistryContract();
    try {
      const result = await publishLogisticsMaterials({ registry,
        outputDirectory: path.join(directory, "logistics"), spriteDirectory: path.join(directory, "sprites"),
        maskDirectory: path.join(directory, "masks"),
      });
      expect(result).toMatchObject({ pages: 17, frames: 132, colors: 16, dynamicResources: 35 });
      const manifest = JSON.parse(await readFile(path.join(directory, "logistics/static/manifest.json"), "utf8")) as LogisticsStaticManifest;
      for (const frame of Object.values(manifest.frames)) {
        const page = manifest.pages[frame.page]!;
        expect(frame.rect.slice(2)).toEqual([128, 128]);
        expect(frame.rect[0] + 130).toBeLessThanOrEqual(page.width);
        expect(frame.rect[1] + 130).toBeLessThanOrEqual(page.height);
      }
      const dynamicDirectory = path.join(directory, "animations/logistics-contract2");
      const dynamic = JSON.parse(await readFile(path.join(dynamicDirectory, "manifest.json"), "utf8")) as LogisticsDynamicManifest;
      const collectionRoot = path.resolve("resources/logistics-materials/contract2");
      for (const mode of ["static", "dynamic"]) {
        const collection = JSON.parse(await readFile(path.join(collectionRoot, mode, "collection.json"), "utf8")) as { packages: { manifest: string }[] };
        for (const entry of collection.packages) {
          const manifestPath = path.join(collectionRoot, mode, entry.manifest);
          const source = JSON.parse(await readFile(manifestPath, "utf8")) as { resources: Record<string, { file: string }> };
          for (const [key, resource] of Object.entries(source.resources)) {
            const published = dynamic.resources[key];
            if (!published) continue;
            const original = path.join(path.dirname(manifestPath), resource.file);
            const output = path.join(dynamicDirectory, published.file);
            if (/^static\/pipe\.straight\.support-/.test(key)) {
              const expected = await sharp(original).rotate(90).ensureAlpha().raw().toBuffer();
              const actual = await sharp(output).ensureAlpha().raw().toBuffer();
              // lossless WebP 可清零完全透明像素的 RGB；可见颜色与 alpha 必须精确一致。
              for (let offset = 0; offset < expected.length; offset += 4) {
                expect(actual[offset + 3]).toBe(expected[offset + 3]);
                if (expected[offset + 3]) expect(actual.subarray(offset, offset + 3)).toEqual(expected.subarray(offset, offset + 3));
              }
            } else {
              expect(await readFile(output)).toEqual(await readFile(original));
            }
            if (key.endsWith("mapping")) expect(published).toMatchObject({ data: true, filter: "nearest", wrap: "clamp" });
          }
        }
      }
      const sourcePath = path.join(collectionRoot, "static/log_pipe_02_mid/top/static");
      const sourceManifest = JSON.parse(await readFile(path.join(sourcePath, "manifest.json"), "utf8")) as { resources: Record<string, { file: string }> };
      const layers = await Promise.all(["support-back", "shell", "support-middle", "support-front"].map(async (suffix) => {
        const file = sourceManifest.resources[`static/pipe.straight.${suffix}`]!.file;
        return sharp(path.join(sourcePath, file)).rotate(suffix.startsWith("support") ? 90 : 0).ensureAlpha().raw().toBuffer();
      }));
      const [back, shell, middle, front] = layers;
      const expected = await sharp(back!, { raw: { width: 128, height: 128, channels: 4 } })
        .composite([middle!, shell!, front!].map((input) => ({ input, raw: { width: 128, height: 128, channels: 4 as const } })))
        .raw().toBuffer();
      const frame = manifest.frames["pipe/empty/straight/10"]!;
      const actual = await sharp(path.join(directory, "logistics/static", manifest.pages[frame.page]!.file))
        .extract({ left: frame.rect[0], top: frame.rect[1], width: 128, height: 128 }).ensureAlpha().raw().toBuffer();
      let maxDifference = 0;
      for (let offset = 0; offset < expected.length; offset++) {
        if (offset % 4 === 3 || expected[offset - offset % 4 + 3]) maxDifference = Math.max(maxDifference, Math.abs(expected[offset]! - actual[offset]!));
      }
      expect(maxDifference).toBeLessThanOrEqual(2);
    } finally {
      const cache = sharp.cache();
      sharp.cache(false);
      try { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
      finally { sharp.cache({ memory: cache.memory.max, files: cache.files.max, items: cache.items.max }); }
    }
  }, 30_000);
});
