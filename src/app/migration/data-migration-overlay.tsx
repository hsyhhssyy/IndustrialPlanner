import { useLayoutEffect, useSyncExternalStore } from "react";
import { readDataMigrationProgress, subscribeDataMigration } from "@/shared/data-migration";
import { readFromLocalStorage } from "@/shared/storage/browser-storage";
import { APP_SETTINGS_LOCAL_STORAGE_KEY } from "../state";
import { applyAppThemeToDocument, DEFAULT_APP_THEME_ID, isAppThemeId, resolveAppTheme } from "../theme";
import styles from "./data-migration-overlay.module.scss";

export function DataMigrationOverlay() {
  const state = useSyncExternalStore(subscribeDataMigration, readDataMigrationProgress);
  useLayoutEffect(() => {
    // 启动升级早于 AppHost 装配；首帧复用已保存主题，运行期沿用工作台当前主题。
    if (document.documentElement.dataset.appTheme) return;
    let settings: { themeId?: unknown } | null = null;
    try { settings = readFromLocalStorage<{ themeId?: unknown }>(APP_SETTINGS_LOCAL_STORAGE_KEY); }
    catch { /* 损坏设置由启动迁移保留原件，主题暂用默认值。 */ }
    const themeId = isAppThemeId(settings?.themeId) ? settings.themeId : DEFAULT_APP_THEME_ID;
    applyAppThemeToDocument(resolveAppTheme(themeId));
  }, []);
  if (!state.visible) return null;
  const progress = state.total === 0 ? 0 : Math.min(99, Math.floor(state.completed / state.total * 100));
  return <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="data-migration-title" aria-describedby="data-migration-message">
    <section className={styles.panel}>
      <h1 id="data-migration-title">{state.error ? "部分数据暂时无法升级" : state.phase === "reloading" ? "即将重新加载" : "本地数据升级中"}</h1>
      {state.error ? <>
        <p id="data-migration-message" role="alert">原始数据已保留。请重新加载页面后继续。</p>
        <details className={styles.details}>
          <summary>查看详情</summary>
          <p>{state.error}</p>
        </details>
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
      </> : <>
        <p id="data-migration-message" aria-live="polite">{state.phase === "reloading" ? "已接收的数据需要升级，重新加载后将自动处理。" : state.phase === "committing"
          ? "正在保存升级结果，请稍候…" : "请稍候，升级完成后将自动进入工作台。"}</p>
        <progress aria-label="本地数据升级进度" value={state.total > 0 ? progress : undefined} max={100} />
        {state.total > 0 && <p className={styles.count}>已处理 {state.completed} / {state.total} 项</p>}
      </>}
    </section>
  </div>;
}
