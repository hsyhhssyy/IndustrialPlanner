import { type CSSProperties } from "react";
import { observer } from "mobx-react-lite";

import AntDesignBilibiliFilled from "~icons/ant-design/bilibili-filled";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const FEEDBACK_GITHUB_URL =
  "https://github.com/hsyhhssyy/IndustrialPlanner/issues/new?template=bilingual-feedback.md";
const FEEDBACK_BILIBILI_URL = "https://www.bilibili.com/video/BV1P6NJ6LEJ8/";
const FEEDBACK_SKLAND_URL = "https://www.skland.com/article?id=5960603";
const FEEDBACK_TAPTAP_URL = "https://www.taptap.cn/moment/822093303359999141";

type FeedbackChannel = "github" | "bilibili" | "skland" | "taptap";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const FeedbackDialog = observer(function FeedbackDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.feedback;
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";

  if (!dialogState.visible) {
    return null;
  }

  const openChannel = (channel: FeedbackChannel) => {
    const url =
      channel === "github" ? FEEDBACK_GITHUB_URL :
      channel === "bilibili" ? FEEDBACK_BILIBILI_URL :
      channel === "skland" ? FEEDBACK_SKLAND_URL :
      FEEDBACK_TAPTAP_URL;
    window.open(url, "_blank", "noopener,noreferrer");
    appHost.internalActions.closeDialog("feedback");
  };

  const shellStyle: CSSProperties | undefined = isPhoneLayout
    ? {
      width: "100%",
      height: "100%",
      minHeight: 0,
      transform: "none",
    }
    : undefined;

  return (
    <DialogShell
      className="feedback-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="feedback"
      dialogState={dialogState}
      immersiveMaximized={isPhoneLayout || (dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile))}
      maximizeTitle={t("dialog.maximize")}
      onClose={() => appHost.internalActions.closeDialog("feedback")}
      onOffsetChange={isPhoneLayout ? undefined : (offsetX, offsetY) => appHost.internalActions.setDialogOffset("feedback", offsetX, offsetY)}
      onResize={isPhoneLayout ? undefined : (width, height) => appHost.internalActions.setDialogSize("feedback", width, height)}
      onToggleMaximized={() => appHost.internalActions.toggleDialogMaximized("feedback")}
      restoreTitle={t("dialog.restore")}
      shellStyle={shellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={t("feedbackDialog.title")}
      titleId="feedback-dialog-title"
    >
      <div className={cm(styles, "feedback-dialog-body")}>
        <p className={cm(styles, "feedback-dialog-intro")}>{t("feedbackDialog.intro")}</p>
        <div className={cm(styles, "feedback-channel-cards")}>
          <section
            aria-label={t("feedbackDialog.github.action")}
            className={cm(styles, "feedback-channel-card")}
            onClick={() => openChannel("github")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChannel("github"); }}}
            role="button"
            tabIndex={0}
          >
            <div className={cm(styles, "feedback-channel-card-icon")}>
              <WorkbenchIcon kind="github" />
            </div>
            <div className={cm(styles, "feedback-channel-card-content")}>
              <h3 id="feedback-channel-github-title" className={cm(styles, "feedback-channel-card-title")}>
                {t("feedbackDialog.github.title")}
              </h3>
              <p className={cm(styles, "feedback-channel-card-description")}>
                {t("feedbackDialog.github.description")}
              </p>
              <p className={cm(styles, "feedback-channel-card-note")}>
                {t("feedbackDialog.github.note")}
              </p>
            </div>
          </section>

          <section
            aria-label={t("feedbackDialog.bilibili.action")}
            className={cm(styles, "feedback-channel-card")}
            onClick={() => openChannel("bilibili")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChannel("bilibili"); }}}
            role="button"
            tabIndex={0}
          >
            <div className={cm(styles, "feedback-channel-card-icon")}>
              <AntDesignBilibiliFilled />
            </div>
            <div className={cm(styles, "feedback-channel-card-content")}>
              <h3 id="feedback-channel-bilibili-title" className={cm(styles, "feedback-channel-card-title")}>
                {t("feedbackDialog.bilibili.title")}
              </h3>
              <p className={cm(styles, "feedback-channel-card-description")}>
                {t("feedbackDialog.bilibili.description")}
              </p>
              <p className={cm(styles, "feedback-channel-card-note")}>
                {t("feedbackDialog.bilibili.note")}
              </p>
            </div>
          </section>

          <section
            aria-label={t("feedbackDialog.skland.action")}
            className={cm(styles, "feedback-channel-card")}
            onClick={() => openChannel("skland")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChannel("skland"); }}}
            role="button"
            tabIndex={0}
          >
            <div className={cm(styles, "feedback-channel-card-icon")}>
              <WorkbenchIcon kind="skland" />
            </div>
            <div className={cm(styles, "feedback-channel-card-content")}>
              <h3 id="feedback-channel-skland-title" className={cm(styles, "feedback-channel-card-title")}>
                {t("feedbackDialog.skland.title")}
              </h3>
              <p className={cm(styles, "feedback-channel-card-description")}>
                {t("feedbackDialog.skland.description")}
              </p>
              <p className={cm(styles, "feedback-channel-card-note")}>
                {t("feedbackDialog.skland.note")}
              </p>
            </div>
          </section>

          <section
            aria-label={t("feedbackDialog.taptap.action")}
            className={cm(styles, "feedback-channel-card")}
            onClick={() => openChannel("taptap")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChannel("taptap"); }}}
            role="button"
            tabIndex={0}
          >
            <div className={cm(styles, "feedback-channel-card-icon")}>
              <WorkbenchIcon kind="taptap" />
            </div>
            <div className={cm(styles, "feedback-channel-card-content")}>
              <h3 id="feedback-channel-taptap-title" className={cm(styles, "feedback-channel-card-title")}>
                {t("feedbackDialog.taptap.title")}
              </h3>
              <p className={cm(styles, "feedback-channel-card-description")}>
                {t("feedbackDialog.taptap.description")}
              </p>
              <p className={cm(styles, "feedback-channel-card-note")}>
                {t("feedbackDialog.taptap.note")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </DialogShell>
  );
});
