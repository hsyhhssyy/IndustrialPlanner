import { isAbsolute, relative, resolve } from "node:path";

export function edaOutputPath(...parts: string[]): string {
  const root = resolve(".temp/eda");
  const path = resolve(root, ...parts);
  const offset = relative(root, path);
  if (offset === ".." || offset.startsWith("../") || isAbsolute(offset)) throw new Error("EDA 输出不能逃离 .temp/eda。");
  return path;
}
