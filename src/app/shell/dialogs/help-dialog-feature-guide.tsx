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
}

/** 根据帮助文档路径推导 i18n key，复用已有翻译。 */
function resolveSectionLabel(path: string, translate: (key: string) => string): string {
  const match = path.match(/^\/help\/(feature-guide|config-guide)\/(.+)\.md$/);
  if (!match) {
    const fileName = path.split("/").pop() ?? path;
    return fileName.replace(/\.md$/i, "");
  }
  const [, dir, name] = match;
  if (!name) return path;
  if (dir === "feature-guide") {
    // kebab-case → camelCase：item-encyclopedia → itemEncyclopedia
    const camel = name.replace(/-./g, (s) => s[1]!.toUpperCase());
    return translate(`toolboxDialog.tab.${camel}`);
  }
  // config-guide：setting id 即 i18n key
  return translate(`settingsField.${name}`);
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

export function FeatureGuideContent({ translate }: { translate: (key: string) => string }) {
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
          ...fgFiles.map((file): DocSection => {
            const filePath = `/help/feature-guide/${file}`;
            return {
              id: `fg-${file}`,
              label: resolveSectionLabel(filePath, translate),
              path: filePath,
              html: null,
            };
          }),
          ...cgFiles.map((file): DocSection => {
            const filePath = `/help/config-guide/${file}`;
            return {
              id: `cg-${file}`,
              label: resolveSectionLabel(filePath, translate),
              path: filePath,
              html: null,
            };
          }),
        ];

        if (cancelled) return;
        setSections(allSections);

        // 4) 逐个加载，失败的忽略不展示
        const loaded: DocSection[] = [];
        for (const section of allSections) {
          if (cancelled) return;
          try {
            const html = await fetchMarkdown(section.path);
            loaded.push({ ...section, html });
          } catch {
            // 文件不存在或加载失败，跳过该条目
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
            {section.html !== null ? (
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
