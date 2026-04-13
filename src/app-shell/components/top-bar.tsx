import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { createTranslator } from "@/i18n/messages";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import type { RenderDerivedState } from "@/workbench/workspace-derived-state";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";

export interface TopBarProps {
  controller: WorkbenchController;
  renderDerivedStore: ReadonlySnapshotStore<RenderDerivedState>;
}

export const TopBar = observer(function TopBar({
  controller,
  renderDerivedStore,
}: TopBarProps) {
  const ui = controller.uiStore;
  const render = useExternalStore(renderDerivedStore);
  const t = createTranslator(ui.locale);
  const cellSizeLabel = `${Math.round(render.cellSizePx)}px`;

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={t("topBar.leftPanel")}
          className={ui.leftDock.open ? "is-active" : undefined}
          onClick={() => controller.setDockOpen("left", !ui.leftDock.open)}
          title={t("topBar.leftPanel")}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-left" />
          </span>
          <span className="sr-only">{t("topBar.leftPanel")}</span>
        </button>
        <button
          aria-label={t("topBar.rightPanel")}
          className={ui.rightDock.open ? "is-active" : undefined}
          onClick={() => controller.setDockOpen("right", !ui.rightDock.open)}
          title={t("topBar.rightPanel")}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-right" />
          </span>
          <span className="sr-only">{t("topBar.rightPanel")}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <span className="top-bar-metric">
          {t("topBar.zoom")}: {cellSizeLabel}
        </span>
      </div>
    </header>
  );
});
