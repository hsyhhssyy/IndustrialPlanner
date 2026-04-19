import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

export function TopBar({ appHost: _appHost }: { appHost: AppHost }) {
  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={STATIC_UI_PLACEHOLDER_TEXT}
          onClick={handleUiEvent}
          title={STATIC_UI_PLACEHOLDER_TEXT}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-left" />
          </span>
          <span className="sr-only">{STATIC_UI_PLACEHOLDER_TEXT}</span>
        </button>
        <button
          aria-label={STATIC_UI_PLACEHOLDER_TEXT}
          onClick={handleUiEvent}
          title={STATIC_UI_PLACEHOLDER_TEXT}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-right" />
          </span>
          <span className="sr-only">{STATIC_UI_PLACEHOLDER_TEXT}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{STATIC_UI_PLACEHOLDER_TEXT}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <span className="top-bar-metric">{STATIC_UI_PLACEHOLDER_TEXT}</span>
      </div>
    </header>
  );
}
