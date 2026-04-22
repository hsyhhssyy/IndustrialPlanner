import type { CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import LeftDock from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import { handleUiEvent } from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state-impl";

export const WorkbenchApp = observer(function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const rightDockOpen = appHost.state.workbench.rightDockOpen;
  const leftDockWidth = appHost.state.workbench.leftDockWidth;
  const workbenchStyle = {
    "--left-dock-width": leftDockOpen ? `${leftDockWidth}px` : "0px",
    "--right-dock-width": rightDockOpen ? `${DEFAULT_RIGHT_DOCK_WIDTH}px` : "0px",
  } as CSSProperties;

  return (
    <div className="workbench" onContextMenu={handleUiEvent} style={workbenchStyle}>
      <TopBar appHost={appHost} />
      <LeftToolbar appHost={appHost} />
      {leftDockOpen ? <LeftDock appHost={appHost} /> : null}
      <CanvasPanel appHost={appHost} />
      {rightDockOpen ? <RightDock appHost={appHost} /> : null}
      <BottomStatusBar appHost={appHost} />
    </div>
  );
});
