import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type FullscreenCapableDocument = Document & {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export type FullscreenActionResult = "completed" | "rejected" | "unsupported";

// AI-REMOVED 2026-08-23:
// Reason: 原 helper 无条件吞掉 Promise 拒绝，导致浏览器拒绝全屏时界面完全无反馈。
// Trigger: 用户反馈 iPhone 点击全屏无响应，并要求在点击时展示明确引导。
// Evidence: catch(() => undefined) 丢弃了唯一失败信号，且 API 不存在时同样静默返回。
// Replacement: settleFullscreenAction，向调用方返回 completed/rejected/unsupported。
// Risk: Low；调用时机仍保持在用户点击处理器内。
// Human Review: Required
//
// Original code:
// function settleFullscreenRequest(result: Promise<void> | void): void {
//   if (result && typeof (result as Promise<void>).catch === "function") {
//     void (result as Promise<void>).catch(() => undefined);
//   }
// }
function settleFullscreenAction(action: (() => Promise<void> | void) | undefined): Promise<FullscreenActionResult> {
  if (!action) {
    return Promise.resolve("unsupported");
  }

  try {
    return Promise.resolve(action()).then(
      () => "completed",
      () => "rejected",
    );
  } catch {
    return Promise.resolve("rejected");
  }
}

export function resolveFullscreenSupport(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!currentDocument) {
    return false;
  }

  const fullscreenDocument = currentDocument as FullscreenCapableDocument;
  const fullscreenElement = currentDocument.documentElement as FullscreenCapableElement;

  if (typeof fullscreenElement.requestFullscreen === "function") {
    return currentDocument.fullscreenEnabled !== false;
  }

  if (typeof fullscreenElement.webkitRequestFullscreen === "function") {
    return fullscreenDocument.webkitFullscreenEnabled !== false;
  }

  return false;
}

export function resolveFullscreenState(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!currentDocument) {
    return false;
  }

  const fullscreenDocument = currentDocument as FullscreenCapableDocument;
  return currentDocument.fullscreenElement != null || fullscreenDocument.webkitFullscreenElement != null;
}

export function requestDocumentFullscreen(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): Promise<FullscreenActionResult> {
  if (!currentDocument || !resolveFullscreenSupport(currentDocument)) {
    return Promise.resolve("unsupported");
  }

  const fullscreenElement = currentDocument.documentElement as FullscreenCapableElement;
  const requestFullscreen =
    fullscreenElement.requestFullscreen?.bind(fullscreenElement)
    ?? fullscreenElement.webkitRequestFullscreen?.bind(fullscreenElement);

  return settleFullscreenAction(requestFullscreen);
}

export function exitDocumentFullscreen(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): Promise<FullscreenActionResult> {
  if (!currentDocument) {
    return Promise.resolve("unsupported");
  }

  const fullscreenDocument = currentDocument as FullscreenCapableDocument;
  const exitFullscreen =
    currentDocument.exitFullscreen?.bind(currentDocument)
    ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);

  return settleFullscreenAction(exitFullscreen);
}

function joinClassNames(...parts: Array<string | false | null | undefined>): string | undefined {
  const className = parts.filter(Boolean).join(" ");
  return className.length > 0 ? className : undefined;
}

export function FullscreenToggleButton({
  appHost,
  className,
  isStandalone = false,
  onFullscreenActionFailure,
  showLabel = false,
}: {
  appHost: AppHost;
  className?: string;
  isStandalone?: boolean;
  onFullscreenActionFailure?: (reason: "rejected" | "unsupported") => void;
  showLabel?: boolean;
}) {
  const t = appHost.actions.translate;
  const [isFullscreen, setIsFullscreen] = useState(resolveFullscreenState);
  const isFullscreenSupported = resolveFullscreenSupport();

  useEffect(() => {
    const currentDocument = typeof document === "undefined" ? undefined : document;
    if (!currentDocument) {
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(resolveFullscreenState(currentDocument));
    };
    const handleFullscreenError = () => {
      onFullscreenActionFailure?.("rejected");
    };

    currentDocument.addEventListener("fullscreenchange", handleFullscreenChange);
    currentDocument.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    currentDocument.addEventListener("fullscreenerror", handleFullscreenError);
    currentDocument.addEventListener("webkitfullscreenerror", handleFullscreenError);
    handleFullscreenChange();

    return () => {
      currentDocument.removeEventListener("fullscreenchange", handleFullscreenChange);
      currentDocument.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      currentDocument.removeEventListener("fullscreenerror", handleFullscreenError);
      currentDocument.removeEventListener("webkitfullscreenerror", handleFullscreenError);
    };
  }, [onFullscreenActionFailure]);

  const toggleFullscreen = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus();

    if (resolveFullscreenState()) {
      const result = await exitDocumentFullscreen();
      if (result !== "completed") {
        onFullscreenActionFailure?.(result);
      }
      return;
    }

    const result = await requestDocumentFullscreen();
    if (result !== "completed") {
      onFullscreenActionFailure?.(result);
    }
  };

  const fullscreenLabel = t(isFullscreen ? "action.exitFullscreen" : "action.enterFullscreen");

  if (isStandalone && !isFullscreenSupported) {
    return null;
  }

  return (
    <button
      aria-label={fullscreenLabel}
      aria-pressed={isFullscreen}
      className={cm(styles, joinClassNames(className, isFullscreen && "is-active"))}
      onClick={toggleFullscreen}
      title={fullscreenLabel}
      type="button"
    >
      <span className={cm(styles, "top-bar-toggle-icon")}>
        <WorkbenchIcon kind={isFullscreen ? "shrink" : "expand"} />
      </span>
      <span className={showLabel ? undefined : cm(styles, "sr-only")}>{fullscreenLabel}</span>
    </button>
  );
}
