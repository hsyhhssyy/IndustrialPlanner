import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { useEffect, useState } from "react";

function resolveFullscreenState(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.fullscreenElement !== null;
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
    if (typeof document === "undefined") {
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(resolveFullscreenState());
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (typeof document === "undefined") {
      return;
    }

    if (document.fullscreenElement !== null) {
      void document.exitFullscreen?.();
      return;
    }

    void document.documentElement.requestFullscreen?.();
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
