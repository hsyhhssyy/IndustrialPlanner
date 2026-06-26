import { useEffect, useState } from "react";
import { marked, Renderer } from "marked";

import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const GETTING_STARTED_PATH = "/help/getting-started.md";

// 复用与 changelog 相同的 marked 图片解析逻辑
let currentMarkdownBaseDir = "/help";

function createHelpRenderer(): Renderer {
  const renderer = new Renderer();
  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const resolvedUrl = resolveHelpImageUrl(href);
    const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
  };
  return renderer;
}

const helpRenderer = createHelpRenderer();

function resolveHelpImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }
  if (url.startsWith("./")) {
    return `${currentMarkdownBaseDir}/${url.slice(2)}`;
  }
  return `${currentMarkdownBaseDir}/${url}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function GettingStartedContent() {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const resp = await fetch(GETTING_STARTED_PATH);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const md = await resp.text();
        currentMarkdownBaseDir = GETTING_STARTED_PATH.substring(0, GETTING_STARTED_PATH.lastIndexOf("/"));
        const parsed = await marked.parse(md, { renderer: helpRenderer });
        if (!cancelled) {
          setHtml(parsed as string);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <p>加载失败：{error}</p>
      </div>
    );
  }

  if (html === null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div
      className={cm(styles, "changelog-markdown")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
