import { observer } from "mobx-react-lite";
import { isPlannerLimit, type PlannerDimensionMode, type PlannerWizardDraft } from "./blueprint-planner-wizard-state";
import styles from "./blueprint-planner-wizard.module.scss";
import plannerStyles from "./blueprint-planner-dialog.module.scss";

export const PlannerStopControls = observer(function PlannerStopControls({ draft, disabled, t }: {
  draft: PlannerWizardDraft; disabled: boolean; t: (key: string) => string;
}) {
  return <fieldset className={styles.stopControls} disabled={disabled}>
    <legend>{t("eda.advanced.stop")}</legend>
    <label className={plannerStyles.parallel}><span>{t("eda.advanced.areaTarget")}</span><input type="checkbox" role="switch" checked={draft.stopOnArea}
      onChange={event => draft.setStopOnArea(event.currentTarget.checked)} /></label>
    {draft.stopOnArea ? <label className={styles.numberField}>
      <span>{t("eda.advanced.areaBelow")}</span>
      <span className={styles.numberInput}><input type="number" min="1" step="1" value={draft.areaBelow}
        aria-invalid={!isPlannerLimit(draft.areaBelow)} onChange={event => draft.setAreaBelow(event.currentTarget.value)} />
        <span>{t("eda.advanced.squareCells")}</span></span>
    </label> : null}
  </fieldset>;
});

export function plannerDimensionLabel(mode: PlannerDimensionMode): string {
  return mode === "shortest" ? "eda.advanced.shortest" : mode === "u-shaped" ? "eda.advanced.valleyEdge" : "eda.advanced.busEdge";
}

export const BlueprintPlannerAdvanced = observer(function BlueprintPlannerAdvanced({ draft, mode, disabled, t }: {
  draft: PlannerWizardDraft; mode: PlannerDimensionMode; disabled: boolean; t: (key: string) => string;
}) {
  return <details className={styles.advanced} open={draft.advancedOpen}
    onToggle={event => draft.setAdvancedOpen(event.currentTarget.open)}>
    <summary><strong>{t("eda.advanced.title")}</strong><span>{t("eda.advanced.summary")}</span></summary>
    <div className={styles.advancedBody}>
      <fieldset className={styles.dimensionControls} disabled={disabled}>
        <legend>{t("eda.advanced.dimensions")}</legend>
        <div className={styles.dimensionContent}>
          <svg className={styles.dimensionDiagram} viewBox="0 0 220 150" role="img" aria-label={t(plannerDimensionLabel(mode))}>
            <rect x="35" y="24" width="140" height="88" rx="3" className={styles.diagramBox} />
            {mode === "shortest" ? <path d="M25 24v88m-5-80 5-8 5 8m-10 72 5 8 5-8" className={styles.diagramEdge} />
              : <><path d={mode === "u-shaped" ? "M35 24v88h140V24" : "M35 112h140"} className={styles.diagramBus} />
                <path d="M35 132h140m-132-5-8 5 8 5m124-10 8 5-8 5" className={styles.diagramEdge} />
                <path d="M195 24v88m-5-80 5-8 5 8m-10 72 5 8 5-8" className={styles.diagramSide} /></>}
          </svg>
          <div className={styles.dimensionFields}>
            {(["edge", ...(mode === "shortest" ? [] : ["side"])] as ("edge" | "side")[]).map(field => {
              const value = draft.dimensions[mode][field];
              return <label key={`${mode}:${field}`} className={styles.numberField}>
                <span><i className={field === "edge" ? styles.edgeKey : styles.sideKey} />{t(field === "edge" ? plannerDimensionLabel(mode) : "eda.advanced.perpendicular")}</span>
                <span className={styles.numberInput}><input type="number" min="1" step="1" placeholder={t("eda.advanced.unlimited")}
                  value={value} aria-invalid={value !== "" && !isPlannerLimit(value)}
                  onChange={event => draft.setDimension(mode, field, event.currentTarget.value)} />
                  <span>{t("eda.advanced.cells")}</span></span>
              </label>;
            })}
          </div>
        </div>
      </fieldset>
      {/* AI-REMOVED 2026-11-11:
        Reason: 终止条件统一在规划与结果步骤编辑，布局高级设置只包含尺寸限制。
        Trigger: 用户确认取消重复计算设置。
        Evidence: 本组件与结果页同时渲染同一个停止条件。
        Replacement: blueprint-planner-dialog.tsx runSettings。
        Risk: Low。Human Review: Required
        Original code:
        <PlannerStopControls draft={draft} disabled={disabled} t={t} />
      */}
    </div>
  </details>;
});
