import { observer } from "mobx-react-lite";
import type { AppHost } from "../host";
// AI-REMOVED 2026-11-11:
// Reason: 汇总采用文字与物品图标，流程图自带的缩放按钮不属于只读配置摘要。
// Trigger: 用户要求结果页重新定义紧凑展示，不复用原控件。
// Evidence: ProductionFlowGraph 含缩放及重置按钮。
// Replacement: 下方配方和设备数量清单。
// Risk: Low。Human Review: Required
// Original code:
// import { PlannerTaskFlow } from "./production-planning";
import { collectPlannerItemBoundaries, PlannerItemRules } from "@/shared/planner-item-policy";
import type { PlannerSupplyView } from "@/shared/planner-supply";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { DEFAULT_BLUEPRINT_OPTIMIZATIONS } from "@/shared/planner-task";
import type { PlannerDimensionMode } from "./blueprint-planner-wizard-state";
import { plannerDimensionLabel } from "./blueprint-planner-advanced";
import styles from "./blueprint-planner-wizard.module.scss";

export const BlueprintPlannerSummary = observer(function BlueprintPlannerSummary({ appHost, supply, mode }: {
  appHost: AppHost; supply: PlannerSupplyView | null; mode: PlannerDimensionMode;
}) {
  const controller = appHost.blueprintPlannerDialog, plan = controller.plan;
  const registry = appHost.workspace.registry, t = appHost.actions.translate;
  if (!plan) return null;
  const options = controller.options, rules = new PlannerItemRules(registry, options);
  const rows = supply ? collectPlannerItemBoundaries(registry, plan, supply) : [];
  const itemName = (id: string) => { const item = registry.queries.findItemDefinition(id); return item ? t(item.nameKey) : id; };
  const outputLabel = (id: string) => ({ auto: "eda.autoOutput", warehouse: "eda.warehouseOutput", stash: "eda.stashOutput",
    conduit: "eda.conduitOutput", external: "eda.externalOutput" })[rules.output(id)];
  const limits = controller.wizard.draft.dimensions[mode];
  const shape = t({ straight: "eda.straight", corner: "eda.corner", "u-shaped": "eda.uShaped" }[options.warehouseBus]);
  return <div className={styles.summaries}>
    <details className={styles.summary}>
      <summary><strong>{t("eda.wizard.planSummary")}</strong><span>{plan.targets.map(target => `${itemName(target.itemId)} ${target.perMinute}/min`).join(" · ")}</span></summary>
      <div className={styles.summaryBody}>
        <dl className={styles.facts}><div><dt>{t("eda.taskTitle")}</dt><dd>{controller.taskTitle ?? plan.name}</dd></div></dl>
        <div className={styles.targets}>{plan.targets.map(target => <span key={target.itemId}>
          <img src={createItemIconAssetUrl(registry.queries.findItemDefinition(target.itemId)?.iconId ?? target.itemId)} alt="" />
          {itemName(target.itemId)} <strong>{target.perMinute}/min</strong></span>)}</div>
        {controller.blueprintRequest ? <p>{controller.blueprintRequest.blueprintSource?.blueprint.name}</p>
          : <dl className={styles.facts}>{plan.recipes.map(recipe => <div key={recipe.recipeId}>
            <dt>{t(registry.queries.findRecipeDefinition(recipe.recipeId)?.nameKey ?? recipe.recipeId)}</dt>
            <dd>× {recipe.deviceCount}</dd>
          </div>)}</dl>}
        {/* AI-REMOVED 2026-11-11:
          Reason: 配置摘要应紧凑只读，原流程图附带缩放控件。
          Trigger: 结果页只读汇总要求。
          Evidence: ProductionFlowGraph 的工具栏。
          Replacement: 上方配方和设备数量清单。
          Risk: Low。Human Review: Required
          Original code:
          <div className={styles.summaryFlow}><PlannerTaskFlow plan={plan} options={options} registry={registry} t={t} /></div>
        */}
      </div>
    </details>
    <details className={styles.summary}>
      <summary><strong>{t("eda.wizard.production")}</strong><span>{t("eda.itemLogistics")} · {t("eda.startupOptions")}</span></summary>
      <div className={styles.summaryBody}>
        <dl className={styles.facts}>
          {rows.map(row => <div key={row.itemId}><dt>{itemName(row.itemId)}</dt><dd>{[
            row.supply ? t(rules.supply(row.itemId) === "warehouse" ? "eda.warehouseSupply"
              : rules.supply(row.itemId) === "conduit" ? "eda.conduitSupply" : rules.isSolid(row.itemId) ? "eda.externalBelt" : "eda.externalPipe") : null,
            row.byproducts ? t(rules.byproducts(row.itemId) === "destroy" ? "eda.destroy" : "eda.output") : null,
            row.output && !(row.byproducts && rules.byproducts(row.itemId) === "destroy") ? t(outputLabel(row.itemId)) : null,
          ].filter(Boolean).join(" · ")}</dd></div>)}
          {supply?.rows.filter(row => !row.inherited && row.policy).map(row => <div key={`source:${row.itemId}`}>
            <dt>{itemName(row.itemId)}</dt><dd>{row.policy?.source === "production"
              ? t(registry.queries.findRecipeDefinition(row.policy.recipeId)?.nameKey ?? row.policy.recipeId) : t("eda.supplyExternal")}</dd>
          </div>)}
          <div><dt>{t("eda.plantStartup")}</dt><dd>{t(options.plantStartup === "preload" ? "eda.preload" : "eda.warehouseStartup")}</dd></div>
          <div><dt>{t("eda.converterStartup")}</dt><dd>{t(options.converterStartup === "manual" ? "eda.converterStartupManual"
            : options.converterStartup === "tank" ? "eda.converterStartupTank" : "eda.converterStartupReject")}</dd></div>
        </dl>
      </div>
    </details>
    <details className={styles.summary}>
      <summary><strong>{t("eda.wizard.layoutSummary")}</strong><span>{shape} · {controller.manual.layout?.enabled ? t("eda.manual.placed").replace("{count}", String(controller.manual.layout.placements.length)) : t("eda.wizard.automaticPlacement")}</span></summary>
      <div className={styles.summaryBody}><dl className={styles.facts}>
        <div><dt>{t("eda.warehouseBus")}</dt><dd>{shape}</dd></div>
        {controller.manual.layout?.enabled ? <div><dt>{t("eda.manual.binding")}</dt><dd>{t(`eda.manual.${controller.manual.layout.mode}`)}</dd></div> : null}
        {controller.manual.layout?.enabled && controller.manual.hasCurrentLayoutFormat ? <>
          <div><dt>{t("eda.manual.placementMode")}</dt><dd>{t(`eda.manual.placementMode.${controller.manual.placementMode}`)}</dd></div>
          {controller.manual.layout.boundary.position ? (["x", "y"] as const).map(axis => <div key={axis}>
            <dt>{t(`eda.manual.axis.${axis}`)}</dt><dd>{t(`eda.manual.axis.${controller.manual.axisPositionMode(axis)}`)}</dd>
          </div>) : null}
        </> : null}
        <div><dt>{t("eda.warehousePortPlacement")}</dt><dd>{t({ any: "eda.portsAny", continuous: "eda.portsContinuous", "full-side": "eda.portsFullSide" }[options.warehousePortPlacement])}</dd></div>
        {controller.blueprintRequest ? <>
          <div><dt>{t(plannerDimensionLabel(mode))}</dt><dd>{limits.edge || t("eda.advanced.unlimited")}</dd></div>
          {mode !== "shortest" ? <div><dt>{t("eda.advanced.perpendicular")}</dt><dd>{limits.side || t("eda.advanced.unlimited")}</dd></div> : null}
        </> : <>
          {(["base", "side"] as const).map(axis => {
            const exact = axis === "base" ? options.dimensionLimits?.exactBaseLength : options.dimensionLimits?.exactSideLength;
            const max = axis === "base" ? options.dimensionLimits?.maxBaseLength : options.dimensionLimits?.maxSideLength;
            return <div key={axis}><dt>{t(`eda.dimensions.${axis}`)}</dt><dd>{exact !== undefined ? `${t("eda.dimensions.mode.exact")} ${exact}`
              : max !== undefined ? `${t("eda.dimensions.mode.max")} ${max}` : t("eda.dimensions.mode.none")}</dd></div>;
          })}

        </>}
        {controller.blueprintRequest ? Object.entries(options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS).map(([key, enabled]) =>
          <div key={key}><dt>{t(`eda.optimization.${key}`)}</dt><dd>{t(enabled ? "eda.wizard.enabled" : "eda.wizard.disabled")}</dd></div>) : null}
      </dl></div>
    </details>
  </div>;
});

// AI-REMOVED 2026-11-21: Reason: 生产旧形态限制不再生效或汇总。Trigger: 用户订正。
// Evidence: 本轮需求。Replacement: 上方两轴汇总。Risk: Low。Human Review: Required
// Original code:
//           {controller.wizard.draft.hasLegacyDimensions ? <div><dt>{t("eda.dimensions.legacyTitle")}</dt><dd>{Object.entries(controller.wizard.draft.dimensions)
//             .filter(([, pair]) => pair.edge || pair.side).map(([id, pair]) => `${t(`eda.dimensions.legacy.${id}`)} ${pair.edge || "—"} / ${pair.side || "—"}`).join(" · ")}</dd></div> : null}

// AI-REMOVED 2026-11-21: Reason: 移除四向摘要，改为双轴锁定。Trigger: 用户订正。Evidence: 画布手动旋转。Replacement: 上方。Risk: Low。Human Review: Required
// Original code:
//           <div><dt>{t("eda.manual.orientation")}</dt><dd>{t(`eda.manual.orientation.${controller.manual.layout.orientation}`)}</dd></div>
//           {controller.manual.layout.orientation === "fixed" ? <div><dt>{t("eda.manual.direction.facing")}</dt>
//             <dd>{controller.manual.layout.boundary.rotation === null ? t("eda.manual.direction.draftDefault")
//               : t(`eda.manual.edge.${(2 + controller.manual.layout.boundary.rotation / 90) % 4}`)}</dd></div> : null}
