import { useEffect, useRef, useState, useCallback } from "react";

import {
  CONFIG_GUIDE_INDEX_PATH,
  FEATURE_GUIDE_INDEX_PATH,
  fetchHelpIndex,
  fetchHelpMarkdownHtml,
  resolveHelpDocumentTitle,
} from "@/app/shell/dialogs/help-markdown";
import styles from "@/app/shell/dialogs/dialogs.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

// ── 类型 ──

interface DocSection {
  id: string;
  label: string;
  path: string;
  html: string | null;
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
        const fgFiles = await fetchHelpIndex(FEATURE_GUIDE_INDEX_PATH);

        // 2) 加载 config-guide 索引
        let cgFiles: string[] = [];
        try {
          cgFiles = await fetchHelpIndex(CONFIG_GUIDE_INDEX_PATH);
        } catch {
          // config-guide 可选
        }

        // 3) 构建 section 列表
        const allSections: DocSection[] = [
          ...fgFiles.map((file): DocSection => {
            const filePath = createPublicAssetUrl(`help/feature-guide/${file}`);
            return {
              id: `fg-${file}`,
              label: resolveHelpDocumentTitle(filePath, translate),
              path: filePath,
              html: null,
            };
          }),
          ...cgFiles.map((file): DocSection => {
            const filePath = createPublicAssetUrl(`help/config-guide/${file}`);
            return {
              id: `cg-${file}`,
              label: resolveHelpDocumentTitle(filePath, translate),
              path: filePath,
              html: null,
            };
          }),
        ];

        if (cancelled) return;
        setSections(allSections);

        // 4) 并行加载所有 markdown，完成后一次性设 state，避免逐条更新导致 DOM 重建、图片闪烁
        const results = await Promise.allSettled(
          allSections.map((section) => fetchHelpMarkdownHtml(section.path, { stripLeadingH1: true })),
        );
        if (cancelled) return;

        const loadedSections = allSections.map((section, i) => {
          const result = results[i]!;
          return {
            ...section,
            html: result.status === "fulfilled" ? result.value : null,
          };
        });
        setSections(loadedSections);
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
  }, [translate]);

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
            <h2 className={cm(styles, "feature-guide-section-title")}>{section.label}</h2>
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
