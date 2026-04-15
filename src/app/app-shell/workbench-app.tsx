import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import { LeftDock } from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import { useExternalStore } from "@/app/app-shell/hooks/use-external-store";
import type { AppHost } from "@/app/app-host";
import { Observer } from "@/shared/mobx";
import { type CSSProperties } from "react";

const noop = () => {};

export interface WorkbenchAppProps {
  appHost: AppHost;
}

export function WorkbenchApp({ appHost }: WorkbenchAppProps) {
  const { controller, workspaceDerivedStore } = appHost;
  const ui = useExternalStore(controller.workspaceState.uiStore);

  return (
    <Observer>
      {() => {
        const layoutStyle = {
          "--left-dock-width": ui.leftDock.open
            ? ui.leftDock.collapsed
              ? "92px"
              : "360px"
            : "0px",
          "--right-dock-width": ui.rightDock.open
            ? ui.rightDock.collapsed
              ? "92px"
              : "340px"
            : "0px",
        } as CSSProperties;

        return (
          <div className="workbench" onContextMenu={noop} style={layoutStyle}>
            <TopBar
              controller={controller}
              workspaceDerivedStore={workspaceDerivedStore}
            />
            <LeftToolbar controller={controller} />
            <LeftDock controller={controller} />
            <CanvasPanel
              controller={controller}
              workspaceDerivedStore={workspaceDerivedStore}
            />
            <RightDock controller={controller} />
            <BottomStatusBar controller={controller} />
          </div>
        );
      }}
    </Observer>
  );
}
