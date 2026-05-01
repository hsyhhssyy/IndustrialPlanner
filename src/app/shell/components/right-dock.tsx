import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";
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

function ExpandToggle({ expanded }: { expanded: boolean }) {
  return (
    <span className={`expand-toggle${expanded ? " is-expanded" : ""}`} aria-hidden="true" />
  );
}

function ExpandableCard({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <article className="inspector-card">
      <button
        className="card-header expandable-card-header"
        onClick={onToggle}
        type="button"
      >
        <h3>{title}</h3>
        <ExpandToggle expanded={expanded} />
      </button>
      {expanded ? children : null}
    </article>
  );
}

export const RightDock = observer(function RightDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;

  const {
    rightDockBaseExpanded,
    rightDockPowerExpanded,
    rightDockSelectionExpanded,
  } = appHost.state.workbench;

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-body stack">
          <ExpandableCard
            title={t("rightDock.base")}
            expanded={rightDockBaseExpanded}
            onToggle={appHost.internalActions.toggleRightDockBaseExpanded}
          >
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
          </ExpandableCard>
          <ExpandableCard
            title={t("rightDock.power")}
            expanded={rightDockPowerExpanded}
            onToggle={appHost.internalActions.toggleRightDockPowerExpanded}
          >
            <dl className="inspector-summary-list">
              {RIGHT_DOCK_POWER_ROWS.map((entry, index) => (
                <div className="inspector-summary-row" key={`right-dock-power-${index}`}>
                  <dt>{t(entry.labelKey)}</dt>
                  <dd>{t(entry.valueKey)}</dd>
                </div>
              ))}
            </dl>
          </ExpandableCard>
          <ExpandableCard
            title={t("rightDock.selection")}
            expanded={rightDockSelectionExpanded}
            onToggle={appHost.internalActions.toggleRightDockSelectionExpanded}
          >
            <EditSelectionInspector
              appHost={appHost}
              context={null}
              state={{ locale }}
              translate={t}
            />
          </ExpandableCard>
        </div>
      </section>
    </aside>
  );
});
