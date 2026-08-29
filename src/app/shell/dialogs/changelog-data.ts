import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

export const CHANGELOG_INDEX_PATH = createPublicAssetUrl("changelog/index.json");

// AI-REMOVED 2026-08-14:
// Reason: 图片不再依赖全局目录，而是按 Markdown 文件位置解析标准相对路径。
// Trigger: 增量日志迁移到 incremental/{version}/，图片迁移到 images/v{version}/。
// Evidence: 全局图片基址无法同时表达根目录日志的 ./images 与嵌套日志的 ../../images。
// Replacement: changelog-section.tsx/resolveChangelogImageUrl
// Risk: Low
// Human Review: Required
//
// Original code:
// export const CHANGELOG_IMG_BASE = createPublicAssetUrl("changelog/img/");
// AI-CORRECTION 2026-08-14: 删除发生前该常量已随本次迁移改为 createPublicAssetUrl("changelog/images/")。

const CHANGELOG_VERSION_PATTERN = /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:\.\d+)?)(?=$|[^0-9])/i;
const CHANGELOG_INDEX_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9a-z.-]+)?$/i;

export type ChangelogKind = "main" | "incremental";

export interface ChangelogVersion {
  canonical: string;
  isMain: boolean;
}

export interface ChangelogIndexEntry {
  file: string;
  title: string;
  version: ChangelogVersion;
  kind: ChangelogKind;
}

export function parseChangelogVersion(source: string): ChangelogVersion | null {
  const match = CHANGELOG_VERSION_PATTERN.exec(source);

  if (match === null) {
    return null;
  }

  const versionText = match[1];

  if (versionText === undefined) {
    return null;
  }

  const segments = versionText.split(".").map((segment) => Number.parseInt(segment, 10));
  const isMain = segments.length === 3 || segments[3] === 0;
  const canonical = isMain
    ? segments.slice(0, 3).join(".")
    : segments.join(".");

  return { canonical, isMain };
}

export function normalizeChangelogVersionText(source: string | undefined): string | null {
  if (source === undefined) {
    return null;
  }

  return parseChangelogVersion(source)?.canonical ?? null;
}

/**
 * 从索引加载所有 changelog 条目。
 * index.json 中条目按发布顺序排列（旧→新），读取后反转为新→旧。
 */
export async function loadChangelogIndexEntries(): Promise<ChangelogIndexEntry[]> {
  const indexResp = await fetch(CHANGELOG_INDEX_PATH);

  if (!indexResp.ok) {
    throw new Error(`无法加载更新日志索引 (HTTP ${indexResp.status})`);
  }

  const indexData: unknown = await indexResp.json();

  // AI-REMOVED 2026-08-28:
  // Reason: string[] 索引把显示标题和版本语义绑定在文件名上，章节名前缀会破坏文件排序。
  // Trigger: 用户要求标题进入 index.json，Markdown 文件名仅保留版本号。
  // Evidence: 旧映射直接从 file basename 派生 title，并从 title 正则提取 version。
  // Replacement: normalizeChangelogIndexEntry 与下方结构化索引加载逻辑
  // Risk: 历史 string[] 索引不再兼容，必须与新版前端同步发布结构化 index.json。
  // Human Review: Required
  //
  // Original code:
  // const fileList: unknown = await indexResp.json();
  //
  // if (
  //   !Array.isArray(fileList)
  //   || fileList.length === 0
  //   || fileList.some((file) => typeof file !== "string")
  // ) {
  //   throw new Error("更新日志索引为空");
  // }
  //
  // // 倒序：最新在前
  // const reversed = [...fileList].reverse();
  //
  // return reversed.map((file) => {
  //   const title = file.slice(file.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  //   return {
  //     file,
  //     title,
  //     version: parseChangelogVersion(title),
  //   };
  // });

  if (!Array.isArray(indexData) || indexData.length === 0) {
    throw new Error("更新日志索引为空");
  }

  const entries: ChangelogIndexEntry[] = [];

  for (const value of indexData) {
    const entry = normalizeChangelogIndexEntry(value);

    if (entry === null) {
      throw new Error("更新日志索引格式无效");
    }

    entries.push(entry);
  }

  if (new Set(entries.map((entry) => entry.file)).size !== entries.length) {
    throw new Error("更新日志索引包含重复文件");
  }

  // 倒序：最新在前
  return entries.reverse();
}

function normalizeChangelogIndexEntry(value: unknown): ChangelogIndexEntry | null {
  if (
    !isRecord(value)
    || !isNonEmptyString(value.file)
    || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.version)
    || !isChangelogKind(value.kind)
  ) {
    return null;
  }

  const file = value.file.trim();
  const title = value.title.trim();
  const versionText = value.version.trim();
  const version = parseChangelogVersion(versionText);
  const fileName = file.slice(file.lastIndexOf("/") + 1).replace(/\.md$/i, "");

  if (
    !isSafeChangelogFile(file)
    || !CHANGELOG_INDEX_VERSION_PATTERN.test(versionText)
    || fileName !== versionText
    || version === null
    || version.isMain !== (value.kind === "main")
  ) {
    return null;
  }

  return {
    file,
    title,
    version,
    kind: value.kind,
  };
}

function isSafeChangelogFile(value: string): boolean {
  const segments = value.split("/");
  return value.endsWith(".md")
    && !value.startsWith("/")
    && !value.includes("\\")
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isChangelogKind(value: unknown): value is ChangelogKind {
  return value === "main" || value === "incremental";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveCurrentVersionChangelogKey(
  entries: ChangelogIndexEntry[],
  currentVersionText: string | undefined,
): string | null {
  const currentVersion = currentVersionText === undefined ? null : parseChangelogVersion(currentVersionText);

  if (currentVersion === null) {
    return null;
  }

  const files = entries
    .filter((entry) => entry.version.canonical === currentVersion.canonical)
    .map((entry) => entry.file)
    .sort();

  if (files.length === 0) {
    return null;
  }

  return `${currentVersion.canonical}:${files.join("|")}`;
}
