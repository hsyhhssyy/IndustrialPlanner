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

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe("网站素材批次", () => {
  it("暂缓物流时同时排除原件和发布图，并保留共享清单中的既有高度", async () => {
    await fixture(async (directory) => {
      const batch = path.join(directory, "batch");
      const current = path.join(directory, "current");
      const stage = path.join(batch, "stage");
      const root = "resources/building-assets-site/fixture";
      const index = JSON.stringify({ files: [] });
      const sourceSite = { root, releaseId: "fixture", indexSha256: digest(index) };
      const put = async (file: string, value: unknown) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
      };
      await put(path.join(stage, root, "integrity.json"), index);
      await put(path.join(stage, root, "buildings/logistics/source.json"), "new source");
      await put(path.join(batch, "source-receipt.json"), { ...sourceSite, files: [], logistics: true });
      await put(path.join(batch, "import-plan.json"), { sourceSite, logistics: true, views: [
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
      await expect(readFile(path.join(stage, root, "buildings/logistics/source.json"))).rejects.toThrow();
      await expect(readFile(path.join(stage, effects, "new-height.rgba.bin"))).rejects.toThrow();
      const plan = JSON.parse(await readFile(path.join(batch, "import-plan.json"), "utf8"));
      expect(plan.logistics).toBe(false);
      expect(plan.views).toHaveLength(1);
      expect(plan.retainedProducts).toEqual([{ path: `${effects}/old-height.rgba.bin`, sha256: digest("old height") }]);
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

  it("奇数宽特效逐帧缩放后重新排布，避免相邻帧颜色混入", async () => {
    await fixture(async (directory) => {
      const sourceRoot = path.join(directory, "source");
      const outputRoot = path.join(directory, "output");
      await mkdir(path.join(sourceRoot, "buildings/effect"), { recursive: true });
      const pixels = Buffer.alloc(10 * 4 * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) pixels.set(x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 10 + x) * 4);
      await sharp(pixels, { raw: { width: 10, height: 4, channels: 4 } }).webp({ lossless: true })
        .toFile(path.join(sourceRoot, "buildings/effect/source.webp"));
      const effect = { frames: [
        { page: 0, x: 0, y: 0, width: 5, height: 4, durationMs: 33 },
        { page: 0, x: 5, y: 0, width: 5, height: 4, durationMs: 1340 },
      ] };
      const sheet = { pages: [{ image: "source.webp", width: 10, height: 4 }] };
      const result = await publishEffectFrames({ sourceRoot, outputRoot, directory: "buildings/effect", effect, sheet, resolution: 0.5, flipVertical: true });
      expect(result.frames).toEqual([
        { page: 0, x: 0, y: 0, width: 3, height: 2, durationMs: 33 },
        { page: 0, x: 3, y: 0, width: 3, height: 2, durationMs: 1340 },
      ]);
      const rgba = await sharp(path.join(outputRoot, result.pages[0].file)).ensureAlpha().raw().toBuffer();
      expect(rgba[2]).toBe(0);
      expect(rgba[3 * 4]).toBe(0);
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
print('verified')
`, path.resolve("src/scripts/building-assets-site-source.py")], { encoding: "utf8" });
    expect(result.trim()).toBe("verified");
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
source=b'{"pathId":9223372036854775807}'
documents={'buildings/fixture/top/package.json':source,'buildings/fixture/variants.json':b'{}'}
scoped=[entry(k.removeprefix('buildings/fixture/'),v) for k,v in documents.items()]
documents[part['integrity']]=encode({'schemaVersion':1,'algorithm':'sha256','building':'fixture','contentHash':part['contentHash'],'files':scoped,'fileCount':len(scoped),'totalBytes':sum(v['bytes'] for v in scoped)})
documents['assets-manifest.json']=encode({**release,'buildingCount':1,'buildings':[part]})
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
