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
        <div><dt>{t("eda.warehousePortPlacement")}</dt><dd>{t({ any: "eda.portsAny", continuous: "eda.portsContinuous", "full-side": "eda.portsFullSide" }[options.warehousePortPlacement])}</dd></div>
        <div><dt>{t(plannerDimensionLabel(mode))}</dt><dd>{limits.edge || t("eda.advanced.unlimited")}</dd></div>
        {mode !== "shortest" ? <div><dt>{t("eda.advanced.perpendicular")}</dt><dd>{limits.side || t("eda.advanced.unlimited")}</dd></div> : null}
        {controller.blueprintRequest ? Object.entries(options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS).map(([key, enabled]) =>
          <div key={key}><dt>{t(`eda.optimization.${key}`)}</dt><dd>{t(enabled ? "eda.wizard.enabled" : "eda.wizard.disabled")}</dd></div>) : null}
      </dl></div>
    </details>
  </div>;
});
