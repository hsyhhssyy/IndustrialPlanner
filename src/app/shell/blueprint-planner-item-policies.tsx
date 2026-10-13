import type { BlueprintPlannerItemPolicy, BlueprintPlannerOptions, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { collectPlannerItemBoundaries, PlannerItemRules } from "@/shared/planner-item-policy";
import type { PlannerSupplyView } from "@/shared/planner-supply";
import styles from "./blueprint-planner-dialog.module.scss";
import { observer } from "mobx-react-lite";

export const BlueprintPlannerItemPolicies = observer(function BlueprintPlannerItemPolicies({ plan, registry, environment, options, disabled, onChange, t }: {
  readonly plan: BlueprintPlannerProductionPlan;
  readonly registry: RegistryContract;
  readonly environment: PlannerSupplyView;
  readonly options: BlueprintPlannerOptions;
  readonly disabled: boolean;
  readonly onChange: (policy: BlueprintPlannerItemPolicy) => void;
  readonly t: (key: string) => string;
}) {
  const rules = new PlannerItemRules(registry, options);
  const rows = collectPlannerItemBoundaries(registry, plan, environment);
  if (!rows.length) return null;
  return <section className={styles.environment} aria-label={t("eda.itemLogistics")}>
    <div className={styles.environmentHeading}><strong>{t("eda.itemLogistics")}</strong></div>
    <fieldset className={styles.supplyRules} disabled={disabled}>
      {rows.map(row => {
        const item = registry.queries.findItemDefinition(row.itemId);
        const name = item ? t(item.nameKey) : row.itemId;
        const solid = rules.isSolid(row.itemId);
        const update = (value: Partial<BlueprintPlannerItemPolicy>) => onChange({
          ...options.itemPolicies?.find(policy => policy.itemId === row.itemId), itemId: row.itemId, ...value,
        });
        return <div className={styles.supplyRule} key={row.itemId}>
          <div className={styles.supplyItem}>
            {item ? <img src={createItemIconAssetUrl(item.iconId)} alt="" /> : null}
            <div><strong>{name}</strong><span>{[row.supply ? t("eda.supplyExternal") : null, row.byproducts ? t("productionPlanning.byproduct") : row.output ? t("eda.itemProduct") : null].filter(Boolean).join(" · ")}</span></div>
          </div>
          <div className={styles.supplyControls}>
            {row.supply ? <label><span>{t("eda.itemSupply")}</span>
              <select aria-label={`${name} · ${t("eda.itemSupply")}`} aria-invalid={rules.requiresWarehouseSupply(row.itemId)}
                className={rules.requiresWarehouseSupply(row.itemId) ? styles.error : undefined} value={rules.supply(row.itemId)}
                onChange={event => update({ supply: event.target.value as BlueprintPlannerItemPolicy["supply"] })}>
                <option value="external">{t(solid ? "eda.externalBelt" : "eda.externalPipe")}</option>
                <option value={solid ? "warehouse" : "conduit"}>{t(solid ? "eda.warehouseSupply" : "eda.conduitSupply")}</option>
              </select></label> : null}
            {row.byproducts ? <label><span>{t("eda.byproducts")}</span>
              <select aria-label={`${name} · ${t("eda.byproducts")}`} value={rules.byproducts(row.itemId)}
                onChange={event => update({ byproducts: event.target.value as BlueprintPlannerItemPolicy["byproducts"] })}>
                <option value="destroy">{t("eda.destroy")}</option><option value="output">{t("eda.output")}</option>
              </select></label> : null}
            {row.output ? <label><span>{t("eda.itemOutput")}</span>
              {solid ? <select aria-label={`${name} · ${t("eda.itemOutput")}`} value={rules.output(row.itemId)}
                onChange={event => update({ output: event.target.value as BlueprintPlannerItemPolicy["output"] })}>
                <option value="auto">{t("eda.autoOutput")}</option><option value="warehouse">{t("eda.warehouseOutput")}</option><option value="stash">{t("eda.stashOutput")}</option>
              </select> : <span className={styles.fixedDestination}>{t("eda.conduitOutput")}</span>}
            </label> : null}
          </div>
        </div>;
      })}
    </fieldset>
  </section>;
});
