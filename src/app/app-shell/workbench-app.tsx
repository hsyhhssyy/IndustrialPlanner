import { useEffect, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import LeftDock from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import { preventNativeBrowserEvent } from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state-impl";
import {
  isMobileLandscapeScreenProfile,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";

export const WorkbenchApp = observer(function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const rightDockOpen = appHost.state.workbench.rightDockOpen;
  const leftDockWidth = appHost.state.workbench.leftDockWidth;
  const topBarCollapsed = appHost.state.workbench.topBarCollapsed;
  const [screenProfile, setScreenProfile] = useState(resolveScreenProfileFromWindow);
  const isMobileLandscape = isMobileLandscapeScreenProfile(screenProfile);
  const showFloatingTopBarToggle = isMobileLandscape && topBarCollapsed;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setScreenProfile(resolveScreenProfileFromWindow());
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const workbenchStyle = {
    "--left-dock-width": leftDockOpen ? `${leftDockWidth}px` : "0px",
    "--right-dock-width": rightDockOpen ? `${DEFAULT_RIGHT_DOCK_WIDTH}px` : "0px",
    "--top-bar-height": showFloatingTopBarToggle ? "0px" : "48px",
    "--bottom-bar-height": isMobileLandscape ? "0px" : "28px",
  } as CSSProperties;

  return (
    <div
      className="workbench"
      onAuxClick={preventNativeBrowserEvent}
      onContextMenu={preventNativeBrowserEvent}
      onDragStart={preventNativeBrowserEvent}
      style={workbenchStyle}
    >
      <TopBar appHost={appHost} />
      {showFloatingTopBarToggle ? (
        <button
          aria-label={`${t("action.expand")} ${t("topBar.controls")}`}
          className="workbench-floating-top-bar-toggle"
          onClick={appHost.internalActions.toggleTopBarCollapsed}
          title={`${t("action.expand")} ${t("topBar.controls")}`}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-top-open" />
          </span>
          <span className="sr-only">{`${t("action.expand")} ${t("topBar.controls")}`}</span>
        </button>
      ) : null}
      <LeftToolbar appHost={appHost} />
      {leftDockOpen ? <LeftDock appHost={appHost} /> : null}
      <CanvasPanel appHost={appHost} />
      {rightDockOpen ? <RightDock appHost={appHost} /> : null}
      {isMobileLandscape ? null : <BottomStatusBar appHost={appHost} />}
    </div>
  );
});
