import {
  handleUiEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";

const HISTORY_SECTIONS = [
  {
    titleKey: "workbench.section.historyActions",
    buttonKeys: [
      "workbench.button.undo",
      "workbench.button.redo",
      "workbench.button.clearHistory",
    ],
  },
  {
    titleKey: "workbench.section.historyLane",
    buttonKeys: [
      "workbench.button.documentCommands",
      "workbench.button.runtimeControls",
      "workbench.button.sessionActions",
    ],
  },
] as const;

export function HistoryPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;

  return (
    <div className="stack">
      {HISTORY_SECTIONS.map((section) => (
        <section className="placeholder-section" key={section.titleKey}>
          <div className="placeholder-section-header">
            <h3>{t(section.titleKey)}</h3>
            <span className="pill">{t("toolbar.views")}</span>
          </div>
          <div className="placeholder-button-grid">
            {section.buttonKeys.map((buttonKey) => (
              <button key={buttonKey} onClick={handleUiEvent} type="button">
                {t(buttonKey)}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}