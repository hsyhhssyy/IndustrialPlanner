import type { WorkbenchController } from "@/app-shell/controller/workbench-controller";
import { BottomStatusBar } from "@/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app-shell/components/canvas-panel";
import { LeftDock } from "@/app-shell/components/left-dock";
import { LeftToolbar } from "@/app-shell/components/left-toolbar";
import { RightDock } from "@/app-shell/components/right-dock";
import { TopBar } from "@/app-shell/components/top-bar";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import type { CSSProperties } from "react";

export interface WorkbenchAppProps {
  controller: WorkbenchController;
}

export function WorkbenchApp({ controller }: WorkbenchAppProps) {
  const snapshot = useExternalStore(controller);
  const layoutStyle = {
    "--left-dock-width": snapshot.ui.leftDock.open
      ? snapshot.ui.leftDock.collapsed
        ? "92px"
        : "360px"
      : "0px",
    "--right-dock-width": snapshot.ui.rightDock.open
      ? snapshot.ui.rightDock.collapsed
        ? "92px"
        : "340px"
      : "0px",
  } as CSSProperties;

  return (
    <div className="workbench" style={layoutStyle}>
      <TopBar controller={controller} snapshot={snapshot} />
      <LeftToolbar controller={controller} snapshot={snapshot} />
      <LeftDock controller={controller} snapshot={snapshot} />
      <CanvasPanel controller={controller} snapshot={snapshot} />
      <RightDock controller={controller} snapshot={snapshot} />
      <BottomStatusBar snapshot={snapshot} />
    </div>
  );
}
