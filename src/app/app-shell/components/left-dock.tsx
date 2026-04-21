import { useEffect, useRef, type ComponentType } from "react";
import { observer } from "mobx-react-lite";
import { BlueprintPanel } from "@/app/app-shell/components/left-dock-panels/blueprint-panel";
import { DeletePanel } from "@/app/app-shell/components/left-dock-panels/delete-panel";
import { HistoryPanel } from "@/app/app-shell/components/left-dock-panels/history-panel";
import { PlacementPanel } from "@/app/app-shell/components/left-dock-panels/placement-panel";
import type { AppHost } from "@/app/app-host";
import {
  clampLeftDockWidth,
  type ActivePanel,
} from "@/app/state-impl";

type LeftDockPanelId = Exclude<ActivePanel, null>;

const DEFAULT_ACTIVE_PANEL: LeftDockPanelId = "placement";

const PANEL_TITLE_KEYS: Record<LeftDockPanelId, string> = {
  placement: "workbench.panel.placement.title",
  delete: "workbench.panel.delete.title",
  blueprint: "workbench.panel.blueprint.title",
  history: "workbench.panel.history.title",
};

const PANEL_COMPONENTS: Record<LeftDockPanelId, ComponentType<{ appHost: AppHost }>> = {
  placement: PlacementPanel,
  delete: DeletePanel,
  blueprint: BlueprintPanel,
  history: HistoryPanel,
};

const LeftDockView = observer(function LeftDockView({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const activePanel = appHost.internalState.runtime.activePanel ?? DEFAULT_ACTIVE_PANEL;
  const currentPanelLabel = t(PANEL_TITLE_KEYS[activePanel]);
  const ActivePanelComponent = PANEL_COMPONENTS[activePanel];
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = appHost.state.workbench.leftDockWidth;

    resizeCleanupRef.current?.();

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;

      appHost.internalActions.setLeftDockWidth(clampLeftDockWidth(startWidth + deltaX));
    };

    const stopResize = () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-resizing-left-dock");
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = stopResize;
    document.body.classList.add("is-resizing-left-dock");
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);
  };

  return (
    <div className="dock-shell-left">
      <aside className="dock dock-left panel-surface">
        <section className="dock-section">
          <div className="section-header">
            <div className="section-header-copy">
              <h2>{currentPanelLabel}</h2>
            </div>
          </div>
          <div className="section-body">
            <ActivePanelComponent appHost={appHost} />
          </div>
        </section>
      </aside>
      <div className="dock-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  );
});

export function LeftDock({ appHost }: { appHost: AppHost }) {
  return <LeftDockView appHost={appHost} />;
}

export default LeftDock;
