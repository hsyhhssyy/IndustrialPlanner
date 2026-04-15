import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import { LeftDock } from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import { handleUiEvent } from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

export interface WorkbenchAppProps {
  appHost: AppHost;
}

export function WorkbenchApp({ appHost }: WorkbenchAppProps) {
  return (
    <div className="workbench" onContextMenu={handleUiEvent}>
      <TopBar
        controller={appHost.controller}
        workspaceDerivedStore={appHost.workspaceDerivedStore}
      />
      <LeftToolbar controller={appHost.controller} />
      <LeftDock controller={appHost.controller} />
      <CanvasPanel
        controller={appHost.controller}
        workspaceDerivedStore={appHost.workspaceDerivedStore}
      />
      <RightDock controller={appHost.controller} />
      <BottomStatusBar controller={appHost.controller} />
    </div>
  );
}
