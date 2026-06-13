import { useEffect, useState } from "react";
import { marked } from "marked";

import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const CHANGELOG_INDEX_PATH = "/changelog/index.json";
const CHANGELOG_IMG_BASE = "/changelog/img/";

// 配置 marked：解析 changelog 图片相对路径
marked.use({
  renderer: {
    image({ href, title, text }) {
      const resolvedUrl = resolveChangelogImageUrl(href);
      const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
    },
  },
});

function resolveChangelogImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }

  // ./img/xxx → /changelog/img/xxx（去掉 ./ 前缀后直接拼接 base）
  if (url.startsWith("./")) {
    const relative = url.slice(2);

    // relative 已经是 img/xxx 的形式，直接拼 /changelog/ 前缀
    return `/changelog/${relative}`;
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

interface ChangelogEntry {
  file: string;
  title: string;
  loaded: boolean;
  html: string | null;
  error: string | null;
}

/**
 * 从索引加载所有 changelog 条目。
 * index.json 中条目按发布顺序排列（旧→新），读取后反转为新→旧。
 */
async function loadChangelogEntries(): Promise<ChangelogEntry[]> {
  const indexResp = await fetch(CHANGELOG_INDEX_PATH);

  if (!indexResp.ok) {
    throw new Error(`无法加载更新日志索引 (HTTP ${indexResp.status})`);
  }

  const fileList: string[] = await indexResp.json();

  if (!Array.isArray(fileList) || fileList.length === 0) {
    throw new Error("更新日志索引为空");
  }

  // 倒序：最新在前
  const reversed = [...fileList].reverse();

  return reversed.map((file) => {
    const title = file.replace(/\.md$/i, "");
    return { file, title, loaded: false, html: null, error: null };
  });
}

async function loadSingleEntry(entry: ChangelogEntry): Promise<ChangelogEntry> {
  try {
    const resp = await fetch(`/changelog/${entry.file}`);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const md = await resp.text();
    const html = await marked.parse(md);

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
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set([0]));

  // 首次加载索引，然后加载每个条目的内容
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await loadChangelogEntries();

        if (cancelled) {
          return;
        }

        setEntries(list);

        // 逐个加载每条内容
        const updated = await Promise.all(list.map((entry) => loadSingleEntry(entry)));

        if (!cancelled) {
          setEntries(updated);
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
      const next = new Set<number>();

      if (!prev.has(index)) {
        next.add(index);
      }

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

  if (entries === null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <h3>版本更新</h3>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div className={cm(styles, "changelog-section")}>
      {entries.map((entry, index) => (
        <div
          className={cm(styles, "changelog-accordion")}
          data-expanded={expandedSet.has(index) ? "true" : "false"}
          key={entry.file}
        >
          <button
            className={cm(styles, "changelog-accordion-header")}
            onClick={() => toggle(index)}
            type="button"
          >
            <span className={cm(styles, "changelog-accordion-chevron")} />
            <span className={cm(styles, "changelog-accordion-title")}>{entry.title}</span>
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
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
