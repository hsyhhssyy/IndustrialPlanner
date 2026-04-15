import { BottomStatusBar } from "@/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app-shell/components/canvas-panel";
import { LeftDock } from "@/app-shell/components/left-dock";
import { LeftToolbar } from "@/app-shell/components/left-toolbar";
import { RightDock } from "@/app-shell/components/right-dock";
import { TopBar } from "@/app-shell/components/top-bar";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import type { AppHost } from "@/app/app-host";
import { Observer } from "@/shared/mobx";
import type {
  PlacementPreviewProfiler,
  PlacementPreviewReactSurfaceId,
} from "@/workbench/diagnostics/placement-preview-profiler";
import {
  Profiler,
  type CSSProperties,
  type MouseEvent,
  type PropsWithChildren,
} from "react";

interface PlacementPreviewProfiledSectionProps
  extends PropsWithChildren {
  placementPreviewProfiler?: PlacementPreviewProfiler;
  surfaceId: PlacementPreviewReactSurfaceId;
}

function PlacementPreviewProfiledSection({
  children,
  placementPreviewProfiler,
  surfaceId,
}: PlacementPreviewProfiledSectionProps) {
  if (!placementPreviewProfiler) {
    return children;
  }

  return (
    <Profiler
      id={surfaceId}
      onRender={(_, __, actualDuration, baseDuration) => {
        placementPreviewProfiler.recordReactCommit(
          surfaceId,
          actualDuration,
          baseDuration,
        );
      }}
    >
      {children}
    </Profiler>
  );
}

export interface WorkbenchAppProps {
  appHost: AppHost;
}

export function WorkbenchApp({ appHost }: WorkbenchAppProps) {
  const { controller, placementPreviewProfiler, workspaceDerivedStore } = appHost;
  const ui = useExternalStore(controller.workspaceState.uiStore);

  const handleWorkbenchContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

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
          <div
            className="workbench"
            onContextMenu={handleWorkbenchContextMenu}
            style={layoutStyle}
          >
            <TopBar
              controller={controller}
              workspaceDerivedStore={workspaceDerivedStore}
            />
            <LeftToolbar controller={controller} />
            <PlacementPreviewProfiledSection
              placementPreviewProfiler={placementPreviewProfiler}
              surfaceId="LeftDock"
            >
              <LeftDock controller={controller} />
            </PlacementPreviewProfiledSection>
            <PlacementPreviewProfiledSection
              placementPreviewProfiler={placementPreviewProfiler}
              surfaceId="CanvasPanel"
            >
              <CanvasPanel
                controller={controller}
                placementPreviewProfiler={placementPreviewProfiler}
                workspaceDerivedStore={workspaceDerivedStore}
              />
            </PlacementPreviewProfiledSection>
            <PlacementPreviewProfiledSection
              placementPreviewProfiler={placementPreviewProfiler}
              surfaceId="RightDock"
            >
              <RightDock controller={controller} />
            </PlacementPreviewProfiledSection>
            <PlacementPreviewProfiledSection
              placementPreviewProfiler={placementPreviewProfiler}
              surfaceId="BottomStatusBar"
            >
              <BottomStatusBar controller={controller} />
            </PlacementPreviewProfiledSection>
          </div>
        );
      }}
    </Observer>
  );
}
