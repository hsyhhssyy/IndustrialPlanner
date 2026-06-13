import { useEffect, useRef, useState } from "react";
import { makeAutoObservable } from "mobx";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import styles from "@/app/shell/dialogs/settings-dialog.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const CHANGELOG_MD_PATH = "/changelog/index.md";
const CHANGELOG_IMG_BASE = "/changelog/img/";
const LAST_READ_VERSION_KEY = "industrial-planner-changelog-last-read-version";

function getCurrentVersion(): string {
  return (window as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "0.0.0-dev";
}

function getLastReadVersion(): string {
  try {
    return localStorage.getItem(LAST_READ_VERSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function setLastReadVersion(version: string): void {
  try {
    localStorage.setItem(LAST_READ_VERSION_KEY, version);
  } catch {
    // localStorage 不可用时静默忽略
  }
}

/**
 * 简易 Markdown → HTML 转换器。
 * 仅支持 changelog 所需的常见语法：标题、段落、粗体、斜体、图片、链接、无序列表、分割线。
 */
function parseMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行跳过
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch !== null) {
      const level = headingMatch[1].length;
      const text = parseInlineMarkdown(headingMatch[2]);
      html.push(`<h${level}>${text}</h${level}>`);
      i += 1;
      continue;
    }

    // 分割线
    if (/^[-*_]{3,}\s*$/.test(line)) {
      html.push("<hr>");
      i += 1;
      continue;
    }

    // 无序列表
    const listMatch = line.match(/^-\s+(.+)$/);
    if (listMatch !== null) {
      html.push("<ul>");
      while (i < lines.length) {
        const listLine = lines[i];
        const itemMatch = listLine.match(/^-\s+(.+)$/);
        if (itemMatch === null) {
          break;
        }
        html.push(`<li>${parseInlineMarkdown(itemMatch[1])}</li>`);
        i += 1;
      }
      html.push("</ul>");
      continue;
    }

    // 普通段落：收集连续非空行
    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      // 如果遇到特殊块级元素则终止段落收集
      if (/^(#{1,3}\s|[-*_]{3,}\s*$|-\s)/.test(lines[i])) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }
    if (paragraphLines.length > 0) {
      const text = parseInlineMarkdown(paragraphLines.join("\n"));
      html.push(`<p>${text}</p>`);
    }
  }

  return html.join("\n");
}

function parseInlineMarkdown(text: string): string {
  let result = text;

  // 图片 ![alt](url) - 必须在链接之前处理
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, url: string) => {
      const resolvedUrl = resolveChangelogImageUrl(url);
      return `<img src="${escapeHtmlAttr(resolvedUrl)}" alt="${escapeHtmlAttr(alt)}" loading="lazy">`;
    },
  );

  // 链接 [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, linkText: string, url: string) =>
      `<a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`,
  );

  // 粗体 **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // 斜体 *text*
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 换行
  result = result.replace(/\n/g, "<br>");

  return result;
}

function resolveChangelogImageUrl(url: string): string {
  // 已经是绝对路径的直接返回
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }

  // ./img/xxx.png → /changelog/img/xxx.png
  if (url.startsWith("./")) {
    return `${CHANGELOG_IMG_BASE}${url.slice(2)}`;
  }

  // img/xxx.png → /changelog/img/xxx.png
  return `${CHANGELOG_IMG_BASE}${url}`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createChangelogDialogState(): DialogStateReadWrite {
  return makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 620,
    height: null,
    activeTab: null,
  });
}

interface ChangelogDialogProps {
  appHost: AppHost;
}

export const ChangelogDialog = observer(function ChangelogDialog({
  appHost,
}: ChangelogDialogProps) {
  const t = appHost.actions.translate;
  const isCompact = appHost.state.screenProfile.deviceClass === "mobile";
  const [dialogState] = useState(() => createChangelogDialogState());
  const [mdHtml, setMdHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const didAutoOpenRef = useRef(false);

  // 加载 MD 内容
  useEffect(() => {
    let cancelled = false;

    async function loadChangelog() {
      try {
        const response = await fetch(CHANGELOG_MD_PATH);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (!cancelled) {
          setMdHtml(parseMarkdownToHtml(text));
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "加载更新日志失败");
        }
      }
    }

    void loadChangelog();

    return () => {
      cancelled = true;
    };
  }, []);

  // 版本检测：新版本自动弹出
  useEffect(() => {
    if (didAutoOpenRef.current) {
      return;
    }

    const currentVersion = getCurrentVersion();
    const lastReadVersion = getLastReadVersion();

    console.log("[Changelog] version=", currentVersion, "lastRead=", lastReadVersion);

    if (currentVersion !== lastReadVersion && currentVersion !== "0.0.0-dev") {
      didAutoOpenRef.current = true;
      dialogState.visible = true;
    }
  }, [dialogState]);

  const handleClose = () => {
    dialogState.visible = false;
    setLastReadVersion(getCurrentVersion());
  };

  return (
    <DialogShell
      bodyClassName={cm(styles, "changelog-dialog-body")}
      className="changelog-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isCompact}
      dialogKey="changelog"
      dialogState={dialogState}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        dialogState.offsetX = offsetX;
        dialogState.offsetY = offsetY;
      }}
      onResize={(width, height) => {
        dialogState.width = width;
        dialogState.height = height;
      }}
      onToggleMaximized={() => {
        dialogState.maximized = !dialogState.maximized;
      }}
      restoreTitle={t("dialog.restore")}
      title="版本更新日志"
      titleId="changelog-dialog-title"
    >
      <div className={cm(styles, "changelog-content")}>
        {loadError !== null ? (
          <p className={cm(styles, "changelog-error")}>加载失败：{loadError}</p>
        ) : mdHtml !== null ? (
          <div
            className={cm(styles, "changelog-markdown")}
            dangerouslySetInnerHTML={{ __html: mdHtml }}
          />
        ) : (
          <p className={cm(styles, "changelog-loading")}>加载中…</p>
        )}
      </div>
    </DialogShell>
  );
});
