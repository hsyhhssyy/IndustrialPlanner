import { observer } from "mobx-react-lite";
import { EDA_REGRESSION_CASES, type EdaRegressionReport } from "@/shared/eda-regression";
import type { UiKey } from "@/shared/i18n";
import type { EdaRegressionController } from "./controller";
import styles from "./panel.module.scss";

function download(report: EdaRegressionReport): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${report.test.id}-${report.finishedAt.replace(/[:.]/g, "-")}.eda-report.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const EdaRegressionPanel = observer(function EdaRegressionPanel({ controller, unavailable, translate: t }: {
  controller: EdaRegressionController; unavailable: boolean; translate: (key: UiKey) => string;
}) {
  const busy = controller.running || controller.suiteRunning;
  const statusKeys: Record<EdaRegressionReport["status"], UiKey> = {
    passed: "eda.regression.passed", failed: "eda.regression.failed", cancelled: "eda.regression.cancelled",
  };
  return <section className={styles.panel} data-testid="eda-regression-panel" aria-label={t("eda.regression.title")}>
    <div className={styles.actions}>
      <button type="button" data-testid="eda-regression-run-all" disabled={busy || unavailable}
        onClick={() => void controller.runAll(EDA_REGRESSION_CASES)}>{t("eda.regression.runAll")}</button>
      {busy ? <button type="button" data-testid="eda-regression-cancel" onClick={controller.cancel}>{t("action.cancel")}</button> : null}
    </div>
    {EDA_REGRESSION_CASES.map(test => {
      const report = controller.reports.find(value => value.test.id === test.id);
      const running = controller.running && controller.currentCaseId === test.id;
      const progress = running ? controller.progress : report?.final;
      return <article key={test.id} className={styles.test} data-testid={`eda-regression-${test.id}`}
        data-eda-status={running ? "running" : report?.status ?? "idle"}>
        <strong>{test.name}</strong>
        <dl>
          <div><dt>{t("eda.regression.seed")}</dt><dd>{test.seed}</dd></div>
          <div><dt>{t("eda.regression.initialArea")}</dt><dd>{test.initialArea}</dd></div>
          <div><dt>{t("eda.regression.maximumArea")}</dt><dd>≤ {test.maximumArea}{test.continuation ? ` → ≤ ${test.continuation.maximumArea}` : ""}</dd></div>
          <div><dt>{t("eda.regression.budget")}</dt><dd>{test.budgetMode === "milestones" ? "≤" : "<"} {test.evaluationLimit / 1_000_000} M{test.continuation
            ? ` → ${test.budgetMode === "milestones" ? "=" : "<"} ${test.continuation.evaluationLimit / 1_000_000} M` : ""}</dd></div>
          <div><dt>{t("eda.regression.concurrency")}</dt><dd>{test.concurrency} · GPU {test.gpu ? "✓" : "—"}</dd></div>
        </dl>
        <div className={styles.actions}>
          <button type="button" data-testid={`eda-regression-run-${test.id}`} disabled={busy || unavailable}
            onClick={() => void controller.run(test)}>{t("eda.regression.run")}</button>
          {report ? <button type="button" data-testid={`eda-regression-download-${test.id}`} onClick={() => download(report)}>{t("eda.regression.download")}</button> : null}
          <span role="status">{running ? t("eda.regression.running") : report ? t(statusKeys[report.status]) : t("eda.regression.idle")}</span>
        </div>
        {progress ? <p>{t("eda.regression.evaluations")} {progress.evaluatedProposals.toLocaleString()} · {t("eda.regression.area")} {progress.bestArea ?? "—"}</p> : null}
        {report?.error ? <p className={styles.error} role="alert">{report.error}</p> : null}
        {report?.status === "failed" ? <ul className={styles.error}>{report.checks.filter(check => !check.passed)
          .map(check => <li key={check.name}>{check.name}: {JSON.stringify(check.actual)} / {String(check.expected)}</li>)}</ul> : null}
      </article>;
    })}
  </section>;
});
