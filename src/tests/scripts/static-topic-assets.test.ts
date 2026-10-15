// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
// @ts-expect-error Node 发布入口通过真实文件验证。
import { applyWebsiteBatch, publishWebsiteBatch, validateWebsiteBatch } from "../../scripts/import-building-assets.mjs";

it("静态专题沿用批次校验，保持 64px 密度并发布翻转后的本体、蓝图和遮罩", async () => {
  const parent = path.resolve(".temp/.trash");
  await mkdir(parent, { recursive: true });
  const batch = await mkdtemp(path.join(parent, "static-topic-test-"));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const save = async (relative: string, value: unknown) => {
    const file = path.join(batch, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  };
  try {
    const spriteId = "wuling_fence_rail_2", sourcePath = "fence/rail2.webp";
    const image = await sharp({ create: { width: 256, height: 192, channels: 4, background: "#00000000" } })
      .composite([{ input: await sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff0000" } }).png().toBuffer(), left: 0, top: 0 }])
      .webp({ lossless: true }).toBuffer();
    const source = { path: sourcePath, bytes: image.length, sha256: hash(image) };
    const index = Buffer.from(JSON.stringify({ files: [source] }));
    await mkdir(path.join(batch, "site/fence"), { recursive: true });
    await writeFile(path.join(batch, "site", sourcePath), image);
    await writeFile(path.join(batch, "site/integrity.json"), index);
    const sourceSite = { siteUrl: "https://example.invalid/", releaseId: "fixture", indexSha256: hash(index), sourceResolution: 0.5 };
    const entry = { entityId: spriteId, spriteId, sourcePath: "fence", animated: false,
      spriteOffset: { x: -1, y: -1, width: 4, height: 3 },
      sourceMetadata: { spatial: { framePixels: { width: 512, height: 384 } } } };
    const mappingPath = "resources/fence-topic.json";
    await save(`stage/${mappingPath}`, { entries: [entry] });
    await save("source-receipt.json", { ...sourceSite, files: [source] });
    await save("import-plan.json", { scope: "entities", sourceRoot: "site", sourceSite, sourceResolution: 0.5,
      mappingPath, staticOnly: true, sourcePathPrefix: "", entries: [entry], views: [], animations: [], logistics: false,
      statics: [{ spriteId, sourcePath, physicalWidth: 256, physicalHeight: 192, sourceResolution: 0.5 }] });
    await publishWebsiteBatch(batch, "static");
    expect(await validateWebsiteBatch(batch)).toMatchObject({ sources: 1, products: 4 });
    const destination = path.join(batch, "destination");
    const application = JSON.parse(await readFile(path.join(batch, "application-plan.json"), "utf8")) as { path: string; previousSha256: string | null }[];
    for (const item of application) if (item.previousSha256 !== null) {
      await mkdir(path.dirname(path.join(destination, item.path)), { recursive: true });
      await copyFile(path.resolve(item.path), path.join(destination, item.path));
    }
    await applyWebsiteBatch(batch, destination);
    for (const root of ["3d-top-view", "blueprint-view"]) {
      const color = await sharp(await readFile(path.join(destination, `public/${root}/sprites/${spriteId}.webp`)))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([color.info.width, color.info.height]).toEqual([256, 192]);
      expect([...color.data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
      expect(color.data[191 * 256 * 4 + 3]).toBe(255);
      if (root === "blueprint-view") expect([...color.data.subarray(191 * 256 * 4, 191 * 256 * 4 + 3)]).toEqual([255, 255, 255]);
    }
  } finally {
    // 关闭 Sharp 文件缓存后按既有素材测试的清理策略重试，覆盖文件系统延迟释放。
    sharp.cache(false);
    await rm(batch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
