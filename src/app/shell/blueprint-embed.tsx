import { useEffect, useRef } from "react";
import type { AppHost } from "../host";
import { useViewportResizeAdapter } from "./canvas/viewport-resize-adapter";
import { resolveScreenProfileFromWindow } from "@/shared/browser/screen-profile";
import "./blueprint-embed.scss";

export function BlueprintEmbed({ appHost, onReady }: { appHost: AppHost; onReady: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  useViewportResizeAdapter({ editor: appHost.workspace.editor, viewportSurfaceRef: surface });
  useEffect(() => {
    const element = surface.current;
    const container = appHost.workspace.render?.container;
    if (!element || !container) return;
    element.appendChild(container);
    const adapter = appHost.gestureAdapter;
    const wheel = (event: WheelEvent) => { event.preventDefault(); adapter.handleWheel(event); };
    const blur = () => adapter.handleBlur();
    const visibility = () => adapter.handleVisibilityChange(document.visibilityState === "hidden");
    const resize = () => appHost.internalActions.setScreenProfile(resolveScreenProfileFromWindow());
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    onReady();
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      adapter.handleBlur();
      container.remove();
    };
  }, [appHost, onReady]);
  const adapter = appHost.gestureAdapter;
  return <div className="blueprint-embed" ref={surface} tabIndex={0} aria-label="蓝图查看器"
    onPointerDown={event => { event.currentTarget.focus(); adapter.handlePointerDown(event); }}
    onPointerMove={event => adapter.handlePointerMove(event)}
    onPointerUp={event => adapter.handlePointerUp(event)}
    onPointerCancel={event => adapter.handlePointerCancel(event)}
    onLostPointerCapture={event => adapter.handleLostPointerCapture(event)}
    onKeyDown={event => { if (adapter.handleKeyDown(event)) event.preventDefault(); }}
    onKeyUp={event => { if (adapter.handleKeyUp(event)) event.preventDefault(); }}
    onBlur={() => adapter.handleBlur()}
    onContextMenu={event => event.preventDefault()}
    onDragOver={event => event.preventDefault()}
    onDrop={event => event.preventDefault()}
    onPaste={event => event.preventDefault()}
  />;
}

export function BlueprintEmbedStatus({ error }: { error?: string }) {
  return <div className="blueprint-embed-status" role={error ? "alert" : "status"}>
    {error ?? "正在加载蓝图…"}
  </div>;
}
