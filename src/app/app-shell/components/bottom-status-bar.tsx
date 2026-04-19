import type { AppHost } from "@/app/app-host";

function getLocaleLabelKey(locale: AppHost["state"]["settings"]["locale"]): string {
  return locale === "en-US" ? "locale.en-US" : "locale.zh-CN";
}

export function BottomStatusBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const {
    workbench: { leftDockOpen, rightDockOpen },
    settings,
  } = appHost.state;
  const visibleViews = [
    leftDockOpen ? t("view.library") : null,
    rightDockOpen ? t("view.inspector") : null,
  ].filter((value): value is string => value !== null);
  const visibleViewLabel = visibleViews.length > 0
    ? visibleViews.join(" / ")
    : t("statusBar.none");

  return (
    <footer className="status-bar">
      <div className="status-bar-group status-bar-group-left">
        <span className="status-chip status-chip-primary">{t("status.ready")}</span>
        <span className="status-bar-copyright">{t("statusBar.copyright")}</span>
      </div>
      <div className="status-bar-group status-bar-group-right">
        <span className="status-chip">
          {`${t("statusBar.locale")}: ${t(getLocaleLabelKey(settings.locale))}`}
        </span>
        <span className="status-chip">{`${t("statusBar.view")}: ${visibleViewLabel}`}</span>
      </div>
    </footer>
  );
}
