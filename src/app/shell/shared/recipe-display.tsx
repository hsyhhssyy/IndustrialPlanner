import { type ReactNode } from "react";
import {
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  type ProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import styles from "./recipe-display.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export interface RecipeDisplayProps {
  recipeId: string;
  index: ProductionPlanningIndex;
  /** 是否显示设备图标和名称，默认 false */
  showDevice?: boolean;
  t: (key: string) => string;
}

export function RecipeDisplay({
  recipeId,
  index,
  showDevice = false,
  t,
}: RecipeDisplayProps): ReactNode {
  const recipe = index.recipeById.get(recipeId);
  if (recipe === undefined) return null;

  const machine = index.entityById.get(recipe.machineId) ?? null;

  const formula = (
    <div className={cm(styles, "recipe-display-formula")}>
      {recipe.inputs.map((input, i) => (
        <span key={`in-${input.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
          {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
          <span className={cm(styles, "recipe-display-formula-icon")}>
            <img alt="" src={resolveProductionPlanningItemIconSrc(input.itemId, index)} />
            <span>{input.amount}</span>
          </span>
        </span>
      ))}
      <span className={cm(styles, "recipe-display-formula-arrow")}>
        <span>▶▶</span>
        <span>{recipe.durationSeconds}{t("productionPlanning.second_short")}</span>
      </span>
      {recipe.outputs.map((output) => (
        <span key={`out-${output.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
          <span className={cm(styles, "recipe-display-formula-icon")}>
            <img alt="" src={resolveProductionPlanningItemIconSrc(output.itemId, index)} />
            <span>{output.amount}</span>
          </span>
        </span>
      ))}
    </div>
  );

  if (!showDevice) return formula;

  return (
    <div className={cm(styles, "recipe-display")}>
      <div className={cm(styles, "recipe-display-device")}>
        <img
          alt=""
          src={machine === null ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(machine.id)}
        />
        <span>{machine === null ? recipe.machineId : t(machine.nameKey)}</span>
      </div>
      <span className={cm(styles, "recipe-display-device-colon")}>:</span>
      {formula}
    </div>
  );
}
