import {
  handleUiEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

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
    <div className={cm(styles, "stack")}>
      {DELETE_SECTIONS.map((section) => (
        <section className={cm(styles, "placeholder-section")} key={section.titleKey}>
          <div className={cm(styles, "placeholder-section-header")}>
            <h3>{t(section.titleKey)}</h3>
            <span className={cm(styles, "pill")}>{t("toolbar.tools")}</span>
          </div>
          <div className={cm(styles, "placeholder-button-grid")}>
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