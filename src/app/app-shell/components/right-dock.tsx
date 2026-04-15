import { EditSelectionInspector } from "@/app/app-shell/components/inspector/edit-selection-inspector";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { WorkbenchController } from "@/workspace/workspace-facade";

const RIGHT_DOCK_LIST = [
  STATIC_UI_PLACEHOLDER_TEXT,
  STATIC_UI_PLACEHOLDER_TEXT,
  STATIC_UI_PLACEHOLDER_TEXT,
];

export interface RightDockProps {
  controller: WorkbenchController;
}
export function RightDock({ controller }: RightDockProps) {
  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <h2>{STATIC_UI_PLACEHOLDER_TEXT}</h2>
          <div className="header-actions">
            <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
            <button
              onClick={handleUiEvent}
              type="button"
            >
              {STATIC_UI_PLACEHOLDER_TEXT}
            </button>
          </div>
        </div>
        <div className="section-body stack">
          <article className="inspector-card">
            <div className="card-header">
              <h3>{STATIC_UI_PLACEHOLDER_TEXT}</h3>
            </div>
            <div className="inspector-option-grid">
              {RIGHT_DOCK_LIST.map((entry, index) => (
                <button key={`right-dock-base-${index}`} onClick={handleUiEvent} type="button">
                  {entry}
                </button>
              ))}
            </div>
            <dl className="inspector-summary-list">
              {RIGHT_DOCK_LIST.map((entry, index) => (
                <div className="inspector-summary-row" key={`right-dock-summary-${index}`}>
                  <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
                  <dd>{entry}</dd>
                </div>
              ))}
            </dl>
          </article>
          <article className="inspector-card">
            <div className="card-header">
              <h3>{STATIC_UI_PLACEHOLDER_TEXT}</h3>
            </div>
            <dl className="inspector-summary-list">
              {RIGHT_DOCK_LIST.map((entry, index) => (
                <div className="inspector-summary-row" key={`right-dock-power-${index}`}>
                  <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
                  <dd>{entry}</dd>
                </div>
              ))}
            </dl>
          </article>
          <article className="inspector-card">
            <div className="card-header">
              <h3>{STATIC_UI_PLACEHOLDER_TEXT}</h3>
            </div>
            <EditSelectionInspector
              context={null}
              controller={controller}
              state={{ locale: "zh-CN" }}
            />
          </article>
          <div className="cluster">
            <div className="card-header card-subheader">
              <h3>{STATIC_UI_PLACEHOLDER_TEXT}</h3>
            </div>
            <div className="definition-list">
              <article className="log-card">
                <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
                <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
              </article>
            </div>
          </div>
        </div>
      </section>
    </aside>
  );
}
