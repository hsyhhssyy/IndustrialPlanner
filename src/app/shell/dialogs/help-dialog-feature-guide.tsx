import { useEffect, useRef, useState, useCallback } from "react";
import { marked } from "marked";

import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const FEATURE_GUIDE_INDEX_PATH = "/help/feature-guide/index.json";
const CONFIG_GUIDE_INDEX_PATH = "/help/config-guide/index.json";

// ── marked 图片解析 ──

marked.use({
  renderer: {
    image({ href, title, text }) {
      const resolvedUrl = resolveHelpImageUrl(href);
      const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
    },
  },
});

function resolveHelpImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }
  if (url.startsWith("./")) {
    return `/help/${url.slice(2)}`;
  }
  return `/help/${url}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── 类型 ──

interface DocSection {
  id: string;
  label: string;
  path: string;
  html: string | null;
  error: string | null;
}

function fileNameToLabel(fileName: string): string {
  // 去除 .md 后缀
  return fileName.replace(/\.md$/i, "");
}

async function fetchMarkdown(path: string): Promise<string> {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const md = await resp.text();
  const parsed = await marked.parse(md);
  return parsed as string;
}

// ── 组件 ──

export function FeatureGuideContent() {
  const [sections, setSections] = useState<DocSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1) 加载 feature-guide 索引
        const fgResp = await fetch(FEATURE_GUIDE_INDEX_PATH);
        if (!fgResp.ok) {
          throw new Error(`功能索引加载失败 (HTTP ${fgResp.status})`);
        }
        const fgFiles: string[] = await fgResp.json();

        // 2) 加载 config-guide 索引
        let cgFiles: string[] = [];
        try {
          const cgResp = await fetch(CONFIG_GUIDE_INDEX_PATH);
          if (cgResp.ok) {
            cgFiles = await cgResp.json();
          }
        } catch {
          // config-guide 可选
        }

        // 3) 构建 section 列表
        const allSections: DocSection[] = [
          ...fgFiles.map((file): DocSection => ({
            id: `fg-${file}`,
            label: fileNameToLabel(file),
            path: `/help/feature-guide/${file}`,
            html: null,
            error: null,
          })),
          ...cgFiles.map((file): DocSection => ({
            id: `cg-${file}`,
            label: fileNameToLabel(file),
            path: `/help/config-guide/${file}`,
            html: null,
            error: null,
          })),
        ];

        if (cancelled) return;
        setSections(allSections);

        // 4) 逐个加载
        const loaded: DocSection[] = [];
        for (const section of allSections) {
          if (cancelled) return;
          try {
            const html = await fetchMarkdown(section.path);
            loaded.push({ ...section, html });
          } catch (err) {
            loaded.push({
              ...section,
              error: err instanceof Error ? err.message : "加载失败",
            });
          }
          // 逐个更新以便渐进渲染
          if (!cancelled) {
            setSections([...loaded]);
          }
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

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  if (loadError !== null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <p>加载失败：{loadError}</p>
      </div>
    );
  }

  if (sections === null) {
    return (
      <div className={cm(styles, "changelog-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div className={cm(styles, "feature-guide-layout")}>
      {/* 目录 */}
      <nav className={cm(styles, "feature-guide-toc")}>
        <div className={cm(styles, "feature-guide-toc-title")}>目录</div>
        <ul className={cm(styles, "feature-guide-toc-list")}>
          {sections.map((section) => (
            <li key={section.id} className={cm(styles, "feature-guide-toc-item")}>
              <button
                className={cm(styles, "feature-guide-toc-link")}
                onClick={() => scrollToSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* 内容区 */}
      <div className={cm(styles, "feature-guide-body")}>
        {sections.map((section) => (
          <section
            key={section.id}
            ref={(el) => {
              if (el) {
                sectionRefs.current.set(section.id, el);
              }
            }}
            className={cm(styles, "feature-guide-section")}
          >
            {section.error !== null ? (
              <div className={cm(styles, "changelog-placeholder")}>
                <p>加载失败：{section.error}</p>
              </div>
            ) : section.html !== null ? (
              <div
                className={cm(styles, "changelog-markdown")}
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
            ) : (
              <div className={cm(styles, "changelog-placeholder")}>
                <p>加载中…</p>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
