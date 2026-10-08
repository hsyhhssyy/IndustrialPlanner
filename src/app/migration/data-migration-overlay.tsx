import { useSyncExternalStore } from "react";
import { readDataMigrationProgress, subscribeDataMigration } from "@/shared/data-migration";
import styles from "./data-migration-overlay.module.scss";

export function DataMigrationOverlay() {
  const state = useSyncExternalStore(subscribeDataMigration, readDataMigrationProgress);
  if (!state.visible) return null;
  const progress = state.total === 0 ? 0 : Math.min(99, Math.floor(state.completed / state.total * 100));
  return <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="data-migration-title">
    <section className={styles.panel}>
      <h1 id="data-migration-title">{state.error ? "数据升级未完成" : "正在升级本地数据"}</h1>
      {state.error ? <>
        <p role="alert">{state.error}</p>
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
      </> : <>
        <p aria-live="polite">{state.phase === "committing" ? "正在保存升级结果" : state.label || "正在准备"}</p>
        <progress aria-label="数据升级进度" value={progress} max={100} />
        <p className={styles.count}>{state.completed} / {state.total}</p>
      </>}
    </section>
  </div>;
}
