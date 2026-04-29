import { EditSelectionInspector } from "@/app/shell/components/inspector/edit-selection-inspector";
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

export function RightDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const toggleRightDock = () => {
    appHost.internalActions.toggleRightDock();
  };
  const rightPanelActionLabel = `${t(appHost.state.workbench.rightDockOpen ? "action.close" : "action.open")} ${t("topBar.rightPanel")}`;

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <h2>{t("rightDock.title")}</h2>
          <div className="header-actions">
            <span className="pill">{t("rightDock.selection")}</span>
            <button
              onClick={toggleRightDock}
              type="button"
            >
              {rightPanelActionLabel}
            </button>
          </div>
        </div>
        <div className="section-body stack">
          <article className="inspector-card">
            <div className="card-header">
              <h3>{t("rightDock.base")}</h3>
            </div>
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
          </article>
          <article className="inspector-card">
            <div className="card-header">
              <h3>{t("rightDock.power")}</h3>
            </div>
            <dl className="inspector-summary-list">
              {RIGHT_DOCK_POWER_ROWS.map((entry, index) => (
                <div className="inspector-summary-row" key={`right-dock-power-${index}`}>
                  <dt>{t(entry.labelKey)}</dt>
                  <dd>{t(entry.valueKey)}</dd>
                </div>
              ))}
            </dl>
          </article>
          <article className="inspector-card">
            <div className="card-header">
              <h3>{t("rightDock.selection")}</h3>
            </div>
            <EditSelectionInspector
              context={null}
              state={{ locale }}
              translate={t}
            />
          </article>
          <div className="cluster">
            <div className="card-header card-subheader">
              <h3>{t("section.diagnostics")}</h3>
            </div>
            <div className="definition-list">
              <article className="log-card">
                <h4>{t("view.diagnostics")}</h4>
                <p>{t("label.noDiagnostics")}</p>
              </article>
            </div>
          </div>
        </div>
      </section>
    </aside>
  );
}
