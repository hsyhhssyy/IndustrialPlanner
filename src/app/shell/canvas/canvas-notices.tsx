import { readDataMigrationProgress, subscribeDataMigration } from "@/shared/data-migration";
import { isTouchLandscapeScreenProfile } from "@/shared/browser/screen-profile";
import { observer } from "mobx-react-lite";
import { useSyncExternalStore } from "react";
import { hasStorageFailure, subscribeToStorageFailures } from "@/shared/storage/storage-failure";
import type { ScreenProfile } from "@/domain/app/types/screen-profile";
import type { UiKey } from "@/shared/i18n";
// AI-REMOVED 2026-09-27:
// Reason: 画布提示组件只接收展示数据，不跨目录依赖 AppHost。
// Trigger: REQ-039 模块隔离审计。
// Evidence: 本组件仅使用提示 key、翻译函数及 Screen Profile。
// Replacement: 下方组件 props。
// Risk: Low
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host";
import styles from "./canvas-notices.module.scss";

export const CanvasNotices = observer(function CanvasNotices({ state, translate, screenProfile }: {
  state: { readonly canvasToastKey: UiKey | null; readonly canvasAlertKey: UiKey | null };
  translate: (key: UiKey) => string;
  screenProfile: ScreenProfile;
}) {
  const { canvasToastKey, canvasAlertKey } = state;
  const t = translate;
  const storageFailed = useSyncExternalStore(subscribeToStorageFailures, hasStorageFailure);
  const migration = useSyncExternalStore(subscribeDataMigration, readDataMigrationProgress);

  return (
    <div className={`${styles.notices} ${isTouchLandscapeScreenProfile(screenProfile) ? styles.compact : ""}`}>
      {storageFailed ? (
        <div className={styles.storageFailure} role="alert">
          {t("canvas.storageFailure")}
        </div>
      ) : null}
      {migration.notice && <div className={styles.alert} role="status">{migration.notice}</div>}
      {canvasToastKey !== null ? (
        <div className={`canvas-toast ${styles.toast}`} role="status" aria-live="polite" aria-atomic="true">
          {t(canvasToastKey)}
        </div>
      ) : null}
      {canvasAlertKey !== null ? (
        <div className={`canvas-mode-alert ${styles.alert}`} role="status" aria-live="polite" aria-atomic="true">
          {/* 本地化条目用成对【】声明强调片段；始终渲染文本，不注入 HTML。 */}
          {t(canvasAlertKey).split(/(【[^】]+】)/g).map((part, index) => (
            part.startsWith("【") && part.endsWith("】")
              ? <strong key={index}>{part.slice(1, -1)}</strong>
              : part
          ))}
        </div>
      ) : null}
    </div>
  );
});
