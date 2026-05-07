import { observer } from "mobx-react-lite";
import { EditSelectionInspector } from "@/app/shell/inspector/edit-selection-inspector";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";

export const RightDock = observer(function RightDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const closeDockLabel = `${t("action.close")} ${t("topBar.rightPanel")}`;

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <div className="section-header-copy">
            <h2>{t("rightDock.selection")}</h2>
          </div>
          <button
            aria-label={closeDockLabel}
            className="dialog-shell-header-button right-dock-close-button"
            onClick={appHost.internalActions.toggleRightDock}
            title={closeDockLabel}
            type="button"
          >
            <WorkbenchIcon className="right-dock-close-icon" kind="panel-right-close" />
          </button>
        </div>
        <div className="section-body">
          <EditSelectionInspector
            appHost={appHost}
            context={null}
            state={{ locale }}
            translate={t}
          />
        </div>
      </section>
    </aside>
  );
});
