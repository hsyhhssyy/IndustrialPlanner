import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

const LEFT_DOCK_BUTTONS = [
  { id: "dock-button-1", icon: "pointer" as const },
  { id: "dock-button-2", icon: "placement" as const },
  { id: "dock-button-3", icon: "history" as const },
];

export function LeftDock({ appHost: _appHost }: { appHost: AppHost }) {
  return (
    <aside className="dock dock-left panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <div className="section-header-copy">
            <p className="section-kicker">{STATIC_UI_PLACEHOLDER_TEXT}</p>
            <h2>{STATIC_UI_PLACEHOLDER_TEXT}</h2>
          </div>
          <div className="header-actions">
            <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
            <button onClick={handleUiEvent} type="button">
              {STATIC_UI_PLACEHOLDER_TEXT}
            </button>
          </div>
        </div>
        <div className="section-body stack">
          <div className="cluster">
            <div className="pill-row">
              <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
              <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
              <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
            </div>
            <p className="mono-line">{STATIC_UI_PLACEHOLDER_TEXT}</p>
          </div>
          <section className="placeholder-section">
            <div className="placeholder-section-header">
              <h3>{STATIC_UI_PLACEHOLDER_TEXT}</h3>
              <span className="pill">{STATIC_UI_PLACEHOLDER_TEXT}</span>
            </div>
            <div className="placeholder-button-grid">
              {LEFT_DOCK_BUTTONS.map((button) => (
                <button
                  key={button.id}
                  onClick={handleUiEvent}
                  onPointerDown={handleUiEvent}
                  type="button"
                >
                  <span className="button-icon button-icon-glyph" aria-hidden="true">
                    <WorkbenchIcon kind={button.icon} />
                  </span>
                  <span>{STATIC_UI_PLACEHOLDER_TEXT}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
    </aside>
  );
}
