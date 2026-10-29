import type { BlueprintPlannerItemPolicy, BlueprintPlannerOptions, BlueprintPlannerProductionPlan } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { collectPlannerItemBoundaries, PlannerItemRules, findPlannerDisposalRecipe } from "@/shared/planner-item-policy";
import type { PlannerSupplyView } from "@/shared/planner-supply";
import styles from "./blueprint-planner-dialog.module.scss";
import { observer } from "mobx-react-lite";
import { BlueprintPlannerChoice } from "./blueprint-planner-choice";

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
        const prefersDisposal = row.byproducts && !plan.targets.some(target => target.itemId === row.itemId)
          && rules.byproducts(row.itemId) === "destroy";
        const disposal = prefersDisposal && findPlannerDisposalRecipe(registry, row.itemId, plan.activeActivityIds);
        const outputChoices: readonly { value: NonNullable<BlueprintPlannerItemPolicy["output"]>; label: string }[] = solid ? [
          { value: "auto", label: t("eda.autoOutput") }, { value: "warehouse", label: t("eda.warehouseOutput") },
          { value: "stash", label: t("eda.stashOutput") },
        ] : [{ value: "conduit", label: t("eda.conduitOutput") }, { value: "external", label: t("eda.externalOutput") }];
        const update = (value: Partial<BlueprintPlannerItemPolicy>) => onChange({
          ...options.itemPolicies?.find(policy => policy.itemId === row.itemId), itemId: row.itemId, ...value,
        });
        return <div className={styles.supplyRule} key={row.itemId}>
          <div className={styles.supplyItem}>
            {item ? <img src={createItemIconAssetUrl(item.iconId)} alt="" /> : null}
            <div><strong>{name}</strong><span>{[row.supply ? t("eda.supplyExternal") : null, row.byproducts ? t("productionPlanning.byproduct") : row.output ? t("eda.itemProduct") : null].filter(Boolean).join(" · ")}</span></div>
          </div>
          <div className={styles.supplyControls}>
            {row.supply ? <BlueprintPlannerChoice label={t("eda.itemSupply")} ariaLabel={`${name} · ${t("eda.itemSupply")}`}
              value={rules.supply(row.itemId)} invalid={rules.requiresWarehouseSupply(row.itemId)}
              choices={[
                { value: "external", label: t(solid ? "eda.externalBelt" : "eda.externalPipe") },
                { value: solid ? "warehouse" : "conduit", label: t(solid ? "eda.warehouseSupply" : "eda.conduitSupply") },
              ]} onChange={supply => update({ supply })} /> : null}
            {row.byproducts ? <BlueprintPlannerChoice label={t("eda.byproducts")} ariaLabel={`${name} · ${t("eda.byproducts")}`}
              value={rules.byproducts(row.itemId)} choices={[
                { value: "destroy", label: t("eda.destroy") }, { value: "output", label: t("eda.output") },
              ]} onChange={byproducts => update({ byproducts })} /> : null}
            {row.output ? disposal ? <div className={styles.supplyControl}>
              <span>{t("eda.itemOutput")}</span><span className={styles.fixedDestination}>{t("eda.outputHandled")}</span>
            </div> : <div className={styles.supplyControl}>
              {prefersDisposal ? <span role="status">{t("eda.byproductNotDisposable")}</span> : null}
              <BlueprintPlannerChoice label={t("eda.itemOutput")} ariaLabel={`${name} · ${t("eda.itemOutput")}`}
              value={rules.output(row.itemId)} choices={outputChoices} onChange={output => update({ output })} />
            </div> : null}
          </div>
        </div>;
      })}
    </fieldset>
  </section>;
});

// AI-REMOVED 2026-10-25:
// Reason: 少量互斥选项改为原生单选框组成的分段控件，直接展示全部选项。
// Trigger: 用户确认物品物流的两到三个选项使用按钮组。
// Evidence: 外部接入和副产物处理各两项，固体产物去向三项；现有分段组件仅供产线面板内部使用。
// Replacement: 本文件 ItemPolicyChoice 与 BlueprintPlannerItemPolicies 中的三类调用。
// Risk: 原生键盘行为、禁用继承和错误状态需验证。Human Review: Required
// Original code:
//             {row.supply ? <label><span>{t("eda.itemSupply")}</span>
//               <select aria-label={`${name} · ${t("eda.itemSupply")}`} aria-invalid={rules.requiresWarehouseSupply(row.itemId)}
//                 className={rules.requiresWarehouseSupply(row.itemId) ? styles.error : undefined} value={rules.supply(row.itemId)}
//                 onChange={event => update({ supply: event.target.value as BlueprintPlannerItemPolicy["supply"] })}>
//                 <option value="external">{t(solid ? "eda.externalBelt" : "eda.externalPipe")}</option>
//                 <option value={solid ? "warehouse" : "conduit"}>{t(solid ? "eda.warehouseSupply" : "eda.conduitSupply")}</option>
//               </select></label> : null}
//             {row.byproducts ? <label><span>{t("eda.byproducts")}</span>
//               <select aria-label={`${name} · ${t("eda.byproducts")}`} value={rules.byproducts(row.itemId)}
//                 onChange={event => update({ byproducts: event.target.value as BlueprintPlannerItemPolicy["byproducts"] })}>
//                 <option value="destroy">{t("eda.destroy")}</option><option value="output">{t("eda.output")}</option>
//               </select></label> : null}
//             {row.output ? <label><span>{t("eda.itemOutput")}</span>
//               {solid ? <select aria-label={`${name} · ${t("eda.itemOutput")}`} value={rules.output(row.itemId)}
//                 onChange={event => update({ output: event.target.value as BlueprintPlannerItemPolicy["output"] })}>
//                 <option value="auto">{t("eda.autoOutput")}</option><option value="warehouse">{t("eda.warehouseOutput")}</option><option value="stash">{t("eda.stashOutput")}</option>
//               </select> : <span className={styles.fixedDestination}>{t("eda.conduitOutput")}</span>}
//             </label> : null}

// AI-REMOVED 2026-10-25:
// Reason: 物品规则专用分段控件扩展为整页共享控件。
// Trigger: 用户要求布局、启动与物品物流统一去除下拉框。
// Evidence: 三类区域均为有限互斥选项，原生单选语义一致。
// Replacement: blueprint-planner-choice.tsx BlueprintPlannerChoice。
// Risk: Low；保留分组名称、主题和原生交互。Human Review: Required
// Original code:
// import { useId } from "react";
//
// function ItemPolicyChoice<T extends string>({ label, itemName, value, choices, invalid, onChange }: {
//   readonly label: string;
//   readonly itemName: string;
//   readonly value: T;
//   readonly choices: readonly { readonly value: T; readonly label: string }[];
//   readonly invalid?: boolean;
//   readonly onChange: (value: T) => void;
// }) {
//   const name = useId();
//   return <div className={styles.supplyControl}>
//     <span>{label}</span>
//     <div className={styles.policyChoices} role="radiogroup" aria-label={`${itemName} · ${label}`} aria-invalid={invalid}>
//       {choices.map(choice => <label className={styles.policyChoice} key={choice.value}>
//         <input type="radio" name={name} value={choice.value} checked={value === choice.value}
//           onChange={() => onChange(choice.value)} />
//         <span>{choice.label}</span>
//       </label>)}
//     </div>
//   </div>;
// }
