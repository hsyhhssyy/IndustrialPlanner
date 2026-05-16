import { useEffect, useRef, type ComponentType } from "react";
import { observer } from "mobx-react-lite";
import { BasePanel } from "@/app/shell/panels/base-panel";
import { BlueprintPanel } from "@/app/shell/panels/blueprint-panel";
import { HistoryPanel } from "@/app/shell/panels/history-panel";
import { PlacementPanel } from "@/app/shell/panels/placement-panel";
import { SimulationPanel } from "@/app/shell/panels/simulation-panel";
import type { AppHost } from "@/app/host/app-host";
import {
  clampLeftDockWidth,
  type ActivePanel,
} from "@/app/state/state-impl";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

// AI-REMOVED 2026-05-10:
// Reason: 左侧删除面板已废弃，不再注册到左侧 dock。
// Trigger: 产品要求移除左侧“删除模式”和整个删除面板。
// Evidence: delete 面板只由 LeftDock 的 PANEL_COMPONENTS / PANEL_ORDER 控制显示。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// import { DeletePanel } from "@/app/shell/panels/delete-panel";

type LeftDockPanelId = Exclude<ActivePanel, null>;

const DEFAULT_ACTIVE_PANEL: LeftDockPanelId = "placement";

const PANEL_TITLE_KEYS: Record<LeftDockPanelId, string> = {
  placement: "workbench.panel.placement.title",
  blueprint: "workbench.panel.blueprint.title",
  history: "workbench.panel.history.title",
  base: "workbench.panel.base.title",
  simulation: "workbench.panel.simulation.title",
};

const PANEL_COMPONENTS: Record<LeftDockPanelId, ComponentType<{ appHost: AppHost }>> = {
  placement: PlacementPanel,
  blueprint: BlueprintPanel,
  history: HistoryPanel,
  base: BasePanel,
  simulation: SimulationPanel,
};

// AI-REMOVED 2026-05-10:
// Reason: 左侧删除面板已废弃，不再出现在左侧 dock 的标题、组件映射和排序中。
// Trigger: 产品要求移除左侧“删除模式”和整个删除面板。
// Evidence: LeftDock 是左侧 dock 面板标题和渲染顺序的唯一入口。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// delete: "workbench.panel.delete.title",
// delete: DeletePanel,
// const PANEL_ORDER: LeftDockPanelId[] = ["placement", "delete", "blueprint", "history", "base", "simulation"];
const PANEL_ORDER: LeftDockPanelId[] = ["placement", "blueprint", "history", "base", "simulation"];

const LeftDockView = observer(function LeftDockView({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const activePanel = appHost.internalState.runtime.activePanel ?? DEFAULT_ACTIVE_PANEL;
  const currentPanelLabel = t(PANEL_TITLE_KEYS[activePanel]);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const screenProfile = appHost.state.screenProfile;
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchLayout) {
      return;
    }

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
    <div className={cm(styles, "dock-shell-left")}>
      <aside className={cm(styles, "dock dock-left panel-surface")}>
        <section className={cm(styles, "dock-section")}>
          {isTouchLayout ? null : (
            <div className={cm(styles, "section-header")}>
              <div className={cm(styles, "section-header-copy")}>
                <h2>{currentPanelLabel}</h2>
              </div>
            </div>
          )}
          <div className={cm(styles, "section-body")}>
              {PANEL_ORDER.map((panelId) => {
                const PanelComponent = PANEL_COMPONENTS[panelId];
                const isActive = panelId === activePanel;

                return (
                  <div
                    aria-hidden={!isActive}
                    className={cm(styles, isActive ? "left-dock-panel is-active" : "left-dock-panel")}
                    data-panel-id={panelId}
                    hidden={!isActive}
                    key={panelId}
                  >
                    <PanelComponent appHost={appHost} />
                  </div>
                );
              })}
          </div>
        </section>
      </aside>
      {isTouchLayout ? null : <div className={cm(styles, "dock-resize-handle")} onMouseDown={handleResizeStart} />}
    </div>
  );
});

export function LeftDock({ appHost }: { appHost: AppHost }) {
  return <LeftDockView appHost={appHost} />;
}

export default LeftDock;
