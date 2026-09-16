import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AppContract } from "@/domain/app/app-contract";
import { getRenderDiagnosticChannel, type RenderDiagnosticCondition, type RenderDiagnosticPhase,
  type RenderDiagnosticReport, type RenderDiagnosticPhaseResult } from "@/shared/render-diagnostics";
import styles from "./render-diagnostic-panel.module.scss";

type Translate = AppContract["actions"]["translate"];
const CONDITION_KEYS = {
  full: "renderDiagnostic.full", "without-belt-cargo": "renderDiagnostic.noCargo",
  "without-pipe-fluid": "renderDiagnostic.noFluid", "without-building-effects": "renderDiagnostic.noEffects",
} as const;
const PHASE_KEYS = {
  warmup: "renderDiagnostic.warmup", "stationary-before": "renderDiagnostic.before",
  pan: "renderDiagnostic.pan", "stationary-after": "renderDiagnostic.after",
  "stopped-recovery": "renderDiagnostic.recovery",
} as const;
const ERROR_KEYS = {
  "capture-failed": "renderDiagnostic.captureFailed", "environment-changed": "renderDiagnostic.environmentChanged",
  "simulation-stopped": "renderDiagnostic.startSimulation", "select-tool-required": "renderDiagnostic.selectTool",
  seeking: "renderDiagnostic.seeking", "user-cancelled": "renderDiagnostic.cancelled",
  "page-hidden": "renderDiagnostic.hidden", "debug-disabled": "renderDiagnostic.debugDisabled",
  "document-changed": "renderDiagnostic.documentChanged", "simulation-changed": "renderDiagnostic.simulationChanged",
  "viewport-changed": "renderDiagnostic.viewportChanged", "tool-changed": "renderDiagnostic.selectTool",
  "renderer-destroyed": "renderDiagnostic.unavailable", unavailable: "renderDiagnostic.unavailable",
} as const;
const number = (value: number | null | undefined): string => value == null ? "—" : value.toFixed(1);
const fps = (phase: RenderDiagnosticPhaseResult | undefined): string => `${number(phase?.fps)} / ${number(phase?.tailFps)}${phase && !phase.motionMatchesPhase ? " *" : ""}`;

function exportReport(report: RenderDiagnosticReport): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = `industrial-planner-render-${report.startedAt.replaceAll(":", "-")}.json`;
    document.body.appendChild(anchor); anchor.click();
  } finally {
    anchor.remove();
    // 下载在点击处理结束后消费 Blob；延迟释放，避免手机浏览器读取已撤销的 URL。
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function RenderDiagnosticPanel({ workspace, translate: t, onStarted }: {
  workspace: object; translate: Translate; onStarted: () => void;
}) {
  const channel = getRenderDiagnosticChannel(workspace);
  const state = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const [condition, setCondition] = useState<RenderDiagnosticCondition>("full");
  const start = (mode: "automatic" | "manual"): void => {
    channel.start(mode, condition);
    if (channel.getSnapshot().progress) onStarted();
  };
  const groups = state.report?.phases.filter((value) => value.phase === "stationary-before") ?? [];
  const recovery = state.report?.phases.find((value) => value.phase === "stopped-recovery");
  return <section className={styles.panel} aria-label={t("renderDiagnostic.title")}>
    <strong>{t("renderDiagnostic.title")}</strong>
    <p>{t("renderDiagnostic.instructions")}</p>
    <div className={styles.actions}>
      <button type="button" disabled={!state.available || state.progress !== null} onClick={() => start("automatic")}>{t("renderDiagnostic.automatic")}</button>
      <label>{t("renderDiagnostic.manualCondition")}
        <select value={condition} disabled={state.progress !== null} onChange={(event) => setCondition(event.target.value as RenderDiagnosticCondition)}>
          {Object.entries(CONDITION_KEYS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
        </select>
      </label>
      <button type="button" disabled={!state.available || state.progress !== null} onClick={() => start("manual")}>{t("renderDiagnostic.manual")}</button>
      {state.report && <button type="button" onClick={() => exportReport(state.report!)}>{t("renderDiagnostic.export")}</button>}
    </div>
    {state.error && <p role="status">{t(ERROR_KEYS[state.error as keyof typeof ERROR_KEYS] ?? "renderDiagnostic.unavailable")}</p>}
    {state.report && <>
      <p>{t(state.report.environment.development ? "renderDiagnostic.development" : "renderDiagnostic.production")}
        {state.report.baselineFrameTimeChangePercent !== null && ` · ${t("renderDiagnostic.drift")}: ${number(state.report.baselineFrameTimeChangePercent)}%`}</p>
      <div className={styles.results}>
        <table>
          <thead><tr><th>{t("renderDiagnostic.condition")}</th><th>{t("renderDiagnostic.before")} FPS</th><th>{t("renderDiagnostic.pan")} FPS</th><th>{t("renderDiagnostic.after")} FPS</th><th>P95 ms</th></tr></thead>
          <tbody>{groups.map((group, index) => {
            const phase = (name: RenderDiagnosticPhase) => state.report!.phases.find((value) => value.condition === group.condition && value.repeatBaseline === group.repeatBaseline && value.phase === name);
            return <tr key={index}>
              <th>{t(group.repeatBaseline ? "renderDiagnostic.repeat" : CONDITION_KEYS[group.condition])}</th>
              <td>{fps(group)}</td><td>{fps(phase("pan"))}</td><td>{fps(phase("stationary-after"))}</td><td>{number(phase("pan")?.p95FrameMs)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {recovery && <p><strong>{t("renderDiagnostic.recovery")}</strong> · {fps(recovery)} FPS</p>}
      {state.report.phases.some((phase) => !phase.motionMatchesPhase) && <p>{t("renderDiagnostic.motionMismatch")}</p>}
      <p>{t("renderDiagnostic.reportNote")}</p>
    </>}
  </section>;
}

/** 与日志窗口同生命周期，使用 portal 避免进入画布的触摸捕获边界。 */
export function RenderDiagnosticProgress({ workspace, translate: t, onResults }: {
  workspace: object; translate: Translate; onResults: () => void;
}) {
  const channel = getRenderDiagnosticChannel(workspace);
  const state = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const [dismissed, setDismissed] = useState<RenderDiagnosticReport | null>(null);
  const progress = state.progress;
  if (!progress && (!state.report || dismissed === state.report)) return null;
  return createPortal(<>
    {progress?.mode === "automatic" && <div className={styles.shield} onContextMenu={(event) => event.preventDefault()} />}
    <div className={styles.progress} role="region" aria-label={t("renderDiagnostic.title")}>
      {progress ? <>
        <span aria-live="polite">{progress.group}/{progress.groups} · {t(progress.repeatBaseline ? "renderDiagnostic.repeat" : CONDITION_KEYS[progress.condition])}
          <br />{t(progress.phase === "pan" && progress.mode === "manual" ? "renderDiagnostic.dragNow" : PHASE_KEYS[progress.phase])} · {progress.remainingSeconds}s</span>
        <button type="button" onClick={() => channel.cancel()}>{t("renderDiagnostic.cancel")}</button>
      </> : <>
        <span>{t(state.report?.status === "completed" ? "renderDiagnostic.finished" : "renderDiagnostic.cancelled")}</span>
        <button type="button" onClick={() => { setDismissed(state.report); onResults(); }}>{t("renderDiagnostic.results")}</button>
        <button type="button" aria-label={t("action.close")} onClick={() => setDismissed(state.report)}>×</button>
      </>}
    </div>
  </>, document.body);
}
