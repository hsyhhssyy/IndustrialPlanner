import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { EditSelectionInspector } from "@/app/shell/components/inspector/edit-selection-inspector";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import {
  handleUiEvent,
} from "@/app/shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";

const RIGHT_DOCK_BASE_OPTIONS = [
  "workbench.base.valley4",
  "workbench.base.wuling",
  "workbench.base.protocolCore",
] as const;

const RIGHT_DOCK_BASE_SUMMARY_ROWS = [
  {
    labelKey: "workbench.summary.buildableArea",
    valueKey: "workbench.summaryValue.buildableArea",
  },
  {
    labelKey: "workbench.summary.expansion",
    valueKey: "workbench.summaryValue.expansion",
  },
  {
    labelKey: "workbench.summary.baseTag",
    valueKey: "workbench.summaryValue.baseTag",
  },
] as const;

const RIGHT_DOCK_POWER_ROWS = [
  {
    labelKey: "workbench.power.total",
    valueKey: "workbench.powerValue.total",
  },
  {
    labelKey: "workbench.power.covered",
    valueKey: "workbench.powerValue.covered",
  },
  {
    labelKey: "workbench.power.current",
    valueKey: "workbench.powerValue.current",
  },
  {
    labelKey: "workbench.power.mode",
    valueKey: "workbench.powerValue.mode",
  },
] as const;

const RIGHT_DOCK_TABS = [
  {
    id: "base",
    labelKey: "rightDock.base",
  },
  {
    id: "power",
    labelKey: "rightDock.power",
  },
  {
    id: "selection",
    labelKey: "rightDock.selection",
  },
] as const;

function RightDockCard({ children }: { children: ReactNode }) {
  return (
    <article className="inspector-card right-dock-panel">
      {children}
    </article>
  );
}

export const RightDock = observer(function RightDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const activeTab = appHost.state.workbench.rightDockActiveTab;
  const closeDockLabel = `${t("action.close")} ${t("topBar.rightPanel")}`;

  const activeTabDefinition = RIGHT_DOCK_TABS.find((tab) => tab.id === activeTab) ?? RIGHT_DOCK_TABS[0];

  let activePanel: ReactNode;

  switch (activeTabDefinition.id) {
    case "power":
      activePanel = (
        <RightDockCard>
          <dl className="inspector-summary-list">
            {RIGHT_DOCK_POWER_ROWS.map((entry, index) => (
              <div className="inspector-summary-row" key={`right-dock-power-${index}`}>
                <dt>{t(entry.labelKey)}</dt>
                <dd>{t(entry.valueKey)}</dd>
              </div>
            ))}
          </dl>
        </RightDockCard>
      );
      break;
    case "selection":
      activePanel = (
        <EditSelectionInspector
          appHost={appHost}
          context={null}
          state={{ locale }}
          translate={t}
        />
      );
      break;
    case "base":
    default:
      activePanel = (
        <RightDockCard>
          <div className="inspector-option-grid">
            {RIGHT_DOCK_BASE_OPTIONS.map((entryKey, index) => (
              <button key={`right-dock-base-${index}`} onClick={handleUiEvent} type="button">
                {t(entryKey)}
              </button>
            ))}
          </div>
          <dl className="inspector-summary-list">
            {RIGHT_DOCK_BASE_SUMMARY_ROWS.map((entry, index) => (
              <div className="inspector-summary-row" key={`right-dock-summary-${index}`}>
                <dt>{t(entry.labelKey)}</dt>
                <dd>{t(entry.valueKey)}</dd>
              </div>
            ))}
          </dl>
        </RightDockCard>
      );
      break;
  }

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="right-dock-tab-header">
          <div aria-label={t("rightDock.title")} className="dialog-shell-tab-list right-dock-tab-list" role="tablist">
            {RIGHT_DOCK_TABS.map((tab) => {
              const isActive = tab.id === activeTabDefinition.id;

              return (
                <button
                  aria-controls={`right-dock-panel-${tab.id}`}
                  aria-selected={isActive}
                  className={isActive ? "dialog-shell-tab right-dock-tab is-active" : "dialog-shell-tab right-dock-tab"}
                  id={`right-dock-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => {
                    appHost.internalActions.setRightDockActiveTab(tab.id);
                  }}
                  role="tab"
                  type="button"
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
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
          <div
            aria-labelledby={`right-dock-tab-${activeTabDefinition.id}`}
            className="right-dock-tab-panel"
            id={`right-dock-panel-${activeTabDefinition.id}`}
            role="tabpanel"
          >
            {activePanel}
          </div>
        </div>
      </section>
    </aside>
  );
});
