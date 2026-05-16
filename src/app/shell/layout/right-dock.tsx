import { observer } from "mobx-react-lite";
import { EditSelectionInspector } from "@/app/shell/inspector/edit-selection-inspector";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const RightDock = observer(function RightDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const closeDockLabel = `${t("action.close")} ${t("topBar.rightPanel")}`;

  return (
    <aside className={cm(styles, "dock dock-right panel-surface")}>
      <section className={cm(styles, "dock-section")}>
        <div className={cm(styles, "section-header")}>
          <div className={cm(styles, "section-header-copy")}>
            <h2>{t("rightDock.selection")}</h2>
          </div>
          <button
            aria-label={closeDockLabel}
            className={cm(styles, "dialog-shell-header-button right-dock-close-button")}
            onClick={appHost.internalActions.toggleRightDock}
            title={closeDockLabel}
            type="button"
          >
            <WorkbenchIcon className={cm(styles, "right-dock-close-icon")} kind="panel-right-close" />
          </button>
        </div>
        <div className={cm(styles, "section-body")}>
          <EditSelectionInspector
            appHost={appHost}
            context={null}
            mode="dock"
            state={{ locale }}
            translate={t}
          />
        </div>
      </section>
    </aside>
  );
});
