import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
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
  it("publishes only decodable WebP raster assets", async () => {
    const files = await collectFiles(PUBLIC_ROOT);
    const forbiddenFiles = files.filter((filePath) =>
      FORBIDDEN_RASTER_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    );
    const webpFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".webp");

    expect(forbiddenFiles).toEqual([]);
    expect(webpFiles.length).toBeGreaterThan(0);

    const invalidWebpFiles: string[] = [];
    for (const filePath of webpFiles) {
      try {
        const metadata = await sharp(filePath, { animated: true }).metadata();
        if (metadata.format !== "webp" || metadata.width === undefined || metadata.height === undefined) {
          invalidWebpFiles.push(path.relative(PROJECT_ROOT, filePath));
        }
      } catch {
        invalidWebpFiles.push(path.relative(PROJECT_ROOT, filePath));
      }
    }

    expect(invalidWebpFiles).toEqual([]);
  }, 30_000);

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
