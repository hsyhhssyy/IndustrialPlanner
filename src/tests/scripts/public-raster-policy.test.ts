import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

// AI-REMOVED 2026-09-14:
// Reason: 公共位图策略测试只校验文件扩展名，不再读取全部 WebP 的元数据。
// Trigger: 用户要求避免打开图片文件，并测量仅检查扩展名后的耗时。
// Evidence: 独立运行元数据扫描需 23.23 秒，全量并行检查中超过 30 秒超时。
// Replacement: 下方 publishes raster assets only as WebP 用例中的扩展名检查。
// Risk: 文件扩展名正确但内容损坏或并非 WebP 时，本测试不再发现该问题。
// Human Review: Required
//
// Original code:
// import sharp from "sharp";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = process.cwd();
const PUBLIC_ROOT = path.resolve(PROJECT_ROOT, "public");
const FORBIDDEN_RASTER_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
]);
const MISSING_TUTORIAL_SENTINEL = path.join(PUBLIC_ROOT, "help", "__missing-tutorial-image__.webp");

describe("public raster policy", () => {
  it("publishes raster assets only as WebP", async () => {
    const files = await collectFiles(PUBLIC_ROOT);
    const forbiddenFiles = files.filter((filePath) =>
      FORBIDDEN_RASTER_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    );
    const webpFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".webp");

    expect(forbiddenFiles).toEqual([]);
    expect(webpFiles.length).toBeGreaterThan(0);

    // AI-REMOVED 2026-09-14:
    // Reason: 扩展名策略不应逐个打开全部 WebP；该读取使普通测试受磁盘缓存与 libvips 并发竞争影响。
    // Trigger: 用户要求仅验证图片格式扩展名，并对比测试耗时。
    // Evidence: 独立元数据扫描测试体耗时 23.23 秒；全量并行执行时超过 30 秒。
    // Replacement: forbiddenFiles 与 webpFiles 扩展名断言。
    // Risk: High；损坏文件或伪装成 .webp 的其他内容不会在此测试中暴露。
    // Human Review: Required
    //
    // Original code:
    // const invalidWebpFiles: string[] = [];
    // for (const filePath of webpFiles) {
    //   try {
    //     const metadata = await sharp(filePath, { animated: true }).metadata();
    //     if (metadata.format !== "webp" || metadata.width === undefined || metadata.height === undefined) {
    //       invalidWebpFiles.push(path.relative(PROJECT_ROOT, filePath));
    //     }
    //   } catch {
    //     invalidWebpFiles.push(path.relative(PROJECT_ROOT, filePath));
    //   }
    // }
    //
    // expect(invalidWebpFiles).toEqual([]);
  });

  it("keeps every local Markdown image reference on an existing WebP or SVG asset", async () => {
    const files = await collectFiles(PUBLIC_ROOT);
    const markdownFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".md");
    const invalidReferences: string[] = [];

    for (const markdownFilePath of markdownFiles) {
      const markdown = await readFile(markdownFilePath, "utf8");
      for (const reference of collectMarkdownImageReferences(markdown)) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) {
          continue;
        }

        const cleanReference = reference.split(/[?#]/, 1)[0] ?? reference;
        const assetPath = cleanReference.startsWith("/")
          ? path.join(PUBLIC_ROOT, cleanReference.replace(/^\/+/, ""))
          : path.resolve(path.dirname(markdownFilePath), cleanReference);
        const extension = path.extname(assetPath).toLowerCase();

        if (assetPath === MISSING_TUTORIAL_SENTINEL) {
          continue;
        }
        if (extension !== ".webp" && extension !== ".svg") {
          invalidReferences.push(`${path.relative(PROJECT_ROOT, markdownFilePath)} -> ${reference}`);
          continue;
        }

        try {
          await access(assetPath);
        } catch {
          invalidReferences.push(`${path.relative(PROJECT_ROOT, markdownFilePath)} -> ${reference}`);
        }
      }
    }

    expect(invalidReferences).toEqual([]);
  });
});

async function collectFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectMarkdownImageReferences(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g))
    .map((match) => match[1] ?? match[2])
    .filter((reference): reference is string => reference !== undefined);
}
