import { useEffect, useState } from "react";
import { marked, Renderer } from "marked";
import LucideChevronUp from "~icons/lucide/chevron-up";

import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  CHANGELOG_IMG_BASE,
  type ChangelogIndexEntry,
  type ChangelogVersion,
  loadChangelogIndexEntries,
  parseChangelogVersion,
} from "@/app/shell/dialogs/changelog-data";

function createChangelogRenderer(): Renderer {
  const renderer = new Renderer();
  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const resolvedUrl = resolveChangelogImageUrl(href);
    const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
  };
  return renderer;
}

const changelogRenderer = createChangelogRenderer();

function resolveChangelogImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return createPublicAssetUrl(url);
  }

  // ./img/xxx → /changelog/img/xxx（去掉 ./ 前缀后直接拼接 base）
  if (url.startsWith("./")) {
    const relative = url.slice(2);

    // relative 已经是 img/xxx 的形式，直接拼 /changelog/ 前缀
    // AI-CORRECTION 2026-06-29: 子路径部署时前缀由 createPublicAssetUrl 注入，不再直接返回 root 路径。
    return createPublicAssetUrl(`changelog/${relative}`);
  }

  return `${CHANGELOG_IMG_BASE}${url}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface ChangelogEntry extends ChangelogIndexEntry {
  loaded: boolean;
  html: string | null;
  error: string | null;
}

interface DisplayEntry {
  key: string;
  label: string;
  loaded: boolean;
  html: string | null;
  error: string | null;
  version: ChangelogVersion | null;
}

function getBaseVersion(version: string): string {
  return version.split(".").slice(0, 3).join(".");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function groupEntries(entries: ChangelogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i]!;

    if (entry.version === null || entry.version.isMain) {
      result.push({
        key: entry.file,
        label: entry.title,
        loaded: entry.loaded,
        html: entry.html,
        error: entry.error,
        version: entry.version,
      });
      i += 1;
      continue;
    }

    // 增量版本：收集连续的同基础版本号增量条目
    const baseVersion = getBaseVersion(entry.version.canonical);
    const group: ChangelogEntry[] = [];

    while (i < entries.length) {
      const e = entries[i]!;
      if (e.version !== null && !e.version.isMain && getBaseVersion(e.version.canonical) === baseVersion) {
        group.push(e);
        i += 1;
      } else {
        break;
      }
    }

    const allLoaded = group.every((e) => e.loaded);
    let mergedHtml: string | null = null;

    if (allLoaded) {
      const errors = group.filter((e) => e.error !== null);

      if (errors.length === 0) {
        mergedHtml = group
          .map((e) => {
            const subLabel = escapeHtml(e.title);
            return `<p class="changelog-sub-heading">${subLabel}</p>${e.html ?? ""}`;
          })
          .join("\n");
      }
    }

    const groupErrors = group.filter((e) => e.error !== null).map((e) => e.error);

    result.push({
      key: `group-${baseVersion}`,
      label: `v${baseVersion} 增量更新`,
      loaded: allLoaded,
      html: mergedHtml,
      error: groupErrors.length > 0 ? groupErrors.join("; ") : null,
      version: { canonical: baseVersion, isMain: false },
    });
  }

  return result;
}

function getCurrentAppVersionText(): string | undefined {
  return typeof window === "undefined" ? undefined : window.__APP_VERSION__;
}

function resolveCurrentEntryIndex(displayEntries: DisplayEntry[], currentVersionText: string | undefined): number {
  const currentVersion = currentVersionText === undefined ? null : parseChangelogVersion(currentVersionText);

  if (currentVersion !== null) {
    // 精确匹配
    const exactIndex = displayEntries.findIndex(
      (de) => de.version?.canonical === currentVersion.canonical,
    );

    if (exactIndex >= 0) {
      return exactIndex;
    }

    // 增量版本按基础版本号匹配合并后的分组
    if (!currentVersion.isMain) {
      const baseVersion = getBaseVersion(currentVersion.canonical);
      const groupIndex = displayEntries.findIndex(
        (de) =>
          de.version !== null
          && !de.version.isMain
          && getBaseVersion(de.version.canonical) === baseVersion,
      );

      if (groupIndex >= 0) {
        return groupIndex;
      }
    }
  }

  const latestVersionedIndex = displayEntries.findIndex((de) => de.version !== null);
  return latestVersionedIndex >= 0 ? latestVersionedIndex : 0;
}

function createDefaultExpandedSet(displayEntries: DisplayEntry[]): Set<number> {
  const expanded = new Set<number>();

  if (displayEntries.length === 0) {
    return expanded;
  }

  const currentIndex = resolveCurrentEntryIndex(displayEntries, getCurrentAppVersionText());
  expanded.add(currentIndex);
  return expanded;
}

/**
 * 从索引加载所有 changelog 条目。
 * index.json 中条目按发布顺序排列（旧→新），读取后反转为新→旧。
 */
async function loadChangelogEntries(): Promise<ChangelogEntry[]> {
  const indexEntries = await loadChangelogIndexEntries();
  return indexEntries.map((entry) => {
    return {
      ...entry,
      loaded: false,
      html: null,
      error: null,
    };
  });
}

async function loadSingleEntry(entry: ChangelogEntry): Promise<ChangelogEntry> {
  try {
    const resp = await fetch(createPublicAssetUrl(`changelog/${entry.file}`));

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const md = await resp.text();
    const html = await marked.parse(md, { renderer: changelogRenderer });

    return { ...entry, loaded: true, html: html as string };
  } catch (err) {
    return {
      ...entry,
      loaded: true,
      error: err instanceof Error ? err.message : "加载失败",
    };
  }
}

export function ChangelogSection() {
  const [displayEntries, setDisplayEntries] = useState<DisplayEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await loadChangelogEntries();

        if (cancelled) {
          return;
        }

        const initialGrouped = groupEntries(list);
        setDisplayEntries(initialGrouped);
        setExpandedSet(createDefaultExpandedSet(initialGrouped));

        const updated = await Promise.all(list.map((entry) => loadSingleEntry(entry)));

        if (!cancelled) {
          const finalGrouped = groupEntries(updated);
          setDisplayEntries(finalGrouped);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "加载失败");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (index: number) => {
    setExpandedSet((prev) => {
      const next = new Set<number>(prev);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  };

  const collapse = (index: number) => {
    setExpandedSet((prev) => {
      if (!prev.has(index)) {
        return prev;
      }

      const next = new Set<number>(prev);
      next.delete(index);
      return next;
    });
  };

  if (loadError !== null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <h3>版本更新</h3>
        <p>加载失败：{loadError}</p>
      </div>
    );
  }

  if (displayEntries === null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <h3>版本更新</h3>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div className={cm(styles, "changelog-section")}>
      {displayEntries.map((entry, index) => {
        const expanded = expandedSet.has(index);

        return (
          <div
            className={cm(styles, "changelog-accordion")}
            data-expanded={expanded ? "true" : "false"}
            key={entry.key}
          >
            <button
              aria-expanded={expanded}
              className={cm(styles, "changelog-accordion-header")}
              onClick={() => toggle(index)}
              type="button"
            >
              <span className={cm(styles, "changelog-accordion-chevron")} />
              <span className={cm(styles, "changelog-accordion-title")}>{entry.label}</span>
            </button>
            <div className={cm(styles, "changelog-accordion-body")}>
              <div className={cm(styles, "changelog-accordion-content")}>
                {entry.error !== null ? (
                  <p className={cm(styles, "changelog-error")}>加载失败：{entry.error}</p>
                ) : entry.html !== null ? (
                  <div
                    className={cm(styles, "changelog-markdown")}
                    dangerouslySetInnerHTML={{ __html: entry.html }}
                  />
                ) : (
                  <p className={cm(styles, "changelog-loading")}>加载中…</p>
                )}
                {expanded ? (
                  <div className={cm(styles, "changelog-collapse-row")}>
                    <button
                      aria-label={`收起 ${entry.label}`}
                      className={cm(styles, "changelog-collapse-button")}
                      onClick={() => collapse(index)}
                      type="button"
                    >
                      <LucideChevronUp
                        aria-hidden="true"
                        className={cm(styles, "changelog-collapse-icon")}
                      />
                      <span>收起</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
