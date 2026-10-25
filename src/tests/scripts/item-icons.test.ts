// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
// @ts-expect-error Node 素材处理工具通过真实图片验证。
import { composeItemIcon, encodeItemIcon, isLosslessWebp, parseItemIconDefinitions, verifyItemIcon } from "../../scripts/icon-gen/item-icon-publisher.mjs";
// @ts-expect-error Node 素材同步入口的索引规划不依赖网络。
import { buildItemIconPlan } from "../../scripts/icon-gen/sync-item-icons.mjs";

describe("物品图标发布", () => {
  it("只解析活动定义，支持单行排版和独立 iconId，并校验容器依赖", () => {
    const source = `// { id: "archived", iconId: "old", tags: [] }
      export const ITEM_DEFINITIONS = [
        { id: "bottle", iconId: "bottle_icon", tags: [] },
        { id: "water", iconId: "water_icon", tags: [ACTIVITY_TAG] },
        { id: "filled", iconId: "filled_icon", tags: ["container:bottle", "container-item:water"] },
      ];`;
    const items = parseItemIconDefinitions(source);
    expect(items.map((item: { iconId: string }) => item.iconId)).toEqual(["bottle_icon", "water_icon", "filled_icon"]);
    expect(() => parseItemIconDefinitions(source.replace("container-item:water", "container-item:missing")))
      .toThrow("合成图标依赖");
    expect(() => parseItemIconDefinitions(source.replace('id: "water"', 'id: "bottle"'))).toThrow("重复物品");
    const prefix = "assets/beyond/dynamicassets/gameplay/ui/sprites/itemiconbig/";
    const record = { size: 100, md5: "a".repeat(32), version: "fixture" };
    const index = { schemaVersion: 2, revision: "fixed", datasets: { images: { files: {
      [`${prefix}BOTTLE_ICON.png`]: record, [`${prefix}water_icon.png`]: record,
    } as Record<string, typeof record> } } };
    expect(buildItemIconPlan(items, index)).toMatchObject({ sources: [{ iconId: "bottle_icon" }, { iconId: "water_icon" }], composites: [{ iconId: "filled_icon" }] });
    expect(() => buildItemIconPlan(items, { ...index, datasets: { images: { files: {} } } })).toThrow("原图缺失");
    index.datasets.images.files[`${prefix}bottle_icon.png`] = record;
    expect(() => buildItemIconPlan(items, index)).toThrow("歧义");
  });

  it("保持原件可见像素与 alpha，缩小大图并拒绝把低清图放大", async () => {
    const original = await sharp({ create: { width: 256, height: 256, channels: 4,
      background: { r: 57, g: 113, b: 207, alpha: 0.5 } } }).png().toBuffer();
    const bytes = await encodeItemIcon(original);
    await verifyItemIcon(bytes, original);
    expect(isLosslessWebp(bytes)).toBe(true);
    const large = await sharp(original).resize(260, 260).png().toBuffer();
    await verifyItemIcon(await encodeItemIcon(large));
    const small = await sharp(original).resize(40, 40).png().toBuffer();
    await expect(encodeItemIcon(small)).rejects.toThrow("至少 256px");
    const lossy = await sharp(original).webp({ lossless: false }).toBuffer();
    expect(isLosslessWebp(lossy)).toBe(false);
    await expect(verifyItemIcon(lossy)).rejects.toThrow("无损 WebP");
  });

  it("用 256px 原件合成居中的半尺寸内容物，半透明细节不经过有损编码", async () => {
    const image = async (background: { r: number; g: number; b: number; alpha: number }) => (
      sharp({ create: { width: 256, height: 256, channels: 4, background } }).webp({ lossless: true }).toBuffer()
    );
    const container = await image({ r: 17, g: 41, b: 83, alpha: 1 });
    const content = await image({ r: 213, g: 97, b: 29, alpha: 0.5 });
    const composite = await composeItemIcon(container, content);
    const expected = await sharp(container).composite([{
      input: await sharp(content).resize(128, 128).png().toBuffer(), left: 64, top: 64,
    }]).png().toBuffer();
    await verifyItemIcon(composite, expected);
    const pixels = await sharp(composite).ensureAlpha().raw().toBuffer();
    const at = (x: number, y: number) => [...pixels.subarray((y * 256 + x) * 4, (y * 256 + x + 1) * 4)];
    expect(at(63, 64)).toEqual([17, 41, 83, 255]);
    expect(at(192, 191)).toEqual([17, 41, 83, 255]);
    expect(at(64, 64)).toEqual(at(191, 191));
    expect(at(64, 64)).not.toEqual(at(63, 64));
    await expect(composeItemIcon(await sharp(content).resize(40, 40).png().toBuffer(), content))
      .rejects.toThrow("合成输入必须");
  });

  it("发布目录与 Registry、来源收据严格对应，图片实际使用 VP8L 无损编码", async () => {
    const items = parseItemIconDefinitions(await readFile("src/registry/item-definition.ts", "utf8")) as { iconId: string }[];
    const receipt = JSON.parse(await readFile("resources/item-icon-provenance.json", "utf8")) as {
      width: number; height: number; encoding: string;
      outputs: { iconId: string; bytes: number; sha256: string }[];
    };
    expect(receipt).toMatchObject({ width: 256, height: 256, encoding: "webp-lossless" });
    const expected = [...new Set(items.map(item => item.iconId))].sort();
    expect(receipt.outputs.map(output => output.iconId).sort()).toEqual(expected);
    expect((await readdir("public/item-icons")).sort()).toEqual(expected.map(id => `${id}.webp`).sort());
    // 仅读取文件字节，不在常规测试解码全部素材；像素对账由发布批次完成。
    for (const output of receipt.outputs) {
      const bytes = await readFile(`public/item-icons/${output.iconId}.webp`);
      expect(bytes.length, output.iconId).toBe(output.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), output.iconId).toBe(output.sha256);
      expect(isLosslessWebp(bytes), output.iconId).toBe(true);
    }
  });
});
