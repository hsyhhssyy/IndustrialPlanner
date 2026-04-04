import { BottomStatusBar } from "@/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app-shell/components/canvas-panel";
import { LeftDock } from "@/app-shell/components/left-dock";
import { LeftToolbar } from "@/app-shell/components/left-toolbar";
import { RightDock } from "@/app-shell/components/right-dock";
import { TopBar } from "@/app-shell/components/top-bar";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import type { WorkbenchShell } from "@/app-shell/workbench-shell";
import type { CSSProperties } from "react";

export interface WorkbenchAppProps {
  shell: WorkbenchShell;
}

export function WorkbenchApp({ shell }: WorkbenchAppProps) {
  const { controller, workspaceDerivedStore } = shell;
  const ui = useExternalStore(controller.uiStore);
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
    <div className="workbench" style={layoutStyle}>
      <TopBar
        controller={controller}
        renderDerivedStore={workspaceDerivedStore.renderStore}
      />
      <LeftToolbar controller={controller} />
      <LeftDock controller={controller} />
      <CanvasPanel
        controller={controller}
        renderDerivedStore={workspaceDerivedStore.renderStore}
      />
      <RightDock controller={controller} />
      <BottomStatusBar controller={controller} />
    </div>
  );
}
