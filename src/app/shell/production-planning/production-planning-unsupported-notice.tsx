import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/**
 * 2026-11-25：EDA 入口所有无法继续的情况统一用这个轻量提示框，只说结论；
 * 具体原因由调用方写入日志，不占用户界面。
 */
export function ProductionPlanningUnsupportedNotice({
  onClose,
  t,
}: {
  readonly onClose: () => void;
  readonly t: AppHost["actions"]["translate"];
}) {
  const dialogState = {
    visible: true,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  };

  return (
    <DialogShell
      bodyClassName={cm(styles, "production-planning-notice-body")}
      className="production-planning-notice-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="production-planning-unsupported-notice"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onClose}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t("eda.planBlockedTitle")}
      titleId="production-planning-unsupported-notice-title"
    >
      <div className={cm(styles, "production-planning-notice-content")}>
        <p>{t("eda.planUnsupported")}</p>
        <div className={cm(styles, "production-planning-notice-actions")}>
          <button onClick={onClose} type="button">{t("action.confirm")}</button>
        </div>
      </div>
    </DialogShell>
  );
}
