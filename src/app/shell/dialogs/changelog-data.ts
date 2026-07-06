import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

export const CHANGELOG_INDEX_PATH = createPublicAssetUrl("changelog/index.json");
export const CHANGELOG_IMG_BASE = createPublicAssetUrl("changelog/img/");

const CHANGELOG_VERSION_PATTERN = /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:\.\d+)?)(?=$|[^0-9])/i;

export interface ChangelogVersion {
  canonical: string;
  isMain: boolean;
}

export interface ChangelogIndexEntry {
  file: string;
  title: string;
  version: ChangelogVersion | null;
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

  const fileList: unknown = await indexResp.json();

  if (
    !Array.isArray(fileList)
    || fileList.length === 0
    || fileList.some((file) => typeof file !== "string")
  ) {
    throw new Error("更新日志索引为空");
  }

  // 倒序：最新在前
  const reversed = [...fileList].reverse();

  return reversed.map((file) => {
    const title = file.replace(/\.md$/i, "");
    return {
      file,
      title,
      version: parseChangelogVersion(title),
    };
  });
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
    .filter((entry) => entry.version?.canonical === currentVersion.canonical)
    .map((entry) => entry.file)
    .sort();

  if (files.length === 0) {
    return null;
  }

  return `${currentVersion.canonical}:${files.join("|")}`;
}
