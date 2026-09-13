// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const scriptPath = path.resolve("src/scripts/sync-device-sprites.mjs");

describe("退役的静态素材导入入口", () => {
  it.each(["无参数", "旧目录参数"])("%s 不再启动旧同步或写入素材", async (mode) => {
    const parent = path.resolve(".temp/.trash");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, "retired-sprite-cli-"));
    try {
      const sentinel = path.join(directory, "source.webp");
      const sourceBytes = Buffer.from("existing source must remain untouched");
      await writeFile(sentinel, sourceBytes);
      const args = mode === "无参数" ? [] : [directory, path.join(directory, "sprites"), path.join(directory, "masks")];

      await expect(execute(process.execPath, [scriptPath, ...args], {
        cwd: directory,
        timeout: 15_000,
      })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("旧静态素材导入入口已移除"),
      });
      expect(await readdir(directory)).toEqual(["source.webp"]);
      expect(await readFile(sentinel)).toEqual(sourceBytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
