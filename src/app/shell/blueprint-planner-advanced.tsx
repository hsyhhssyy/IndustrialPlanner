import { observer } from "mobx-react-lite";
import { isPlannerLimit, type PlannerDimensionAxis, type PlannerAxisMode, type PlannerDimensionMode, type PlannerWizardDraft } from "./blueprint-planner-wizard-state";
import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
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

function LegacyDimensionInputs({ draft, mode, disabled, t }: {
  draft: PlannerWizardDraft; mode: PlannerDimensionMode; disabled: boolean; t: (key: string) => string;
}) {
  return <div className={styles.dimensionFields}>
    {(["edge", ...(mode === "shortest" ? [] : ["side"])] as ("edge" | "side")[]).map(field => <label className={styles.numberField} key={`${mode}:${field}`}>
      <span>{t(field === "edge" ? plannerDimensionLabel(mode) : "eda.advanced.perpendicular")}</span>
      <span className={styles.numberInput}><input type="number" min="1" step="1" disabled={disabled}
        value={draft.dimensions[mode][field]} aria-label={`${t(`eda.dimensions.legacy.${mode}`)} · ${t(field === "edge" ? plannerDimensionLabel(mode) : "eda.advanced.perpendicular")}`}
        aria-invalid={draft.dimensions[mode][field] !== "" && !isPlannerLimit(draft.dimensions[mode][field])}
        onChange={event => draft.setDimension(mode, field, event.currentTarget.value)} /><span>{t("eda.advanced.cells")}</span></span>
    </label>)}
  </div>;
}

export const BlueprintPlannerAdvanced = observer(function BlueprintPlannerAdvanced({ draft, mode, disabled, t, conflict = false,
  allowExact = true, shape = "straight", implicitBaseLength, onReleaseFixedWidth, onAxisModeChange }: {
  draft: PlannerWizardDraft; mode: PlannerDimensionMode; disabled: boolean; conflict?: boolean; allowExact?: boolean;
  shape?: "straight" | "corner" | "u-shaped"; implicitBaseLength?: number; onReleaseFixedWidth?: () => void;
  onAxisModeChange?: (axis: PlannerDimensionAxis, mode: PlannerAxisMode) => void; t: (key: string) => string;
}) {
  const caption = (axis: PlannerDimensionAxis) => {
    const value = draft.axisValue(axis);
    const shortValue = value.length > 8 ? `${value.slice(0, 5)}…` : value;
    return `${t(`eda.dimensions.${axis}Axis`)} · ${draft.axisModes[axis] === "none" ? t("eda.dimensions.mode.none") : `${draft.axisModes[axis] === "max" ? "≤ " : "= "}${shortValue || "—"}`}`;
  };
  return <div className={styles.dimensionsPanel}>
    <fieldset className={styles.dimensionControls} disabled={disabled}>
      <legend>{t("eda.advanced.dimensions")}</legend>
      {allowExact ? <>
        <div className={styles.dimensionContent}>
          <svg className={styles.dimensionDiagram} viewBox="0 0 260 180" role="img" aria-label={t("eda.dimensions.diagram")} data-dimension-shape={shape}>
            <rect x="35" y="25" width="160" height="100" rx="3" className={styles.diagramBox} />
            <path data-dimension-bus="" d={shape === "u-shaped" ? "M35 25V125H195V25" : shape === "corner" ? "M35 25V125H195" : "M35 125H195"} className={styles.diagramBus} />
            <path data-dimension-axis="base" d="M35 146H195m-152-5-8 5 8 5m144-10 8 5-8 5" className={styles.diagramEdge} />
            <path data-dimension-axis="side" d="M218 25V125m-5-92 5-8 5 8m-10 84 5 8 5-8" className={styles.diagramSide} />
            <text aria-label={`${t("eda.dimensions.baseAxis")}: ${draft.axisModes.base === "none" ? t("eda.dimensions.mode.none") : draft.axisValue("base")}`} data-dimension-value="base" x="115" y="170" textAnchor="middle" className={styles.diagramBaseText}>{caption("base")}</text>
            <text aria-label={`${t("eda.dimensions.sideAxis")}: ${draft.axisModes.side === "none" ? t("eda.dimensions.mode.none") : draft.axisValue("side")}`} data-dimension-value="side" x="238" y="75" textAnchor="middle" transform="rotate(-90 238 75)" textLength={caption("side").length > 14 ? 100 : undefined} lengthAdjust="spacingAndGlyphs" className={styles.diagramSideText}>{caption("side")}</text>
          </svg>
        <div className={styles.axisDimensions}>
          {(["base", "side"] as const).map(axis => {
            const oppositeExact = draft.axisModes[axis === "base" ? "side" : "base"] === "exact";
            const implicit = axis === "side" && implicitBaseLength !== undefined;
            const label = t(`eda.dimensions.${axis}`), axisMode = draft.axisModes[axis];
            const valueLabel = t(`eda.dimensions.${axis}.${axisMode === "exact" ? "exact" : "max"}`);
            return <div className={styles.axisCard} key={axis}>
              <span className={styles.axisColorKey} data-dimension-key={axis}><i className={axis === "base" ? styles.edgeKey : styles.sideKey} />{t(`eda.dimensions.${axis}Axis`)}</span>
              <BlueprintPlannerChoice label={label} ariaLabel={label} hideLabel disabled={disabled} disabledReason={t("eda.manual.reasonBusy")} value={axisMode}
                choices={(["none", "max", "exact"] as const).map(value => ({ value, label: t(`eda.dimensions.mode.${value}`),
                  disabled: value === "exact" && (oppositeExact || implicit),
                  disabledReason: implicit ? t("eda.dimensions.implicitExactReason") : t("eda.dimensions.otherExactReason") }))}
                onChange={value => onAxisModeChange ? onAxisModeChange(axis, value) : draft.setAxisMode(axis, value)} />
              {axisMode === "none" ? null : <label className={styles.numberField}>
                <span>{valueLabel}</span><span className={styles.numberInput}><input type="number" min="1" step="1"
                  max={axisMode === "exact" ? 70 : undefined} aria-label={valueLabel} value={draft.axisValue(axis)} aria-invalid={!draft.axisValid(axis)}
                  onChange={event => draft.setAxisValue(axis, event.currentTarget.value)} /><span>{t("eda.advanced.cells")}</span></span>
              </label>}
            </div>;
          })}
        </div>
        </div>
        {implicitBaseLength === undefined ? null : <div className={styles.legacyDimensions}>
          <p>{t("eda.dimensions.fixedLegacyWidth")} {implicitBaseLength}</p>
          {onReleaseFixedWidth ? <button type="button" onClick={onReleaseFixedWidth}>{t("eda.dimensions.releaseBoth")}</button> : null}
        </div>}

      </> : <LegacyDimensionInputs draft={draft} mode={mode} disabled={disabled} t={t} />}
      {conflict ? <p role="alert" className={plannerStyles.error}>{t("eda.dimensions.conflict")}</p> : null}
    </fieldset>
  </div>;
});

// AI-REMOVED 2026-11-21:
// Reason: 生产任务各形态统一独立两轴，旧形态限制仅显式兼容显示，原图继续旧入口。
// Trigger: 用户批准两轴八种组合。Evidence: REQ-051订正。
// Replacement: 上方两轴控件与legacy可解释面板。Risk: UI测试需适配。Human Review: Required
// Original code:
// export const BlueprintPlannerAdvanced = observer(function BlueprintPlannerAdvanced({ draft, mode, disabled, t, conflict = false, allowExact = true }: {
//   draft: PlannerWizardDraft; mode: PlannerDimensionMode; disabled: boolean; conflict?: boolean; allowExact?: boolean; t: (key: string) => string;
// }) {
//   // AI-REMOVED 2026-11-21:
//   // Reason: 尺寸约束为布局基础配置，不能折叠在高级入口中。
//   // Trigger: 用户要求尺寸直接显示并与布局规则对齐。
//   // Evidence: 本轮布局设置交互要求。Replacement: 直接 fieldset。
//   // Risk: Low。Human Review: Required
//   // Original code:
//   // return <details className={styles.advanced} open={draft.advancedOpen}
//   // onToggle={event => draft.setAdvancedOpen(event.currentTarget.open)}>
//   // <summary><strong>{t("eda.advanced.title")}</strong><span>{t("eda.advanced.summary")}</span></summary>
//   // <div className={styles.advancedBody}>
//   return <div className={styles.dimensionsPanel}>
//       <fieldset className={styles.dimensionControls} disabled={disabled}>
//         <legend>{t("eda.advanced.dimensions")}</legend>
//         <div className={styles.dimensionContent}>
//           <svg className={styles.dimensionDiagram} viewBox="0 0 220 150" role="img" aria-label={t(plannerDimensionLabel(mode))}>
//             <rect x="35" y="24" width="140" height="88" rx="3" className={styles.diagramBox} />
//             {mode === "shortest" ? <path d="M25 24v88m-5-80 5-8 5 8m-10 72 5 8 5-8" className={styles.diagramEdge} />
//               : <><path d={mode === "u-shaped" ? "M35 24v88h140V24" : "M35 112h140"} className={styles.diagramBus} />
//                 <path d="M35 132h140m-132-5-8 5 8 5m124-10 8 5-8 5" className={styles.diagramEdge} />
//                 <path d="M195 24v88m-5-80 5-8 5 8m-10 72 5 8 5-8" className={styles.diagramSide} /></>}
//           </svg>
//           <div className={styles.dimensionFields}>
//             {allowExact ? <label className={styles.numberField}>
//               <span>{t("eda.manual.exactBaseLength")}</span>
//               <span className={styles.numberInput}><input aria-label={t("eda.manual.exactBaseLength")} type="number" min="1" step="1"
//                 placeholder={t("eda.advanced.unlimited")} value={draft.exactBaseLength}
//                 aria-invalid={!draft.exactBaseLengthValid}
//                 onChange={event => draft.setExactBaseLength(event.currentTarget.value)} />
//                 <span>{t("eda.advanced.cells")}</span></span>
//             </label> : null}
//             {(["edge", ...(mode === "shortest" ? [] : ["side"])] as ("edge" | "side")[]).map(field => {
//               const value = draft.dimensions[mode][field];
//               return <label key={`${mode}:${field}`} className={styles.numberField}>
//                 <span><i className={field === "edge" ? styles.edgeKey : styles.sideKey} />{t(field === "edge" ? plannerDimensionLabel(mode) : "eda.advanced.perpendicular")}</span>
//                 <span className={styles.numberInput}><input type="number" min="1" step="1" placeholder={t("eda.advanced.unlimited")}
//                   value={value} aria-invalid={value !== "" && !isPlannerLimit(value)}
//                   onChange={event => draft.setDimension(mode, field, event.currentTarget.value)} />
//                   <span>{t("eda.advanced.cells")}</span></span>
//               </label>;
//             })}
//           </div>
//         </div>
//         {conflict ? <p role="alert">{t("eda.manual.globalLengthConflict")}</p> : null}
//       </fieldset>
//       {/* AI-REMOVED 2026-11-11:
//         Reason: 终止条件统一在规划与结果步骤编辑，布局高级设置只包含尺寸限制。
//         Trigger: 用户确认取消重复计算设置。
//         Evidence: 本组件与结果页同时渲染同一个停止条件。
//         Replacement: blueprint-planner-dialog.tsx runSettings。
//         Risk: Low。Human Review: Required
//         Original code:
//         <PlannerStopControls draft={draft} disabled={disabled} t={t} />
//       */}
//     {/* AI-REMOVED 2026-11-21: Reason: 高级折叠容器已取消。Trigger: 尺寸直接显示。
//         Evidence: 新 dimensionsPanel。Replacement: 外层 div。Risk: Low。Human Review: Required
//         Original code: </div></details> */}
//   </div>;
// });

// AI-REMOVED 2026-11-21:
// Reason: 生产任务旧形态上限按未填写处理，不再显示或清除旧限制。
// Trigger: 用户订正旧生产字段语义。Evidence: 本轮明确授权。
// Replacement: 独立两轴尺寸。Risk: Low。Human Review: Required
// Original code:
//         {draft.hasLegacyDimensions ? <div className={styles.legacyDimensions}>
//           <strong>{t("eda.dimensions.legacyTitle")}</strong><p>{t("eda.dimensions.legacyExplanation")}</p>
//           {(["straight", "u-shaped", "shortest"] as const).filter(id => draft.dimensions[id].edge !== "" || draft.dimensions[id].side !== "").map(id =>
//             <section key={id} aria-label={t(`eda.dimensions.legacy.${id}`)}><strong>{t(`eda.dimensions.legacy.${id}`)}</strong>
//               <LegacyDimensionInputs draft={draft} mode={id} disabled={disabled} t={t} /></section>)}
//           <button type="button" onClick={draft.clearLegacyDimensions}>{t("eda.dimensions.clearLegacy")}</button>
//         </div> : null}
