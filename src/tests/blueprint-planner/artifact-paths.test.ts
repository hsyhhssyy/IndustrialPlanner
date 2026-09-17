// @vitest-environment node
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { edaOutputPath } from "@/scripts/eda/artifact-paths";

it("成功蓝图和训练报告保存到当前运行目录的 .temp/eda", () => {
  expect(edaOutputPath("success", "example")).toBe(resolve(".temp/eda/success/example"));
  expect(edaOutputPath("runs")).toBe(resolve(".temp/eda/runs"));
});

it("输出不能通过相对路径或绝对路径逃离 .temp/eda", () => {
  expect(() => edaOutputPath("../escaped")).toThrow("不能逃离");
  expect(() => edaOutputPath(resolve(".temp/elsewhere"))).toThrow("不能逃离");
});
