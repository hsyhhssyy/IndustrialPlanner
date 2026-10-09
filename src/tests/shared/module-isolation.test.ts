// @vitest-environment node
import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 模块隔离回归（评审 P2）：把依赖方向固化成测试，避免回退。
 *
 * 说明：`.docs/common/项目模块隔离开原则发规范.md` 在未初始化的私有子模块内，无法读到原文；
 * 本用例只固化已被评审指出的下面两条方向，不声称覆盖规范全文。
 */
function sources(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "node_modules") continue;
      found.push(...sources(path));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

function offenders(root: string, pattern: RegExp): string[] {
  return sources(root).filter(file => pattern.test(readFileSync(file, "utf8")))
    .map(file => relative(process.cwd(), file).replace(/\\/g, "/"));
}

it("Domain 与 Shared 不得反向依赖 Planner 实现", () => {
  expect(offenders("src/domain", /from "@\/blueprint-planner/)).toEqual([]);
  expect(offenders("src/shared", /from "@\/blueprint-planner/)).toEqual([]);
});

it("App 只能经 barrel 使用 Planner，不得直接引用其内部模块", () => {
  expect(offenders("src/app", /from "@\/blueprint-planner\//)).toEqual([]);
});
