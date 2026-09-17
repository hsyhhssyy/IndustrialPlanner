import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import type { UiKey } from "@/shared/i18n";
import type { AppHost } from "../host";
import { enterBlueprintPlacement } from "../input";
import { DialogShell } from "./shared/dialog-shell";
import styles from "./blueprint-planner-dialog.module.scss";

const OPTION_FIELDS: readonly { key: Exclude<keyof BlueprintPlannerOptions, "budgetMs">; label: UiKey; choices: readonly [string, UiKey][] }[] = [
  { key: "solidSupply", label: "eda.solidSupply", choices: [["external", "eda.externalBelt"], ["warehouse", "eda.warehouseSupply"]] },
  { key: "fluidSupply", label: "eda.fluidSupply", choices: [["external", "eda.externalPipe"], ["conduit", "eda.conduitSupply"]] },
  { key: "warehouseBus", label: "eda.warehouseBus", choices: [["straight", "eda.straight"], ["free", "eda.free"]] },
  { key: "solidOutput", label: "eda.solidOutput", choices: [["warehouse", "eda.warehouseOutput"], ["stash", "eda.stashOutput"]] },
  { key: "byproducts", label: "eda.byproducts", choices: [["output", "eda.output"], ["destroy", "eda.destroy"]] },
  { key: "plantStartup", label: "eda.plantStartup", choices: [["preload", "eda.preload"], ["warehouse", "eda.warehouseStartup"]] },
];

export const BlueprintPlannerDialog = observer(function BlueprintPlannerDialog({ appHost }: { appHost: AppHost }) {
  const controller = appHost.blueprintPlannerDialog;
  const planner = appHost.workspace.blueprintPlanner;
  const t = appHost.actions.translate;
  const [, refresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!controller.dialogState.visible) return;
    const interval = setInterval(() => refresh((value) => value + 1), 250);
    return () => clearInterval(interval);
  }, [controller.dialogState.visible]);
  const latest = planner?.queries.getTask() ?? null;
  const progress = latest?.taskId === controller.viewTaskId ? latest : null;
  const result = useMemo(() => progress?.status === "completed" ? planner?.queries.getResult(progress.taskId) ?? null : null,
    [planner, progress?.taskId, progress?.status]);
  if (!controller.dialogState.visible) return null;
  const busy = progress !== null && ["running", "waiting", "saving"].includes(progress.status);
  const compact = appHost.state.screenProfile.deviceClass === "mobile";
  const plan = controller.plan;
  const act = (action: () => void) => {
    setError(null);
    try { action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const start = () => act(() => {
    if (planner === null) throw new Error(t("eda.unavailable"));
    controller.selectTask(planner.actions.start(controller.getRequest()));
  });
  const openProductionPlanning = () => {
    controller.close();
    appHost.internalActions.setDialogTab("toolbox", "production-planning");
    appHost.internalActions.openDialog("toolbox");
  };
  const place = (source: "mouse" | "touch") => act(() => {
    const editor = appHost.workspace.editor;
    if (result === null || editor === null) return;
    const entered = enterBlueprintPlacement({
      appHost, editor, record: { ...result.blueprint, parentFolderId: result.folderId },
      source, initialMousePosition: null,
    });
    if (entered.status === "handled") controller.close();
    else setError(t("eda.placeFailed"));
  });
  const elapsed = Math.floor((progress?.elapsedMs ?? 0) / 1000);
  return (
    <DialogShell dialogKey="blueprint-planner" dialogState={controller.dialogState}
      title={t("eda.title")} titleId="blueprint-planner-title" closeTitle={t("action.close")}
      maximizeTitle={t("dialog.maximize")} restoreTitle={t("dialog.restore")}
      onClose={controller.close} onToggleMaximized={controller.toggleMaximized}
      onOffsetChange={controller.setOffset} onResize={compact ? undefined : controller.setSize}
      compactMobileLayout={compact} immersiveMaximized={controller.dialogState.maximized && appHost.state.screenProfile.deviceClass !== "desktop"}
      shellStyle={controller.dialogState.width === null ? { width: "min(660px, 100%)", height: "min(600px, 100%)" } : undefined}>
      <div className={`${styles.content} ${compact ? styles.compact : ""}`}>
        <div className={styles.scroll}>
          {plan === null ? <div className={styles.empty}>
            <p>{t("eda.noPlan")}</p>
            <button type="button" onClick={openProductionPlanning}>{t("eda.openProductionPlanning")}</button>
          </div> : <>
            <p className={styles.target}>{plan.name || plan.targets.map((flow) => {
              const item = appHost.workspace.registry.queries.findItemDefinition(flow.itemId);
              return `${item === null ? flow.itemId : t(item.nameKey)} ${flow.perMinute}/min`;
            }).join(" · ")}</p>
            <fieldset className={styles.options} disabled={progress?.status === "running" || progress?.status === "saving"}>
              {OPTION_FIELDS.map((field) => <label key={field.key}>
                <span>{t(field.label)}</span>
                <select disabled={busy} value={controller.options[field.key]} onChange={(event) => controller.updateOptions({ [field.key]: event.target.value })}>
                  {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                </select>
              </label>)}
              <label><span>{t("eda.budget")}</span>
                <input type="number" min="10" step="10" value={controller.options.budgetMs / 1000}
                  onChange={(event) => controller.updateOptions({ budgetMs: Number(event.target.value) * 1000 })} />
              </label>
            </fieldset>
            {plan.containsModules ? <p role="alert" className={styles.error}>{t("eda.modulesUnsupported")}</p> : null}
          </>}
          {progress !== null ? <section className={styles.progress} aria-live="polite">
            <div className={styles.statistics}>
              <span>{t("eda.elapsed")} <strong>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}</strong></span>
              <span>{t("eda.candidates")} <strong>{progress.candidateCount}</strong></span>
              {progress.bestArea !== null ? <span>{t("eda.bestArea")} <strong>{progress.bestArea}</strong></span> : null}
            </div>
            {busy ? <progress aria-label={t("eda.progress")} max={1} value={progress.estimatedProgress ?? undefined} /> : null}
            <p>{progress.message}</p>
            {result !== null ? <p>{result.metrics.width} × {result.metrics.height} · {result.metrics.productionDeviceCount} {t("eda.devices")}</p> : null}
          </section> : null}
          {error !== null ? <p role="alert" className={styles.error}>{error}</p> : null}
        </div>
        <footer className={styles.footer}>
          {progress?.status === "running" || progress?.status === "waiting" ? <button type="button" onClick={() => act(() => planner?.actions.cancel(progress.taskId))}>{t("action.cancel")}</button> : null}
          {progress?.status === "waiting" ? <button type="button" className={styles.primary} onClick={() => act(() => planner?.actions.continuePlanning(progress.taskId, controller.options.budgetMs))}>{t("eda.continue")}</button> : null}
          {progress?.status === "save-failed" ? <button type="button" className={styles.primary} onClick={() => {
            setError(null);
            void planner?.actions.retrySave(progress.taskId).catch((failure: unknown) => setError(String(failure)));
          }}>{t("eda.retrySave")}</button> : null}
          {!busy && plan !== null ? <button type="button" disabled={plan.containsModules || planner === null || !Number.isFinite(controller.options.budgetMs) || controller.options.budgetMs <= 0}
            className={result === null ? styles.primary : undefined} onClick={start}>{t(progress === null ? "eda.start" : "eda.replan")}</button> : null}
          {result !== null ? <button type="button" className={styles.primary}
            onPointerUp={(event) => place(event.pointerType === "mouse" ? "mouse" : "touch")}
            onClick={(event) => { if (event.detail === 0) place("mouse"); }}>
            {t("eda.place")}
          </button> : null}
        </footer>
      </div>
    </DialogShell>
  );
});
