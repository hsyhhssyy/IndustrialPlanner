import {
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

const DELETE_SECTIONS = [
  {
    titleKey: "workbench.section.deleteActions",
    buttonKeys: [
      "workbench.button.singleDelete",
      "workbench.button.boxDelete",
      "workbench.button.removeLinks",
      "workbench.button.clearSelection",
    ],
  },
  {
    titleKey: "workbench.section.deleteGuard",
    buttonKeys: [
      "workbench.button.undoDelete",
      "workbench.button.restoreLast",
      "workbench.button.lockSelection",
    ],
  },
] as const;

export function DeletePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;

  return (
    <div className="stack">
      {DELETE_SECTIONS.map((section) => (
        <section className="placeholder-section" key={section.titleKey}>
          <div className="placeholder-section-header">
            <h3>{t(section.titleKey)}</h3>
            <span className="pill">{t("toolbar.tools")}</span>
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