import { isAbsolute, relative, resolve } from "node:path";

/**
 * 目标路径是否逃出根目录。
 * AI-CORRECTION 2026-10-06: Windows 下 relative() 返回反斜杠（`..\x`），只比较 `../` 会让逃逸防护静默失效；
 * 这里按两种分隔符统一判断，并由 artifact-paths 与 training-worker 共用，避免两处实现再次分叉。
 */
export function isPathOutsideRoot(root: string, target: string): boolean {
  const offset = relative(root, target);
  if (offset === "") return false;
  return isAbsolute(offset) || offset.split(/[\\/]/u)[0] === "..";
}

export function edaOutputPath(...parts: string[]): string {
  const root = resolve(".temp/eda");
  const path = resolve(root, ...parts);
  if (isPathOutsideRoot(root, path)) throw new Error("EDA 输出不能逃离 .temp/eda。");
  return path;
}
