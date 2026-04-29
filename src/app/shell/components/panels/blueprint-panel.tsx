import {
  handleUiEvent,
} from "@/app/shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";

const BLUEPRINT_SECTIONS = [
  {
    titleKey: "workbench.section.blueprintActions",
    buttonKeys: [
      "workbench.button.saveBlueprint",
      "workbench.button.importBlueprint",
      "workbench.button.exportBlueprint",
      "workbench.button.applyBlueprint",
    ],
  },
  {
    titleKey: "workbench.section.blueprintLibrary",
    buttonKeys: [
      "workbench.button.sampleBus",
      "workbench.button.sampleDarkPipe",
      "workbench.button.sampleReactor",
    ],
  },
] as const;

export function BlueprintPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;

  return (
    <div className="stack">
      {BLUEPRINT_SECTIONS.map((section) => (
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