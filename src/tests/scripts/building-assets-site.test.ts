// @vitest-environment node

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
// @ts-expect-error Node 发布入口由真实文件测试验证。
import { publishedImageSize, publishEffectFrames, resizeAssetRgba } from "../../scripts/building-asset-image.mjs";
// @ts-expect-error Node 发布入口由真实文件测试验证。
import { publishDeviceSprite } from "../../scripts/sync-device-sprites.mjs";
// @ts-expect-error Node 批次入口由真实文件测试验证。
import { applyWebsiteBatch, deferWebsiteLogistics, restoreWebsiteBatch } from "../../scripts/import-building-assets.mjs";
// @ts-expect-error Node 端口发布器直接复用。
import { resolveDeliveredPortVariant } from "../../scripts/publish-building-port-effects.mjs";
// @ts-expect-error Node 物流发布器直接复用。
import { publishLogisticsBaked } from "../../scripts/publish-logistics-baked.mjs";

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
  const parent = path.resolve(".temp/.trash");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "website-assets-test-"));
  try { await run(directory); }
  finally {
    sharp.cache(false);
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("网站素材批次", () => {
  it("暂缓物流时同时排除原件和发布图，并保留共享清单中的既有高度", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      const current = path.join(directory, "current");
      const stage = path.join(batch, "stage");
      const sourceRoot = "site";
      const index = JSON.stringify({ files: [] });
      const sourceSite = { siteUrl: "https://example.invalid/assets/", releaseId: "fixture", indexSha256: digest(index) };
      const put = async (file: string, value: unknown) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
      };
      await put(path.join(batch, sourceRoot, "integrity.json"), index);
      await put(path.join(batch, sourceRoot, "buildings/logistics/source.json"), "new source");
      await put(path.join(batch, "source-receipt.json"), { ...sourceSite, files: [], logistics: true });
      await put(path.join(batch, "import-plan.json"), { sourceSite, sourceRoot, logistics: true, views: [
        { buildingId: "device", view: "top", directory: "buildings/device/top" },
        { buildingId: "pipe", view: "top", directory: "buildings/logistics/pipe/top" },
      ] });
      for (const folder of ["logistics", "animations/logistics-contract2"]) {
        await put(path.join(current, "public/3d-top-view", folder, "material.webp"), "existing material");
        await put(path.join(stage, "public/3d-top-view", folder, "material.webp"), "new material");
      }
      const effects = "public/3d-top-view/port-effects";
      const oldView = { fields: { idle: { file: "old-height.rgba.bin", min: -2, max: 10 } } };
      await put(path.join(current, effects, "manifest.json"), { heightMin: 0, heightMax: 8, views: { "pipe/top": oldView } });
      await put(path.join(current, effects, "old-height.rgba.bin"), "old height");
      await put(path.join(stage, effects, "manifest.json"), { heightMin: 0, heightMax: 8, effects: {}, views: {
        "device/top": { fields: { idle: { file: "device-height.rgba.bin", min: 0, max: 8 } } },
        "pipe/top": { fields: { idle: { file: "new-height.rgba.bin", min: 0, max: 8 } } },
      } });
      await put(path.join(stage, effects, "new-height.rgba.bin"), "new height");
      await put(path.join(stage, effects, "device-height.rgba.bin"), "device height");
      await deferWebsiteLogistics(batch, current);
      const updated = JSON.parse(await readFile(path.join(stage, effects, "manifest.json"), "utf8"));
      expect(updated.views["pipe/top"]).toEqual(oldView);
      expect([updated.heightMin, updated.heightMax]).toEqual([-2, 10]);
      expect(await readFile(path.join(stage, effects, "device-height.rgba.bin"), "utf8")).toBe("device height");
      expect(await readFile(path.join(current, "public/3d-top-view/logistics/material.webp"), "utf8")).toBe("existing material");
      await expect(readFile(path.join(stage, "public/3d-top-view/logistics/material.webp"))).rejects.toThrow();
      await expect(readFile(path.join(batch, sourceRoot, "buildings/logistics/source.json"))).rejects.toThrow();
      await expect(readFile(path.join(stage, effects, "new-height.rgba.bin"))).rejects.toThrow();
      const plan = JSON.parse(await readFile(path.join(batch, "import-plan.json"), "utf8"));
      expect(plan.logistics).toBe(false);
      expect(plan.views).toHaveLength(1);
      expect(plan.retainedProducts).toEqual([{ path: `${effects}/old-height.rgba.bin`, sha256: digest("old height") }]);
    });
  });
  it("拒绝把网站展开原件写入仓库应用计划", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      await mkdir(path.join(batch, "stage"), { recursive: true });
      await writeFile(path.join(batch, "import-plan.json"), JSON.stringify({ logistics: false }));
      await writeFile(path.join(batch, "application-plan.json"), JSON.stringify([{
        path: "resources/building-assets-site/fixture/source.webp",
        sha256: digest("source"),
        previousSha256: null,
      }]));

      await expect(applyWebsiteBatch(batch)).rejects.toThrow("contains website source payload");
    });
  });
  it("单视图交付按明确模式选择唯一模板，多个候选或模式冲突必须拒绝", () => {
    const variant = { rendererTemplateKey: "liquid__0", machineModeType: "liquid" };
    const ports = { deliveryVariantSelection: "single-view", deliveryMode: "liquid", deliveryVariantKeys: ["source-view-id"], variants: [variant] };
    expect(resolveDeliveredPortVariant(ports, "source-view-id")).toBe(variant);
    expect(resolveDeliveredPortVariant(ports, "liquid__0")).toBe(variant);
    expect(resolveDeliveredPortVariant({ ...ports, deliveryMode: "gas" }, "source-view-id")).toBeNull();
    expect(resolveDeliveredPortVariant({ ...ports, variants: [variant, { ...variant, rendererTemplateKey: "liquid__1" }] }, "source-view-id")).toBeNull();
    expect(resolveDeliveredPortVariant(ports, "unlisted-id")).toBeNull();
  });
  it("同份原件一次生成半尺寸和四分之一静态图及遮罩", async () => {
    await fixture(async (directory) => {
      const source = path.join(directory, "source.webp");
      await sharp({ create: { width: 8, height: 4, channels: 4, background: { r: 32, g: 64, b: 128, alpha: 0.5 } } })
        .webp({ lossless: true }).toFile(source);
      const original = await readFile(source);
      for (const resolution of [0.5, 0.25]) {
        const sprite = path.join(directory, `${resolution}/sprite.webp`);
        const mask = path.join(directory, `${resolution}/mask.webp`);
        await publishDeviceSprite(source, sprite, mask, path.join(directory, "missing.webp"), 0, { resolution });
        for (const image of [sprite, mask]) expect(await sharp(image).metadata()).toMatchObject({ width: 8 * resolution, height: 4 * resolution });
      }
      expect(await readFile(source)).toEqual(original);
    });
  });

  it("64px 静态原件发布到 64px 目标时不重复缩小", async () => {
    await fixture(async (directory) => {
      const source = path.join(directory, "source.webp");
      await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 32, g: 64, b: 128, alpha: 1 } } })
        .webp({ lossless: true }).toFile(source);
      const sprite = path.join(directory, "sprite.webp");
      const mask = path.join(directory, "mask.webp");
      await publishDeviceSprite(source, sprite, mask, path.join(directory, "missing.webp"), 0,
        { sourceResolution: 0.5, resolution: 0.5 });
      expect(await sharp(sprite).metadata()).toMatchObject({ width: 64, height: 32 });
      expect(await sharp(mask).metadata()).toMatchObject({ width: 64, height: 32 });
    });
  });

  it("数值图整字节取最近样本，裁切边界补透明像素而不改变采样密度", async () => {
    const pixels = Buffer.alloc(5 * 4 * 4);
    for (let i = 0; i < 20; i++) pixels.set([i, 255 - i, 0, 255], i * 4);
    const scaled = await resizeAssetRgba(pixels, 5, 4, 0.5, true, true);
    expect([scaled.width, scaled.height]).toEqual([3, 2]);
    expect([...scaled.data]).toEqual([6, 249, 0, 255, 8, 247, 0, 255, 0, 0, 0, 0,
      16, 239, 0, 255, 18, 237, 0, 255, 0, 0, 0, 0]);
    expect(publishedImageSize(165, 74, 0.5, true)).toEqual({ width: 83, height: 37 });
    expect(publishedImageSize(165, 74, 0.25, true)).toEqual({ width: 42, height: 19 });
    expect(() => publishedImageSize(165, 74, 0.5)).toThrow();
    expect(() => publishedImageSize(2.5, 4, 0.5, true)).toThrow();
  });

  it.each([0.5, 0.25].flatMap((resolution) => [[165, 74], [100, 29], [31, 29], [128, 128]]
    .map(([width, height]) => ({ resolution, width: width!, height: height! }))))(
    "颜色图 $width×$height 按 $resolution 先补透明边再缩放，实际行宽与声明一致", async ({ width, height, resolution }) => {
      const pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        pixels.set([x % 256, y * 7 % 256, (x + y) * 3 % 256, 64 + (x * 5 + y * 11) % 192], (y * width + x) * 4);
      }
      const original = Buffer.from(pixels);
      const targetWidth = Math.ceil(width * resolution), targetHeight = Math.ceil(height * resolution);
      const paddedWidth = targetWidth / resolution, paddedHeight = targetHeight / resolution;
      // 独立按行复制原像素构造期望输入，禁止复用发布器或 Sharp extend/resize 链。
      const padded = Buffer.alloc(paddedWidth * paddedHeight * 4);
      for (let y = 0; y < height; y++) pixels.copy(padded, y * paddedWidth * 4, y * width * 4, (y + 1) * width * 4);
      const expected = await sharp(padded, { raw: { width: paddedWidth, height: paddedHeight, channels: 4 } })
        .resize(targetWidth, targetHeight, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
      const actual = await resizeAssetRgba(pixels, width, height, resolution, false, true);
      expect(expected.info).toMatchObject({ width: targetWidth, height: targetHeight, channels: 4 });
      expect([actual.width, actual.height, actual.data.length]).toEqual([targetWidth, targetHeight, targetWidth * targetHeight * 4]);
      expect(actual.data.equals(expected.data)).toBe(true);
      expect(pixels.equals(original)).toBe(true);
    },
  );

  it("64px 奇数宽特效按半像素 physicalRect 补透明边，避免相邻帧颜色混入", async () => {
    await fixture(async (directory) => {
      const sourceRoot = path.join(directory, "source");
      const outputRoot = path.join(directory, "output");
      await mkdir(path.join(sourceRoot, "buildings/effect"), { recursive: true });
      const pixels = Buffer.alloc(5 * 2 * 4);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 5; x++) {
        pixels.set(x < 2 ? [255, 0, 0, 255] : x === 2 ? [255, 0, 255, 255] : [0, 0, 255, 255], (y * 5 + x) * 4);
      }
      await sharp(pixels, { raw: { width: 5, height: 2, channels: 4 } }).webp({ lossless: true })
        .toFile(path.join(sourceRoot, "buildings/effect/source.webp"));
      const effect = { frames: [
        { page: 0, x: 0, y: 0, width: 5, height: 4, durationMs: 33, physicalRect: [0, 0, 2.5, 2] },
        { page: 0, x: 5, y: 0, width: 5, height: 4, durationMs: 1340, physicalRect: [2.5, 0, 2.5, 2] },
      ] };
      const sheet = { pages: [{ image: "source.webp", width: 5, height: 2 }] };
      const result = await publishEffectFrames({ sourceRoot, outputRoot, directory: "buildings/effect", effect, sheet,
        sourceResolution: 0.5, resolution: 0.5, flipVertical: true });
      expect(result.frames).toEqual([
        { page: 0, x: 0, y: 0, width: 3, height: 2, durationMs: 33 },
        { page: 0, x: 3, y: 0, width: 3, height: 2, durationMs: 1340 },
      ]);
      const rgba = await sharp(path.join(outputRoot, result.pages[0].file)).ensureAlpha().raw().toBuffer();
      expect(rgba[2]).toBe(0);
      expect(rgba[2 * 4 + 3]).toBe(0);
      expect(rgba[3 * 4 + 3]).toBe(0);
      expect(rgba[4 * 4 + 2]).toBeGreaterThan(200);
    });
  });

  it("64px 烘焙物流保留网站物理图集并生成 64px 静态回退", async () => {
    await fixture(async (directory) => {
      const sourceDirectory = path.join(directory, "source");
      const outputDirectory = path.join(directory, "output");
      const spriteDirectory = path.join(directory, "sprites");
      const maskDirectory = path.join(directory, "masks");
      await mkdir(path.join(sourceDirectory, "baked"), { recursive: true });
      const page = await sharp({ create: { width: 64, height: 64, channels: 4,
        background: { r: 80, g: 120, b: 160, alpha: 0.75 } } }).webp({ lossless: true }).toBuffer();
      const field = await sharp({ create: { width: 4, height: 4, channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 } } }).webp({ lossless: true }).toBuffer();
      await writeFile(path.join(sourceDirectory, "baked/static.webp"), page);
      await writeFile(path.join(sourceDirectory, "baked/fluid-field.webp"), field);
      const staticNames = [
        ...["straight", "left", "right"].flatMap((shape) => [
          `conveyor.${shape}.static`,
          `pipe.${shape}.support-back`,
          `pipe.${shape}.support-middle`,
          `pipe.${shape}.shell`,
          `pipe.${shape}.static-chevron`,
          `pipe.${shape}.support-front`,
        ]),
        "conveyor.straight.base",
        "pipe.straight.static-logo-glow",
        "pipe.straight.static-logo-core",
      ];
      const clips = Object.fromEntries([
        ...["straight", "left", "right"].flatMap((shape) => [
          `conveyor/${shape}/highlight`, `conveyor/${shape}/arrow`,
        ]),
        ...["straight", "left", "right"].map((shape) => `pipe/${shape}/chevron`),
      ].map((clip) => [clip, { phaseSamples: 1, frames: [`dynamic/${clip}`] }]));
      const frame = {
        page: "static-0", rect: [0, 0, 128, 128], physicalRect: [0, 0, 64, 64], rotated: false,
        sourceSize: [128, 128], spriteSourceSize: [0, 0, 128, 128],
      };
      const frames = Object.fromEntries([
        ...staticNames.map((name) => [`static/${name}`, frame]),
        ...Object.keys(clips).map((clip) => [`dynamic/${clip}`, frame]),
      ]);
      const manifest = {
        schemaVersion: 2,
        format: "logistics-spritesheet-v2",
        pixelsPerCell: 128,
        textureProfile: { pixelsPerCell: 64, logicalPixelsPerCell: 128, resolution: 0.5 },
        pages: {
          "static-0": { file: "baked/static.webp", width: 64, height: 64, bytes: page.length,
            sha256: digest(page), group: "static", filter: "linear" },
          "fluid-field": { file: "baked/fluid-field.webp", width: 4, height: 4, bytes: field.length,
            sha256: digest(field), group: "fluid-field", filter: "nearest" },
        },
        frames,
        clips,
        staticResources: Object.fromEntries(staticNames.map((name) => [name, { frame: `static/${name}` }])),
        parametersByResourceId: {
          grid_belt_01_mid: { arrowSpeed: 1, flowSpeed: 1, timeOffset: 1, flowSpace: 1 },
          grid_belt_01_left: { arrowSpeed: 1, flowSpeed: 1, timeOffset: 1, flowSpace: 1 },
          grid_belt_01_right: { arrowSpeed: 1, flowSpeed: 1, timeOffset: 1, flowSpace: 1 },
          log_pipe_02_mid: { waterDirection: 1, flowOffset: 1, staticDensity: 1,
            flowDensity: 1, flowSpeed: 1 },
        },
        cycle: { fillCellsPerSecond: 1, drainDuration: 1, refillDuration: 1, edgeWidth: 1 },
        fluidPlayback: { kind: "baked-spatial-field-v2", referenceShader: { vertex: "void main(){}",
          fragment: "void main(){}" } },
        endpointConnector: { composite: "source-over", whitening: "alpha" },
      };
      await writeFile(path.join(sourceDirectory, "logistics-baked.json"), JSON.stringify(manifest), "utf8");

      expect(await publishLogisticsBaked({ sourceDirectory, outputDirectory, spriteDirectory, maskDirectory,
        sourceResolution: 0.5, resolution: 0.5, sourceSite: { releaseId: "fixture" } }))
        .toMatchObject({ pages: 2, resolution: 0.5 });

      const output = JSON.parse(await readFile(path.join(outputDirectory, "baked/manifest.json"), "utf8"));
      expect(output).toMatchObject({ sourceResolution: 0.5, resolution: 0.5, pixelsPerCell: 64 });
      expect(output.clips).not.toHaveProperty("pipe/straight/pattern");
      expect(output.staticResources).toHaveProperty("pipe.straight.static-logo-glow");
      expect(output.pages["static-0"]).toMatchObject({ width: 64, height: 64, filter: "linear" });
      expect(output.pages["fluid-field"]).toMatchObject({ width: 4, height: 4, filter: "nearest", data: true });
      expect(await sharp(path.join(outputDirectory, "baked", output.pages["static-0"].file)).metadata())
        .toMatchObject({ width: 64, height: 64 });
      expect(await sharp(path.join(outputDirectory, "static/baked-static.webp")).metadata())
        .toMatchObject({ width: 272 });
      for (const file of ["belt_straight_1x1.webp", "belt_turn_cw_1x1.webp", "belt_turn_ccw_1x1.webp",
        "pipe_straight_1x1.webp", "pipe_turn_cw_1x1.webp", "pipe_turn_ccw_1x1.webp"]) {
        expect(await sharp(path.join(spriteDirectory, file)).metadata()).toMatchObject({ width: 64, height: 64 });
        expect(await sharp(path.join(maskDirectory, file)).metadata()).toMatchObject({ width: 64, height: 64 });
      }
      // 新管壳可独立升级；旧液体 Shader、数值场、时序及来源必须成组保留。
      output.pages['fluid-data'] = output.pages['fluid-field'];
      output.pages['gas-field'] = output.pages['fluid-field'];
      await writeFile(path.join(outputDirectory, 'baked/manifest.json'), JSON.stringify(output));
      const tinted = Object.fromEntries(Object.entries(clips).map(([key, clip]) => [key,
        key.startsWith('conveyor/') ? { ...clip, tintFrames: [`tint/${key}`] } : clip]));
      const upgraded = { ...manifest, clips: tinted,
        frames: { ...frames, ...Object.fromEntries(Object.keys(clips).map((key) => [`tint/${key}`, frame])),
          ...Object.fromEntries(['straight', 'left', 'right'].flatMap((shape) =>
            [`static/pipe.${shape}.body-mask`, `static/conveyor.${shape}.surface-tint`].map((key) => [key, frame]))) },
        staticResources: { ...manifest.staticResources, ...Object.fromEntries(['straight', 'left', 'right'].flatMap((shape) =>
          [`static/pipe.${shape}.body-mask`, `static/conveyor.${shape}.surface-tint`].map((key) => [key, { frame: key }]))) },
        tintableConveyor: { straight: {}, left: {}, right: {} },
        fluidPlayback: { kind: 'baked-spatial-field-v2', referenceShader: { vertex: 'new', fragment: 'uniform sampler2D uWater;' } },
      };
      await writeFile(path.join(sourceDirectory, 'logistics-baked.json'), JSON.stringify(upgraded));
      const next = path.join(directory, 'next');
      await publishLogisticsBaked({ sourceDirectory, outputDirectory: next, spriteDirectory, maskDirectory,
        sourceResolution: .5, resolution: .5, sourceSite: { releaseId: 'new' }, fluidPlaybackDirectory: path.join(outputDirectory, 'baked') });
      const published = JSON.parse(await readFile(path.join(next, 'baked/manifest.json'), 'utf8'));
      expect(published.fluidPlayback).toEqual(output.fluidPlayback);
      expect(published.fluidSourceSite.releaseId).toBe('fixture');
      expect(published.sourceSite.releaseId).toBe('new');
      expect(published.pages['fluid-data']).toEqual(output.pages['fluid-data']);
      expect(published.pages).not.toHaveProperty('fluid-field');
      expect(published.frames).toHaveProperty('tint/conveyor/straight/arrow');
      expect(published.frames['ui/hover/left'].sourceSize).toEqual([64, 64]);
      const retained = await readFile(path.join(next, 'baked', published.pages['fluid-data'].file));
      expect(digest(retained)).toBe(output.pages['fluid-data'].sha256);

    });
  });

  it("应用失败自动恢复之前写入的用户文件，随后可核查恢复记录", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      const destination = path.join(directory, "destination");
      await mkdir(path.join(batch, "stage/blocked"), { recursive: true });
      await mkdir(path.join(destination, "blocked"), { recursive: true });
      await writeFile(path.join(destination, "existing.txt"), "user edit");
      await writeFile(path.join(batch, "stage/existing.txt"), "published");
      await writeFile(path.join(batch, "stage/blocked/new.txt"), "new");
      await writeFile(path.join(batch, "application-plan.json"), JSON.stringify([
        { path: "existing.txt", previousSha256: digest("user edit"), sha256: digest("published") },
        { path: "blocked/new.txt", previousSha256: null, sha256: digest("new") },
      ]));
      await chmod(path.join(destination, "blocked"), 0o500);
      try { await expect(applyWebsiteBatch(batch, destination)).rejects.toThrow(); }
      finally { await chmod(path.join(destination, "blocked"), 0o700); }
      expect(await readFile(path.join(destination, "existing.txt"), "utf8")).toBe("user edit");
      expect(JSON.parse(await readFile(path.join(batch, "apply-journal.json"), "utf8")).status).toBe("restored");
      expect(await readFile(path.join(batch, "backup/existing.txt"), "utf8")).toBe("user edit");
      await restoreWebsiteBatch(batch, destination);
    });
  });

  it("验收后目的文件发生变化时拒绝应用，不覆盖新编辑", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      const destination = path.join(directory, "destination");
      await mkdir(path.join(batch, "stage"), { recursive: true });
      await mkdir(destination);
      await writeFile(path.join(batch, "stage/a.txt"), "new");
      await writeFile(path.join(destination, "a.txt"), "changed after validation");
      await writeFile(path.join(batch, "application-plan.json"), JSON.stringify([
        { path: "a.txt", previousSha256: digest("old"), sha256: digest("new") },
      ]));
      await expect(applyWebsiteBatch(batch, destination)).rejects.toThrow("Destination changed");
      expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("changed after validation");
    });
  });

  it("应用删除计划后可从批次备份恢复陈旧发布文件", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      const destination = path.join(directory, "destination");
      const relative = "public/3d-top-view/logistics/static/legacy.webp";
      await mkdir(path.join(batch, "stage"), { recursive: true });
      await mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
      await writeFile(path.join(destination, relative), "legacy");
      await writeFile(path.join(batch, "application-plan.json"), JSON.stringify([
        { path: relative, previousSha256: digest("legacy"), sha256: null },
      ]));

      await applyWebsiteBatch(batch, destination);
      await expect(readFile(path.join(destination, relative))).rejects.toThrow();
      expect(await readFile(path.join(batch, "backup", relative), "utf8")).toBe("legacy");

      await restoreWebsiteBatch(batch, destination);
      expect(await readFile(path.join(destination, relative), "utf8")).toBe("legacy");
    });
  });

  it("下载器拒绝目录逃逸、校验失败，并无损读取原始大整数", () => {
    const result = execFileSync("python3", ["-c", `
import runpy,sys,json,hashlib
m=runpy.run_path(sys.argv[1])
for value in ['../escape','/absolute','https://other.example/a','a%2fb','a//b','a?b']:
    try: m['validate_path'](value)
    except ValueError: pass
    else: raise AssertionError(value)
raw=b'{"pathId":9223372036854775807}'
assert json.loads(raw)['pathId']==9223372036854775807
entry={'path':'source.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
m['verify'](raw,entry)
try: m['verify'](raw+b' ',entry)
except ValueError: pass
else: raise AssertionError('invalid bytes accepted')
m['validate_texture_profile']({'pixelsPerCell':64,'logicalPixelsPerCell':128,'resolution':.5},'fixture')
try:m['validate_texture_profile']({'pixelsPerCell':128,'logicalPixelsPerCell':128,'resolution':1},'legacy')
except ValueError:pass
else:raise AssertionError('legacy 128px profile accepted')
print('verified')
`, path.resolve("src/scripts/building-assets-site-source.py")], { encoding: "utf8" });
    expect(result.trim()).toBe("verified");
  });

  it("网站动画归一化支持传统过渡与显式 status，且不会把 PORT_DISCONNECT 猜成 blocked", () => {
    const result = execFileSync("python3", ["-c", `
import runpy,sys,json
m=runpy.run_path(sys.argv[1])
legacy=m['create_status_playback']({'animations':['open','open_idle','close','close_idle']}, {k:[] for k in ['open','open_idle','close','close_idle']}, 'legacy')
assert legacy['fallbackClip']=='close_idle'
assert legacy['statusClips']=={'normal':'open_idle'}
assert legacy['openTransitionClip']=='open' and legacy['closeTransitionClip']=='close'
package={'animations':['RUNNING','CLOSED','PORT_DISCONNECT'],'statusControl':{'codes':[
  {'code':'CLOSED','statusKey':3,'animation':{'clip':'CLOSED','playing':True,'restart':True}},
  {'code':'RUNNING','statusKey':4,'animation':{'clip':'RUNNING','playing':True,'restart':True}},
  {'code':'PORT_DISCONNECT','statusKey':5,'animation':{'clip':'PORT_DISCONNECT','playing':False,'restart':True}},
]}}
explicit=m['create_status_playback'](package, {k:[] for k in package['animations']}, 'explicit')
assert explicit['fallbackClip']=='CLOSED'
assert explicit['statusClips']=={'normal':'RUNNING'}
assert 'blocked' not in explicit['statusClips']
assert explicit['sourceStatuses']['PORT_DISCONNECT']['statusKey']==5
assert m['delivery_is_animated'](package, [True,True,True]) is True
assert m['delivery_is_animated']({'animations':['close_idle']}, [False]) is True
assert m['delivery_is_animated']({'animations':['static']}, [True]) is False
try:
  m['create_status_playback']({'animations':['close_idle','CLOSED'],'statusControl':{'codes':[
    {'code':'CLOSED','statusKey':3,'animation':{'clip':'CLOSED','playing':True,'restart':True}},
  ]}}, {'close_idle':[],'CLOSED':[]}, 'ambiguous')
except ValueError: pass
else: raise AssertionError('ambiguous fallback accepted')
print(json.dumps(explicit,sort_keys=True))
`, path.resolve("src/scripts/building-assets-site-source.py")], { encoding: "utf8" });
    expect(JSON.parse(result).statusClips).toEqual({ normal: "RUNNING" });
  });

  it("两种协议核心只交付 open_idle，并把所有运行状态固定到该循环", () => {
    const result = execFileSync("python3", ["-c", `
import runpy,sys,json
m=runpy.run_path(sys.argv[1])
sources={'open_000':{'file':'open.webp'},'open_idle_000':{'file':'idle.webp'},'close_000':{'file':'close.webp'},'close_idle_000':{'file':'closed.webp'}}
clips={
  'open':[{'source':'open_000','startFrame':0,'frameCount':1}],
  'open_idle':[{'source':'open_idle_000','startFrame':0,'frameCount':2}],
  'close':[{'source':'close_000','startFrame':0,'frameCount':1}],
}
for sprite_id in ['item_port_sp_hub_1','item_port_sp_sub_hub_1']:
    delivery=m['resolve_animation_delivery']({},sources,clips,sprite_id)
    assert delivery['clipSelection']=='protocol-core-open-idle-only'
    assert set(delivery['sources'])=={'open_idle_000'}
    assert set(delivery['clips'])=={'open_idle'}
    assert delivery['playback']['fallbackClip']=='open_idle'
    assert delivery['playback']['staticClip']=='open_idle'
    assert set(delivery['playback']['statusClips'].values())=={'open_idle'}
    assert delivery['playback']['openTransitionClip'] is None
    assert delivery['playback']['closeTransitionClip'] is None
    assert delivery['playback']['clipOptions']['open_idle']=={'playing':True,'restart':False}
generic=m['resolve_animation_delivery']({'animations':['close_idle']},{'close_idle_000':sources['close_idle_000']},{'close_idle':[{'source':'close_idle_000','startFrame':0,'frameCount':1}]},'other')
assert generic['clipSelection']=='website-status-driven-phases'
try:
    m['resolve_animation_delivery']({},sources,{'open':clips['open']},'item_port_sp_hub_1')
except ValueError: pass
else: raise AssertionError('protocol core without open_idle accepted')
print(json.dumps(delivery,sort_keys=True))
`, path.resolve("src/scripts/building-assets-site-source.py")], { encoding: "utf8" });
    const delivery = JSON.parse(result);
    expect(Object.keys(delivery.clips)).toEqual(["open_idle"]);
    expect(new Set(Object.values(delivery.playback.statusClips))).toEqual(new Set(["open_idle"]));
  });

  it("通过本地 HTTP 固定发布，拒绝缺文件、源字节变化及下载中途发布切换", async () => {
    await fixture(async (directory) => {
      const result = execFileSync("python3", ["-c", `
import runpy,sys,json,hashlib,threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.error import HTTPError
m=runpy.run_path(sys.argv[1])
encode=lambda value: json.dumps(value).encode()
digest=lambda raw: hashlib.sha256(raw).hexdigest()
entry=lambda name,raw: {'path':name,'bytes':len(raw),'sha256':digest(raw)}
release={'schemaVersion':1,'releaseId':'fixture-release','sourceVersion':'v1.5'}
part={'id':'fixture','contentHash':'a'*64,'integrity':'buildings/fixture/integrity.json'}
profile={'pixelsPerCell':64,'logicalPixelsPerCell':128,'resolution':.5}
source=encode({'pathId':9223372036854775807,'textureProfile':profile})
documents={'buildings/fixture/top/package.json':source,'buildings/fixture/variants.json':b'{}'}
scoped=[entry(k.removeprefix('buildings/fixture/'),v) for k,v in documents.items()]
documents[part['integrity']]=encode({'schemaVersion':1,'algorithm':'sha256','building':'fixture','contentHash':part['contentHash'],'files':scoped,'fileCount':len(scoped),'totalBytes':sum(v['bytes'] for v in scoped)})
documents['assets-manifest.json']=encode({'schemaVersion':2,'releaseId':release['releaseId'],'sourceVersion':release['sourceVersion'],'defaultPixelsPerCell':64,'preview':{'pixelsPerCell':64,'root':'./'},'buildingCount':1,'buildings':[part]})
documents['release.json']=encode(release)
indexed=[entry(k,v) for k,v in documents.items()]
documents['integrity.json']=encode({**release,'algorithm':'sha256','buildings':[part],'files':indexed,'fileCount':len(indexed),'totalBytes':sum(v['bytes'] for v in indexed)})
documents['integrity.json.sha256']=digest(documents['integrity.json']).encode()
Path('resources').mkdir()
Path('resources/building-top-view-v15.json').write_text(json.dumps({'entries':[{'entityId':'fixture','spriteId':'fixture','sourcePath':'fixture/top','animated':False}]}))
mode='good'; anchors=0
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        global anchors
        name=self.path.lstrip('/')
        if mode=='missing' and name.endswith('package.json'):
            self.send_error(404);return
        raw=documents.get(name)
        if raw is None:self.send_error(404);return
        if name=='integrity.json.sha256':
            anchors+=1
            if mode=='switched' and anchors>1:raw=b'0'*64
        if mode=='changed' and name.endswith('package.json'):raw+=b' '
        self.send_response(200);self.end_headers();self.wfile.write(raw)
server=HTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever);thread.start()
try:
    base='http://127.0.0.1:'+str(server.server_port)+'/'
    m['prepare_source']('good',['fixture'],base)
    assert Path('good/site/buildings/fixture/top/package.json').read_bytes()==source
    assert json.loads(Path('good/source-receipt.json').read_text())['scope']=='entities'
    assert json.loads(Path('good/source-receipt.json').read_text())['sourceResolution']==.5
    for mode in ['missing','changed','switched']:
        anchors=0
        try:m['prepare_source'](mode,['fixture'],base)
        except (ValueError,HTTPError):pass
        else:raise AssertionError(mode+' incorrectly passed')
    print('http verified')
finally:
    server.shutdown();thread.join();server.server_close()
`, path.resolve("src/scripts/building-assets-site-source.py")], { cwd: directory, encoding: "utf8", timeout: 10000 });
      expect(result.trim().endsWith("http verified")).toBe(true);
    });
  });
});
