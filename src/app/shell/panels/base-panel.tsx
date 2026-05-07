import { handleUiEvent } from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";

const BASE_OPTIONS = [
  "workbench.base.valley4",
  "workbench.base.wuling",
  "workbench.base.protocolCore",
] as const;

const BASE_SUMMARY_ROWS = [
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

const POWER_ROWS = [
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

export function BasePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;

  return (
    <div className="stack">
      <article className="inspector-card">
        <div className="card-header">
          <h3>{t("rightDock.base")}</h3>
        </div>
        <div className="inspector-option-grid">
          {BASE_OPTIONS.map((entryKey, index) => (
            <button key={`left-dock-base-${index}`} onClick={handleUiEvent} type="button">
              {t(entryKey)}
            </button>
          ))}
        </div>
        <dl className="inspector-summary-list">
          {BASE_SUMMARY_ROWS.map((entry, index) => (
            <div className="inspector-summary-row" key={`left-dock-base-summary-${index}`}>
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
          {POWER_ROWS.map((entry, index) => (
            <div className="inspector-summary-row" key={`left-dock-power-summary-${index}`}>
              <dt>{t(entry.labelKey)}</dt>
              <dd>{t(entry.valueKey)}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}