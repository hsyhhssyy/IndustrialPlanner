import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { useEffect, useState } from "react";

type FullscreenCapableDocument = Document & {
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function settleFullscreenRequest(result: Promise<void> | void): void {
  if (result && typeof (result as Promise<void>).catch === "function") {
    void (result as Promise<void>).catch(() => undefined);
  }
}

export function resolveFullscreenState(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!currentDocument) {
    return false;
  }

  const fullscreenDocument = currentDocument as FullscreenCapableDocument;
  return currentDocument.fullscreenElement !== null || fullscreenDocument.webkitFullscreenElement != null;
}

export function requestDocumentFullscreen(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!currentDocument) {
    return;
  }

  const fullscreenElement = currentDocument.documentElement as FullscreenCapableElement;
  const requestFullscreen =
    fullscreenElement.requestFullscreen?.bind(fullscreenElement)
    ?? fullscreenElement.webkitRequestFullscreen?.bind(fullscreenElement);

  settleFullscreenRequest(requestFullscreen?.());
}

export function exitDocumentFullscreen(
  currentDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!currentDocument) {
    return;
  }

  const fullscreenDocument = currentDocument as FullscreenCapableDocument;
  const exitFullscreen =
    currentDocument.exitFullscreen?.bind(currentDocument)
    ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);

  settleFullscreenRequest(exitFullscreen?.());
}

function joinClassNames(...parts: Array<string | false | null | undefined>): string | undefined {
  const className = parts.filter(Boolean).join(" ");
  return className.length > 0 ? className : undefined;
}

export function FullscreenToggleButton({
  appHost,
  className,
}: {
  appHost: AppHost;
  className?: string;
}) {
  const t = appHost.actions.translate;
  const [isFullscreen, setIsFullscreen] = useState(resolveFullscreenState);

  useEffect(() => {
    const currentDocument = typeof document === "undefined" ? undefined : document;
    if (!currentDocument) {
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(resolveFullscreenState(currentDocument));
    };

    currentDocument.addEventListener("fullscreenchange", handleFullscreenChange);
    currentDocument.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      currentDocument.removeEventListener("fullscreenchange", handleFullscreenChange);
      currentDocument.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (resolveFullscreenState()) {
      exitDocumentFullscreen();
      return;
    }

    requestDocumentFullscreen();
  };

  const fullscreenLabel = t(isFullscreen ? "action.exitFullscreen" : "action.enterFullscreen");

  return (
    <button
      aria-label={fullscreenLabel}
      aria-pressed={isFullscreen}
      className={joinClassNames(className, isFullscreen && "is-active")}
      onClick={toggleFullscreen}
      title={fullscreenLabel}
      type="button"
    >
      <span className="top-bar-toggle-icon">
        <WorkbenchIcon kind={isFullscreen ? "shrink" : "expand"} />
      </span>
      <span className="sr-only">{fullscreenLabel}</span>
    </button>
  );
}
