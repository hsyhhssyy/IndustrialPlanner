import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import { LeftDock } from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import { handleUiEvent } from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

export function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  return (
    <div className="workbench" onContextMenu={handleUiEvent}>
      <TopBar appHost={appHost} />
      <LeftToolbar appHost={appHost} />
      <LeftDock appHost={appHost} />
      <CanvasPanel appHost={appHost} />
      <RightDock appHost={appHost} />
      <BottomStatusBar appHost={appHost} />
    </div>
  );
}
