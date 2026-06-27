import { useEffect, useState } from "react";

import {
  fetchHelpTutorialPages,
  MISSING_HELP_TUTORIAL_IMAGE_PATH,
  type HelpTutorialImage,
  type HelpTutorialPage,
} from "@/app/shell/dialogs/help-markdown";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const DEFAULT_MARKDOWN_TUTORIAL_OVERLAY_DURATION_MS = 12000;

export interface MarkdownTutorialOverlayProps {
  visible: boolean;
  path: string;
  title: string;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  compactLayout?: boolean;
  dialogKey?: string;
  durationMs?: number | null;
}

export function MarkdownTutorialOverlay({
  visible,
  path,
  title,
  onClose,
  closeOnBackdropClick = true,
  compactLayout = false,
  dialogKey = "markdown-tutorial-overlay",
  durationMs = DEFAULT_MARKDOWN_TUTORIAL_OVERLAY_DURATION_MS,
}: MarkdownTutorialOverlayProps) {
  useEffect(() => {
    if (!visible || durationMs === null || durationMs <= 0) {
      return;
    }

    const timerId = window.setTimeout(onClose, durationMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [durationMs, onClose, path, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={cm(styles, "markdown-tutorial-overlay-backdrop")}
      onMouseDown={(event) => {
        if (!closeOnBackdropClick || event.target !== event.currentTarget) {
          return;
        }

        onClose();
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className={cm(styles, "markdown-tutorial-overlay")}
        data-compact-layout={compactLayout ? "true" : "false"}
        data-dialog-key={dialogKey}
        role="dialog"
      >
        <MarkdownTutorialOverlayContent path={path} title={title} />
      </section>
    </div>
  );
}

function MarkdownTutorialOverlayContent({
  path,
  title,
}: {
  path: string;
  title: string;
}) {
  const [loadState, setLoadState] = useState<{
    path: string;
    pages: HelpTutorialPage[] | null;
    error: string | null;
  }>(() => ({
    path,
    pages: null,
    error: null,
  }));
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextPages = await fetchHelpTutorialPages(path, { stripLeadingH1: true });
        if (!cancelled) {
          setLoadState({
            path,
            pages: nextPages,
            error: null,
          });
          setSelectedPageIndex(0);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadState({
            path,
            pages: null,
            error: err instanceof Error ? err.message : "加载失败",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loadState.path !== path) {
    return (
      <div className={cm(styles, "markdown-tutorial-overlay-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  if (loadState.error !== null) {
    return (
      <div className={cm(styles, "markdown-tutorial-overlay-placeholder")}>
        <p>加载失败：{loadState.error}</p>
      </div>
    );
  }

  if (loadState.pages === null) {
    return (
      <div className={cm(styles, "markdown-tutorial-overlay-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  if (loadState.pages.length === 0) {
    return (
      <div className={cm(styles, "markdown-tutorial-overlay-placeholder")}>
        <p>暂无说明内容</p>
      </div>
    );
  }

  const pageCount = loadState.pages.length;
  const pageIndex = Math.min(selectedPageIndex, pageCount - 1);
  const page = loadState.pages[pageIndex]!;
  const hasPreviousPage = pageIndex > 0;
  const hasNextPage = pageIndex < pageCount - 1;

  const goToPreviousPage = () => {
    setSelectedPageIndex((value) => Math.max(0, value - 1));
  };

  const goToNextPage = () => {
    setSelectedPageIndex((value) => Math.min(pageCount - 1, value + 1));
  };

  return (
    <div className={cm(styles, "markdown-tutorial-overlay-body")}>
      <MarkdownTutorialOverlayPage page={page} title={title} />
      {pageCount > 1 ? (
        <>
          <button
            aria-label="上一页"
            className={cm(styles, "markdown-tutorial-overlay-page-button markdown-tutorial-overlay-page-button-previous")}
            disabled={!hasPreviousPage}
            onClick={goToPreviousPage}
            type="button"
          >
            <WorkbenchIcon kind="chevron-left" />
            <span className={cm(styles, "sr-only")}>上一页</span>
          </button>
          <button
            aria-label="下一页"
            className={cm(styles, "markdown-tutorial-overlay-page-button markdown-tutorial-overlay-page-button-next")}
            disabled={!hasNextPage}
            onClick={goToNextPage}
            type="button"
          >
            <WorkbenchIcon kind="chevron-right" />
            <span className={cm(styles, "sr-only")}>下一页</span>
          </button>
          <div className={cm(styles, "markdown-tutorial-overlay-page-indicator")} aria-hidden="true">
            {loadState.pages.map((_, index) => (
              <span
                className={cm(styles, index === pageIndex
                  ? "markdown-tutorial-overlay-page-dot is-active"
                  : "markdown-tutorial-overlay-page-dot")}
                key={index}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MarkdownTutorialOverlayPage({
  page,
  title,
}: {
  page: HelpTutorialPage;
  title: string;
}) {
  return (
    <div className={cm(styles, "markdown-tutorial-overlay-page")}>
      {page.image === null ? null : (
        <MarkdownTutorialOverlayImageFrame image={page.image} title={title} />
      )}
      <div
        className={cm(styles, "markdown-tutorial-overlay-markdown")}
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </div>
  );
}

function MarkdownTutorialOverlayImageFrame({
  image,
  title,
}: {
  image: HelpTutorialImage;
  title: string;
}) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);

  if (image.src === MISSING_HELP_TUTORIAL_IMAGE_PATH || failedImageSrc === image.src) {
    return null;
  }

  return (
    <figure className={cm(styles, "markdown-tutorial-overlay-image-frame")}>
      <img
        alt={image.alt || title}
        onError={() => {
          setFailedImageSrc(image.src);
        }}
        src={image.src}
        title={image.title ?? undefined}
      />
    </figure>
  );
}
