// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { LogisticsDynamicManifest, LogisticsStaticManifest } from "@/shared/logistics-material";
// @ts-expect-error Node mjs 发布入口直接复用，与既有素材生成测试一致。
import { publishLogisticsMaterials } from "../../scripts/publish-logistics-materials.mjs";

describe("物流素材离线发布", () => {
  it("文字 UV 增量规范进入集合级入口，原始图片与其他资源参数保持一致", async () => {
    const collectionRoot = path.resolve("resources/logistics-materials/contract2");
    const patchRoot = path.resolve("resources/logistics-materials/patches/pipe-text-uv-v1");
    const patch = JSON.parse(await readFile(path.join(patchRoot, "patch.json"), "utf8")) as {
      files: { file: string; sha256: string; bytes: number }[];
      unchangedWebpSha256: Record<string, string>;
    };
    for (const entry of patch.files) {
      // 美工浏览器示例按原文归档，不作为项目可执行 JavaScript。
      const archiveFile = entry.file === "dynamic.js" ? "dynamic.js.txt" : entry.file;
      const bytes = await readFile(path.join(patchRoot, archiveFile));
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
    for (const mode of ["static", "dynamic"]) {
      const bytes = await readFile(path.join(patchRoot, mode, "material-computation.json"));
      expect(await readFile(path.join(collectionRoot, mode, "log_pipe_02_mid/top", mode, "material-computation.json"))).toEqual(bytes);
      const source = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      const combined = JSON.parse(await readFile(path.join(collectionRoot, mode, "material-computation.json"), "utf8")) as Record<string, unknown>;
      // 发布器读取集合级规范；只替换包内 JSON 会使实际 Shader 保持旧版本。
      for (const key of ["sampling", "formulas", "referenceShader", "fidelity"]) expect(combined[key]).toEqual(source[key]);
      const collection = JSON.parse(await readFile(path.join(collectionRoot, mode, "collection.json"), "utf8")) as { packages: { id: string }[] };
      expect(Object.keys(combined.parametersByResourceId as object).sort()).toEqual(collection.packages.map((entry) => entry.id).sort());
    }
    for (const [file, sha256] of Object.entries(patch.unchangedWebpSha256)) {
      const mode = file.split("/")[0]!;
      const bytes = await readFile(path.join(collectionRoot, mode, "log_pipe_02_mid/top", file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
  });

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
      // gold-glow 改变了光斑公式；发布产物必须采用源规范，不能继续携带旧 Shader。
      const specification = JSON.parse(await readFile(path.join(collectionRoot, "dynamic/material-computation.json"), "utf8")) as {
        referenceShader: { vertex: string; fragment: string };
      };
      expect(dynamic.vertex).toBe(specification.referenceShader.vertex);
      expect(dynamic.fragment).toBe(specification.referenceShader.fragment);
      // 外侧柔光超出动态 mapping 的覆盖范围，静态图集必须完整保留，且不额外发布调色分层。
      for (const [shape, packageId] of [["straight", "mid"], ["left", "left"], ["right", "right"]]) {
        const staticPath = path.join(collectionRoot, `static/grid_belt_01_${packageId}/top/static`);
        const source = await sharp(path.join(staticPath, `conveyor-${shape}-static.webp`)).ensureAlpha().raw().toBuffer();
        const mapping = await sharp(path.join(collectionRoot, `dynamic/grid_belt_01_${packageId}/top/dynamic/conveyor-${shape}-mapping.webp`))
          .ensureAlpha().raw().toBuffer();
        const beltFrame = manifest.frames[`belt/${shape}`]!;
        const published = await sharp(path.join(directory, "logistics/static", manifest.pages[beltFrame.page]!.file))
          .extract({ left: beltFrame.rect[0], top: beltFrame.rect[1], width: 128, height: 128 }).ensureAlpha().raw().toBuffer();
        let outsideGlowPixels = 0;
        for (let offset = 0; offset < source.length; offset += 4) {
          expect(published[offset + 3]).toBe(source[offset + 3]);
          if (source[offset + 3]) expect(published.subarray(offset, offset + 3)).toEqual(source.subarray(offset, offset + 3));
          if (source[offset + 3]! > 0 && mapping[offset + 3] === 0) outsideGlowPixels++;
        }
        expect(outsideGlowPixels).toBeGreaterThan(0);
        for (const layer of ["surface", "edge-glow", "edge-core", "arrow-static"]) {
          expect(dynamic.resources[`static/conveyor.${shape}.${layer}`]).toBeUndefined();
        }
      }
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
